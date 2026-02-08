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
      Type.Array(Type.Number({ description: "Exact Telegram message id" }), {
        description: "Fetch exact message ids via MTProto high-level getMessages",
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
      const hours =
        typeof input.hours === "number" && Number.isFinite(input.hours)
          ? Math.max(1, Math.floor(input.hours))
          : 24;
      const limit =
        typeof input.limit === "number" && Number.isFinite(input.limit)
          ? Math.max(1, Math.min(1000, Math.floor(input.limit)))
          : 200;
      const ids =
        Array.isArray(input.ids) && input.ids.length > 0
          ? input.ids
              .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
              .map((entry) => Math.floor(entry))
              .filter((entry) => entry > 0)
          : [];

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
      const messages =
        ids.length > 0
          ? await client.getMessages(chatId, { ids })
          : await client.getMessages(chatId, { limit });
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
