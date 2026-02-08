import { Type } from "@sinclair/typebox";
import type { ChannelAgentTool, ClawdbotConfig } from "clawdbot/plugin-sdk";

import { resolveTelegramUserAccount } from "./accounts.js";
import { getTelegramUserClient } from "./client.js";

const ACTIONS = ["history"] as const;

function stringEnum<T extends readonly string[]>(values: T) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values] });
}

export const TelegramUserHistoryToolSchema = Type.Object(
  {
    action: stringEnum(ACTIONS),
    accountId: Type.Optional(Type.String()),
    chatId: Type.String({ description: "Chat id or @username" }),
    ids: Type.Optional(
      Type.Unknown({
        description:
          "Message ids. Accepts array (e.g. [4099]) or string (e.g. \"[4099]\" / \"4099,4100\").",
      }),
    ),
    hours: Type.Optional(Type.Number({ description: "Lookback window in hours (default 24)" })),
    limit: Type.Optional(Type.Number({ description: "Max messages to fetch (default 200)" })),
  },
  { additionalProperties: false },
);

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function parseIds(input: unknown): number[] {
  if (Array.isArray(input)) {
    return input
      .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
      .map((entry) => Math.floor(entry))
      .filter((entry) => entry > 0);
  }
  if (typeof input !== "string") return [];
  const raw = input.trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parseIds(parsed);
    } catch {
      return [];
    }
  }
  return raw
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((num) => Number.isFinite(num) && num > 0);
}

function parsePositiveInt(input: unknown, defaultValue: number, maxValue?: number): number {
  const raw =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number.parseInt(input.trim(), 10)
        : NaN;
  if (!Number.isFinite(raw)) return defaultValue;
  const normalized = Math.max(1, Math.floor(raw));
  return typeof maxValue === "number" ? Math.min(maxValue, normalized) : normalized;
}

function parseChatTarget(chatId: string): string | bigint {
  return /^-?\d+$/.test(chatId) ? BigInt(chatId) : chatId;
}

export function createTelegramUserHistoryTool(params?: {
  cfg?: ClawdbotConfig;
}): ChannelAgentTool {
  return {
    name: "telegram_user_history",
    label: "Telegram User History",
    description: "Fetch recent messages from a Telegram chat (MTProto).",
    parameters: TelegramUserHistoryToolSchema,
    execute: async (_toolCallId, args) => {
      const input = args as Record<string, unknown>;
      const action = String(input.action ?? "").trim();
      if (action !== "history") {
        throw new Error(`Unknown action: ${action}`);
      }
      const accountId = typeof input.accountId === "string" ? input.accountId.trim() : undefined;
      const chatId = String(input.chatId ?? "").trim();
      if (!chatId) throw new Error("chatId is required");
      const hours = parsePositiveInt(input.hours, 24);
      const limit = parsePositiveInt(input.limit, 200, 1000);
      const ids = parseIds(input.ids);

      const cfg = params?.cfg ?? ({} as ClawdbotConfig);
      const account = resolveTelegramUserAccount({ cfg, accountId });
      const { client } = await getTelegramUserClient(account);
      const isBotMode = Boolean(account.botToken?.trim());
      if (isBotMode && ids.length === 0) {
        throw new Error(
          "Bot mode requires ids. Use: {\"action\":\"history\",\"chatId\":\"...\",\"ids\":[123,124]}",
        );
      }

      const since = Date.now() - hours * 60 * 60 * 1000;
      const chatTarget = parseChatTarget(chatId);
      const messages =
        ids.length > 0
          ? await client.getMessages(chatTarget, { ids })
          : await client.getMessages(chatTarget, { limit });
      const items = messages
        .map((msg) => ({
          id: (msg as { id?: number }).id,
          date: (msg as { date?: number }).date ? (msg as { date: number }).date * 1000 : undefined,
          text: (msg as { message?: string }).message,
          fromId: (msg as { fromId?: unknown }).fromId,
        }))
        .filter((msg) => (msg.date ?? 0) >= since)
        .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));

      return jsonResult({ ok: true, chatId, hours, ids: ids.length > 0 ? ids : undefined, count: items.length, items });
    },
  };
}
