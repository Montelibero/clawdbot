import { getPeerId } from "telegram/Utils";

import type { ResolvedTelegramUserAccount } from "./types.js";
import { getTelegramUserClient } from "./client.js";

function normalizeTarget(raw: string): string {
  let value = raw.trim();
  if (!value) return value;
  const lowered = value.toLowerCase();
  if (lowered.startsWith("telegram:")) value = value.slice("telegram:".length).trim();
  value = value.replace(/^(user|chat|group|channel|peer):/i, "").trim();
  return value || raw.trim();
}

export async function sendTelegramUserMessage(params: {
  to: string;
  text: string;
  account: ResolvedTelegramUserAccount;
}): Promise<{ messageId: string; chatId: string }> {
  const { client } = await getTelegramUserClient(params.account);
  const target = normalizeTarget(params.to);
  if (!target) throw new Error("telegram-user target is required");
  const sent = await client.sendMessage(target, { message: params.text });
  const messageId = typeof (sent as { id?: number }).id === "number" ? String((sent as { id: number }).id) : "unknown";
  const peerId = (sent as { peerId?: unknown }).peerId;
  const chatId = peerId ? String(getPeerId(peerId as Parameters<typeof getPeerId>[0])) : target;
  return { messageId, chatId };
}
