import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "clawdbot/plugin-sdk";

import { createTelegramUserOutboundAdapter } from "./outbound.js";
import { TelegramUserConfigSchema } from "./config-schema.js";
import {
  listTelegramUserAccountIds,
  resolveDefaultTelegramUserAccountId,
  resolveTelegramUserAccount,
  type ResolvedTelegramUserAccount,
} from "./accounts.js";
import { createTelegramUserLoginTool } from "./login-tool.js";
import { createTelegramUserHistoryTool } from "./history-tool.js";
import { createTelegramUserRawTool } from "./raw-tool.js";
import { monitorTelegramUserProvider } from "./monitor.js";
import { readSessionString } from "./storage.js";

const meta = {
  id: "telegram-user",
  label: "Telegram User",
  selectionLabel: "Telegram User (MTProto)",
  docsPath: "/channels/telegram",
  docsLabel: "telegram",
  blurb: "Telegram user account via MTProto (GramJS)",
  order: 75,
  quickstartAllowFrom: true,
};

function normalizeTelegramUserTarget(raw: string): string | undefined {
  let value = raw.trim();
  if (!value) return undefined;
  const lowered = value.toLowerCase();
  if (lowered.startsWith("telegram-user:")) value = value.slice("telegram-user:".length).trim();
  if (lowered.startsWith("telegram:")) value = value.slice("telegram:".length).trim();
  value = value.replace(/^(user|chat|group|channel|peer):/i, "").trim();
  return value || undefined;
}

export const telegramUserPlugin: ChannelPlugin<ResolvedTelegramUserAccount> = {
  id: "telegram-user",
  meta,
  pairing: {
    idLabel: "telegramUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(telegram-user|telegram|tg):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveTelegramUserAccount({ cfg });
      // Best-effort: sending on approval requires active session, which may not exist.
      if (!account.sessionFile) return;
      const session = await readSessionString(account.sessionFile);
      if (!session) return;
      const { sendTelegramUserMessage } = await import("./send.js");
      await sendTelegramUserMessage({
        to: id,
        text: "✅ Pairing approved.",
        account,
      });
    },
  },
  capabilities: {
    chatTypes: ["direct", "group", "channel"],
    reactions: false,
    threads: false,
    media: false,
  },
  reload: { configPrefixes: ["channels.telegram-user"] },
  configSchema: buildChannelConfigSchema(TelegramUserConfigSchema),
  config: {
    listAccountIds: (cfg) => listTelegramUserAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveTelegramUserAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultTelegramUserAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "telegram-user",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "telegram-user",
        accountId,
        clearBaseFields: ["apiId", "apiHash", "sessionFile", "sessionString", "name"],
      }),
    isConfigured: async (account) => {
      if (!account.apiId || !account.apiHash) return false;
      if (account.botToken?.trim()) return true;
      if (account.sessionString?.trim()) return true;
      if (!account.sessionFile) return false;
      const session = await readSessionString(account.sessionFile);
      return Boolean(session);
    },
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.apiId && account.apiHash),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveTelegramUserAccount({ cfg, accountId }).config.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(telegram-user|telegram|tg):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg.channels?.["telegram-user"] as { accounts?: Record<string, unknown> } | undefined)?.
          accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.telegram-user.accounts.${resolvedAccountId}.`
        : "channels.telegram-user.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("telegram-user"),
        normalizeEntry: (raw) => raw.replace(/^(telegram-user|telegram|tg):/i, ""),
      };
    },
  },
  messaging: {
    normalizeTarget: normalizeTelegramUserTarget,
    targetResolver: {
      looksLikeId: () => true,
      hint: "<chatId | @username>",
    },
  },
  outbound: createTelegramUserOutboundAdapter(),
  agentTools: (ctx) => [
    createTelegramUserLoginTool({ cfg: ctx.cfg }),
    createTelegramUserHistoryTool({ cfg: ctx.cfg }),
    createTelegramUserRawTool({ cfg: ctx.cfg }),
  ],
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.setStatus({
        accountId: account.accountId,
        configured: Boolean(account.apiId && account.apiHash),
        enabled: account.enabled,
      });
      return monitorTelegramUserProvider({
        config: ctx.cfg,
        account,
        runtime: {
          log: (msg) => ctx.log?.info?.(msg),
          error: (msg) => ctx.log?.error?.(msg),
        },
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => {
          const next = { ...ctx.getStatus(), ...patch };
          ctx.setStatus(next);
        },
      });
    },
    stopAccount: async (ctx) => {
      ctx.setStatus({
        ...ctx.getStatus(),
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};
