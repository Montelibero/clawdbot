import { missingTargetError, type ChannelOutboundAdapter } from "clawdbot/plugin-sdk";

import { resolveTelegramUserAccount } from "./accounts.js";
import { sendTelegramUserMessage } from "./send.js";

export function createTelegramUserOutboundAdapter(): ChannelOutboundAdapter {
  return {
    deliveryMode: "direct",
    resolveTarget: ({ to, allowFrom, mode }) => {
      const trimmed = to?.trim() ?? "";
      const allowListRaw = (allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
      const hasWildcard = allowListRaw.includes("*");
      const allowList = allowListRaw.filter((entry) => entry !== "*");
      const allowListLower = allowList.map((entry) => entry.toLowerCase());

      if (trimmed) {
        if (mode === "implicit" || mode === "heartbeat") {
          const lowerTo = trimmed.toLowerCase();
          const isAllowed =
            allowList.includes(trimmed) ||
            allowListLower.includes(lowerTo) ||
            (lowerTo.startsWith("@") && allowListLower.includes(lowerTo.slice(1))) ||
            (!lowerTo.startsWith("@") && allowListLower.includes(`@${lowerTo}`));

          if (isAllowed) {
            return { ok: true, to: trimmed };
          }
          if (allowList.length > 0) {
            return { ok: true, to: allowList[0] };
          }
          if (hasWildcard) {
            return { ok: true, to: trimmed };
          }
        }
        return { ok: true, to: trimmed };
      }

      if (allowList.length > 0) {
        return { ok: true, to: allowList[0] };
      }
      return {
        ok: false,
        error: missingTargetError("Telegram User", "<chatId> or allowFrom[0]"),
      };
    },
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveTelegramUserAccount({ cfg, accountId: accountId ?? undefined });
      const result = await sendTelegramUserMessage({ to, text, account });
      return { channel: "telegram-user", ...result };
    },
    sendMedia: async () => {
      throw new Error("telegram-user media send not implemented");
    },
  };
}
