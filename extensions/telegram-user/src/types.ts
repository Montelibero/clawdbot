import type { ToolPolicyConfig } from "clawdbot/plugin-sdk";

export type TelegramUserGroupConfig = {
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  requireMention?: boolean;
  tools?: ToolPolicyConfig;
};

export type TelegramUserAccountConfig = {
  name?: string;
  enabled?: boolean;
  apiId?: number;
  apiHash?: string;
  sessionFile?: string;
  sessionString?: string;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: Array<string | number>;
  groupPolicy?: "disabled" | "allowlist" | "open";
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, TelegramUserGroupConfig>;
  replyToMode?: "off" | "first" | "all";
};

export type TelegramUserConfig = TelegramUserAccountConfig & {
  accounts?: Record<string, TelegramUserAccountConfig>;
  defaultAccount?: string;
};

export type ResolvedTelegramUserAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  apiId?: number;
  apiHash?: string;
  sessionFile?: string;
  sessionString?: string;
  config: TelegramUserAccountConfig;
};
