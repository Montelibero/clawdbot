import type { ChannelOutboundAdapter } from "clawdbot/plugin-sdk";

import { resolveTelegramUserAccount } from "./accounts.js";
import { sendTelegramUserMessage } from "./send.js";

export function createTelegramUserOutboundAdapter(): ChannelOutboundAdapter {
  return {
    deliveryMode: "direct",
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
