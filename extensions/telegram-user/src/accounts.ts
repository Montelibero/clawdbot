import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "clawdbot/plugin-sdk";

import type {
  ResolvedTelegramUserAccount,
  TelegramUserAccountConfig,
  TelegramUserConfig,
} from "./types.js";
import { resolveDefaultSessionFile } from "./storage.js";

function listConfiguredAccountIds(cfg: ClawdbotConfig): string[] {
  const accounts = (cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listTelegramUserAccountIds(cfg: ClawdbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultTelegramUserAccountId(cfg: ClawdbotConfig): string {
  const config = cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined;
  if (config?.defaultAccount?.trim()) return config.defaultAccount.trim();
  const ids = listTelegramUserAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): TelegramUserAccountConfig | undefined {
  const accounts = (cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId] as TelegramUserAccountConfig | undefined;
}

function mergeAccountConfig(cfg: ClawdbotConfig, accountId: string): TelegramUserAccountConfig {
  const raw = (cfg.channels?.["telegram-user"] ?? {}) as TelegramUserConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

function resolveApiId(value?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const env = process.env.TELEGRAM_USER_API_ID?.trim();
  if (!env) return undefined;
  const parsed = Number.parseInt(env, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveApiHash(value?: string): string | undefined {
  if (value?.trim()) return value.trim();
  const env = process.env.TELEGRAM_USER_API_HASH?.trim();
  return env || undefined;
}

function resolveBotToken(value?: string): string | undefined {
  if (value?.trim()) return value.trim();
  const env = process.env.TELEGRAM_USER_BOT_TOKEN?.trim();
  return env || undefined;
}

export function resolveTelegramUserAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedTelegramUserAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled =
    (params.cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined)?.enabled !== false;
  const merged = mergeAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const apiId = resolveApiId(merged.apiId);
  const apiHash = resolveApiHash(merged.apiHash);
  const botToken = resolveBotToken(merged.botToken);
  const sessionFile = merged.sessionFile?.trim() || resolveDefaultSessionFile(accountId);
  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    apiId,
    apiHash,
    botToken,
    sessionFile,
    sessionString: merged.sessionString?.trim() || undefined,
    config: merged,
  };
}

export function listEnabledTelegramUserAccounts(
  cfg: ClawdbotConfig,
): ResolvedTelegramUserAccount[] {
  const ids = listTelegramUserAccountIds(cfg);
  const accounts = ids.map((accountId) => resolveTelegramUserAccount({ cfg, accountId }));
  return accounts.filter((account) => account.enabled);
}

export type { ResolvedTelegramUserAccount } from "./types.js";
