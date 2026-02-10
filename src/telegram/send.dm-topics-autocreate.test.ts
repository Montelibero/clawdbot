import { beforeEach, describe, expect, it, vi } from "vitest";

const { botApi, botCtorSpy } = vi.hoisted(() => ({
  botApi: {
    sendMessage: vi.fn(),
    getChat: vi.fn(),
    createForumTopic: vi.fn(),
  },
  botCtorSpy: vi.fn(),
}));

vi.mock("grammy", () => ({
  Bot: class {
    api = botApi;
    constructor(
      public token: string,
      public options?: { client?: { fetch?: typeof fetch } },
    ) {
      botCtorSpy(token, options);
    }
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

  it("auto-creates a forum topic in DM when chat is_forum and threadId missing", async () => {
    const chatId = "123456"; // positive numeric => DM

    botApi.getChat.mockResolvedValueOnce({ id: Number(chatId), is_forum: true });
    botApi.createForumTopic.mockResolvedValueOnce({ message_thread_id: 777 });
    botApi.sendMessage.mockResolvedValueOnce({ message_id: 60, chat: { id: chatId } });

    await sendMessageTelegram(chatId, "hi", {
      token: "tok",
      api: botApi as unknown as any,
    });

    expect(botApi.getChat).toHaveBeenCalledWith(chatId);
    expect(botApi.createForumTopic).toHaveBeenCalledWith(chatId, expect.any(String));
    expect(botApi.sendMessage).toHaveBeenCalledWith(chatId, "hi", {
      parse_mode: "HTML",
      message_thread_id: 777,
      link_preview_options: { is_disabled: true },
    });
  });

  it("does not auto-create topic when chat is not forum", async () => {
    const chatId = "123456";

    botApi.getChat.mockResolvedValueOnce({ id: Number(chatId), is_forum: false });
    botApi.sendMessage.mockResolvedValueOnce({ message_id: 60, chat: { id: chatId } });

    await sendMessageTelegram(chatId, "hi", {
      token: "tok",
      api: botApi as unknown as any,
    });

    expect(botApi.getChat).toHaveBeenCalledWith(chatId);
    expect(botApi.createForumTopic).not.toHaveBeenCalled();
    expect(botApi.sendMessage).toHaveBeenCalled();
  });

  it("does not auto-create topic for non-DM chat ids", async () => {
    const chatId = "-1001234567890"; // group/supergroup

    botApi.sendMessage.mockResolvedValueOnce({ message_id: 60, chat: { id: chatId } });

    await sendMessageTelegram(chatId, "hi", {
      token: "tok",
      api: botApi as unknown as any,
    });

    expect(botApi.getChat).not.toHaveBeenCalled();
    expect(botApi.createForumTopic).not.toHaveBeenCalled();
    expect(botApi.sendMessage).toHaveBeenCalled();
  });
});
