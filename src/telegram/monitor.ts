import { type RunOptions, run } from "@grammyjs/runner";
import type { ClawdbotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { resolveAgentMaxConcurrent } from "../config/agent-limits.js";
import { computeBackoff, sleepWithAbort } from "../infra/backoff.js";
import { formatDurationMs } from "../infra/format-duration.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveTelegramAccount } from "./accounts.js";
import { resolveTelegramAllowedUpdates } from "./allowed-updates.js";
import { createTelegramBot } from "./bot.js";
import { makeProxyFetch } from "./proxy.js";
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from "./update-offset-store.js";
import { startTelegramWebhook } from "./webhook.js";

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  webhookPort?: number;
  webhookSecret?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
};

export function createTelegramRunnerOptions(cfg: ClawdbotConfig): RunOptions<unknown> {
  return {
    sink: {
      concurrency: resolveAgentMaxConcurrent(cfg),
    },
    runner: {
      fetch: {
        // Match grammY defaults
        timeout: 30,
        // Request reactions without dropping default update types.
        allowed_updates: resolveTelegramAllowedUpdates(),
      },
      // Suppress grammY getUpdates stack traces; we log concise errors ourselves.
      silent: true,
    },
  };
}

const TELEGRAM_POLL_RESTART_POLICY = {
  initialMs: 2000,
  maxMs: 30_000,
  factor: 1.8,
  jitter: 0.25,
};

/** No updates for 10 minutes → consider the connection stale. */
const STALE_TIMEOUT_MS = 10 * 60 * 1000;
/** Check staleness every 60 seconds. */
const STALE_CHECK_INTERVAL_MS = 60 * 1000;

const isGetUpdatesConflict = (err: unknown) => {
  if (!err || typeof err !== "object") return false;
  const typed = err as {
    error_code?: number;
    errorCode?: number;
    description?: string;
    method?: string;
    message?: string;
  };
  const errorCode = typed.error_code ?? typed.errorCode;
  if (errorCode !== 409) return false;
  const haystack = [typed.method, typed.description, typed.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes("getupdates");
};

export async function monitorTelegramProvider(opts: MonitorTelegramOpts = {}) {
  const cfg = opts.config ?? loadConfig();
  const account = resolveTelegramAccount({
    cfg,
    accountId: opts.accountId,
  });
  const token = opts.token?.trim() || account.token;
  if (!token) {
    throw new Error(
      `Telegram bot token missing for account "${account.accountId}" (set channels.telegram.accounts.${account.accountId}.botToken/tokenFile or TELEGRAM_BOT_TOKEN for default).`,
    );
  }

  const proxyFetch =
    opts.proxyFetch ??
    (account.config.proxy ? makeProxyFetch(account.config.proxy as string) : undefined);

  let lastUpdateId = await readTelegramUpdateOffset({
    accountId: account.accountId,
  });
  let lastActivityAt: number | null = null;
  let restartAttempts = 0;

  const persistUpdateId = async (updateId: number) => {
    if (lastUpdateId !== null && updateId <= lastUpdateId) return;
    lastUpdateId = updateId;
    lastActivityAt = Date.now();
    restartAttempts = 0;
    try {
      await writeTelegramUpdateOffset({
        accountId: account.accountId,
        updateId,
      });
    } catch (err) {
      (opts.runtime?.error ?? console.error)(
        `telegram: failed to persist update offset: ${String(err)}`,
      );
    }
  };

  const bot = createTelegramBot({
    token,
    runtime: opts.runtime,
    proxyFetch,
    config: cfg,
    accountId: account.accountId,
    updateOffset: {
      lastUpdateId,
      onUpdateId: persistUpdateId,
    },
  });

  if (opts.useWebhook) {
    await startTelegramWebhook({
      token,
      accountId: account.accountId,
      config: cfg,
      path: opts.webhookPath,
      port: opts.webhookPort,
      secret: opts.webhookSecret,
      runtime: opts.runtime as RuntimeEnv,
      fetch: proxyFetch,
      abortSignal: opts.abortSignal,
      publicUrl: opts.webhookUrl,
    });
    return;
  }

  // Use grammyjs/runner for concurrent update processing
  const log = opts.runtime?.log ?? console.log;
  const aborted = () => opts.abortSignal?.aborted === true;

  while (!aborted()) {
    const runner = run(bot, createTelegramRunnerOptions(cfg));
    const stopOnAbort = () => {
      if (aborted()) void runner.stop();
    };
    opts.abortSignal?.addEventListener("abort", stopOnAbort, { once: true });

    // Stale watchdog: resolve when no updates arrive for STALE_TIMEOUT_MS
    let staleResolve: (() => void) | null = null;
    const stalePromise = new Promise<void>((resolve) => {
      staleResolve = resolve;
    });
    const staleTimer = setInterval(() => {
      if (!lastActivityAt) return; // no updates yet — skip
      if (Date.now() - lastActivityAt <= STALE_TIMEOUT_MS) return;

      // Probe connection before concluding it's dead
      bot.api
        .getMe()
        .then(() => {
          // Connection alive — bot is just idle, not stale
          lastActivityAt = Date.now();
        })
        .catch(() => {
          const minutesIdle = Math.floor((Date.now() - (lastActivityAt ?? 0)) / 60_000);
          log(`Telegram polling stale (getMe failed after ${minutesIdle}m idle); restarting.`);
          staleResolve?.();
        });
    }, STALE_CHECK_INTERVAL_MS);

    // Capture runner.task() so we can absorb its rejection after stop()
    const runnerTask = runner.task();

    try {
      await Promise.race([runnerTask, stalePromise]);
      // If we reach here without abort, runner stopped unexpectedly or stale timeout fired
      if (aborted()) return;
      log("Telegram polling stopped unexpectedly; restarting.");
    } catch (err) {
      if (aborted()) throw err;
      if (isGetUpdatesConflict(err)) {
        log("Telegram getUpdates conflict; restarting.");
      } else {
        log(`Telegram polling error: ${err}; restarting.`);
      }
    } finally {
      clearInterval(staleTimer);
      runner.stop();
      // Absorb the runner rejection after stop() to prevent unhandled promise rejection
      // (stop() aborts the pending fetch, causing an AbortError on runnerTask)
      runnerTask?.catch(() => {});
      opts.abortSignal?.removeEventListener("abort", stopOnAbort);
    }

    // Backoff before restart
    restartAttempts += 1;
    const delayMs = computeBackoff(TELEGRAM_POLL_RESTART_POLICY, restartAttempts);
    log(`Telegram poll restart ${restartAttempts} in ${formatDurationMs(delayMs)}.`);
    try {
      await sleepWithAbort(delayMs, opts.abortSignal);
    } catch {
      if (aborted()) return;
    }
  }
}
