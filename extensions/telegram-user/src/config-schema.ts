import { ToolPolicySchema } from "clawdbot/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

const groupConfigSchema = z.object({
  allowFrom: z.array(allowFromEntry).optional(),
  enabled: z.boolean().optional(),
  requireMention: z.boolean().optional(),
  tools: ToolPolicySchema,
});

const telegramUserAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  apiId: z.number().optional(),
  apiHash: z.string().optional(),
  botToken: z.string().optional(),
  sessionFile: z.string().optional(),
  sessionString: z.string().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  allowFrom: z.array(allowFromEntry).optional(),
  groupPolicy: z.enum(["disabled", "allowlist", "open"]).optional(),
  groupAllowFrom: z.array(allowFromEntry).optional(),
  groups: z.object({}).catchall(groupConfigSchema).optional(),
  replyToMode: z.enum(["off", "first", "all"]).optional(),
});

export const TelegramUserConfigSchema = telegramUserAccountSchema.extend({
  accounts: z.object({}).catchall(telegramUserAccountSchema).optional(),
  defaultAccount: z.string().optional(),
});
