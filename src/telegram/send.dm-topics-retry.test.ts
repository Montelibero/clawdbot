import { beforeEach, describe, expect, it, vi } from "vitest";

const { botApi } = vi.hoisted(() => ({
  botApi: {
    sendMessage: vi.fn(),
    getChat: vi.fn(),
    createForumTopic: vi.fn(),
  },
}));

vi.mock("grammy", () => ({
  Bot: class {
    api = botApi;
    constructor(
      public token: string,
      public options?: { client?: { fetch?: typeof fetch } },
    ) {}
  },
  InputFile: class {},
  HttpError: class extends Error {},
}));

import { sendMessageTelegram } from "./send.js";

describe("sendMessageTelegram", () => {
  beforeEach(() => {
    botApi.sendMessage.mockReset();
    botApi.getChat.mockReset();
    botApi.createForumTopic.mockReset();
  });

  it("retries by creating a topic when Telegram returns message thread not found", async () => {
    const chatId = "123456";

    // First attempt: no thread. Simulate Telegram rejecting the send.
    botApi.sendMessage.mockRejectedValueOnce(
      new Error("400: Bad Request: message thread not found"),
    );
    // Initial missing_thread check: pretend DM is not forum so no pre-create occurs.
    botApi.getChat.mockResolvedValueOnce({ id: Number(chatId), is_forum: false });
    // Retry path: now pretend DM is forum.
    botApi.getChat.mockResolvedValueOnce({ id: Number(chatId), is_forum: true });
    botApi.createForumTopic.mockResolvedValueOnce({ message_thread_id: 888 });
    botApi.sendMessage.mockResolvedValueOnce({ message_id: 60, chat: { id: chatId } });

    await sendMessageTelegram(chatId, "hi", {
      token: "tok",
      api: botApi as unknown as any,
    });

    expect(botApi.sendMessage).toHaveBeenCalledTimes(2);
    // Retry should include the created thread id.
    expect(botApi.sendMessage).toHaveBeenNthCalledWith(
      2,
      chatId,
      expect.any(String),
      expect.objectContaining({ message_thread_id: 888 }),
    );
  });
});
