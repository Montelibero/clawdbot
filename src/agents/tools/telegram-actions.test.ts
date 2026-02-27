import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClawdbotConfig } from "../../config/config.js";
import { handleTelegramAction, readTelegramButtons } from "./telegram-actions.js";

const telegramMocks = vi.hoisted(() => ({
  reactMessageTelegram: vi.fn(async () => ({ ok: true })),
  sendMessageTelegram: vi.fn(async () => ({
    messageId: "789",
    chatId: "123",
  })),
  editMessageTelegram: vi.fn(async () => ({ ok: true })),
  deleteMessageTelegram: vi.fn(async () => ({ ok: true })),
}));
const originalToken = process.env.TELEGRAM_BOT_TOKEN;

vi.mock("../../telegram/send.js", () => ({
  reactMessageTelegram: telegramMocks.reactMessageTelegram,
  sendMessageTelegram: telegramMocks.sendMessageTelegram,
  editMessageTelegram: telegramMocks.editMessageTelegram,
  deleteMessageTelegram: telegramMocks.deleteMessageTelegram,
}));

describe("handleTelegramAction", () => {
  beforeEach(() => {
    telegramMocks.reactMessageTelegram.mockClear();
    telegramMocks.sendMessageTelegram.mockClear();
    telegramMocks.editMessageTelegram.mockClear();
    telegramMocks.deleteMessageTelegram.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "tok";
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  });

  it("adds reactions when reactionLevel is minimal", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", reactionLevel: "minimal" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "react",
        chatId: "123",
        messageId: "456",
        emoji: "✅",
      },
      cfg,
    );
    expect(telegramMocks.reactMessageTelegram).toHaveBeenCalledWith(
      "123",
      456,
      "✅",
      expect.objectContaining({ token: "tok", remove: false }),
    );
  });

  it("adds reactions when reactionLevel is extensive", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", reactionLevel: "extensive" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "react",
        chatId: "123",
        messageId: "456",
        emoji: "✅",
      },
      cfg,
    );
    expect(telegramMocks.reactMessageTelegram).toHaveBeenCalledWith(
      "123",
      456,
      "✅",
      expect.objectContaining({ token: "tok", remove: false }),
    );
  });

  it("removes reactions on empty emoji", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", reactionLevel: "minimal" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "react",
        chatId: "123",
        messageId: "456",
        emoji: "",
      },
      cfg,
    );
    expect(telegramMocks.reactMessageTelegram).toHaveBeenCalledWith(
      "123",
      456,
      "",
      expect.objectContaining({ token: "tok", remove: false }),
    );
  });

  it("removes reactions when remove flag set", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", reactionLevel: "extensive" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "react",
        chatId: "123",
        messageId: "456",
        emoji: "✅",
        remove: true,
      },
      cfg,
    );
    expect(telegramMocks.reactMessageTelegram).toHaveBeenCalledWith(
      "123",
      456,
      "✅",
      expect.objectContaining({ token: "tok", remove: true }),
    );
  });

  it("blocks reactions when reactionLevel is off", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", reactionLevel: "off" } },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "react",
          chatId: "123",
          messageId: "456",
          emoji: "✅",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram agent reactions disabled.*reactionLevel="off"/);
  });

  it("blocks reactions when reactionLevel is ack", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", reactionLevel: "ack" } },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "react",
          chatId: "123",
          messageId: "456",
          emoji: "✅",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram agent reactions disabled.*reactionLevel="ack"/);
  });

  it("also respects legacy actions.reactions gating", async () => {
    const cfg = {
      channels: {
        telegram: {
          botToken: "tok",
          reactionLevel: "minimal",
          actions: { reactions: false },
        },
      },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "react",
          chatId: "123",
          messageId: "456",
          emoji: "✅",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram reactions are disabled via actions.reactions/);
  });

  it("sends a text message", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok" } },
    } as ClawdbotConfig;
    const result = await handleTelegramAction(
      {
        action: "sendMessage",
        to: "@testchannel",
        content: "Hello, Telegram!",
      },
      cfg,
    );
    expect(telegramMocks.sendMessageTelegram).toHaveBeenCalledWith(
      "@testchannel",
      "Hello, Telegram!",
      expect.objectContaining({ token: "tok", mediaUrl: undefined }),
    );
    expect(result.content).toContainEqual({
      type: "text",
      text: expect.stringContaining('"ok": true'),
    });
  });

  it("sends a message with media", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "123456",
        content: "Check this image!",
        mediaUrl: "https://example.com/image.jpg",
      },
      cfg,
    );
    expect(telegramMocks.sendMessageTelegram).toHaveBeenCalledWith(
      "123456",
      "Check this image!",
      expect.objectContaining({
        token: "tok",
        mediaUrl: "https://example.com/image.jpg",
      }),
    );
  });

  it("allows media-only messages without content", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "123456",
        mediaUrl: "https://example.com/note.ogg",
      },
      cfg,
    );
    expect(telegramMocks.sendMessageTelegram).toHaveBeenCalledWith(
      "123456",
      "",
      expect.objectContaining({
        token: "tok",
        mediaUrl: "https://example.com/note.ogg",
      }),
    );
  });

  it("requires content when no mediaUrl is provided", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok" } },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "sendMessage",
          to: "123456",
        },
        cfg,
      ),
    ).rejects.toThrow(/content required/i);
  });

  it("respects sendMessage gating", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", actions: { sendMessage: false } },
      },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "sendMessage",
          to: "@testchannel",
          content: "Hello!",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram sendMessage is disabled/);
  });

  it("deletes a message", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "deleteMessage",
        chatId: "123",
        messageId: 456,
      },
      cfg,
    );
    expect(telegramMocks.deleteMessageTelegram).toHaveBeenCalledWith(
      "123",
      456,
      expect.objectContaining({ token: "tok" }),
    );
  });

  it("edits a message", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "editMessage",
        chatId: "123",
        messageId: 456,
        content: "updated",
      },
      cfg,
    );
    expect(telegramMocks.editMessageTelegram).toHaveBeenCalledWith(
      "123",
      456,
      "updated",
      expect.objectContaining({ token: "tok" }),
    );
  });

  it("respects editMessage gating", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", actions: { editMessage: false } },
      },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "editMessage",
          chatId: "123",
          messageId: 456,
          content: "updated",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram editMessage is disabled/);
  });

  it("respects deleteMessage gating", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", actions: { deleteMessage: false } },
      },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "deleteMessage",
          chatId: "123",
          messageId: 456,
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram deleteMessage is disabled/);
  });

  it("throws on missing bot token for sendMessage", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const cfg = {} as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "sendMessage",
          to: "@testchannel",
          content: "Hello!",
        },
        cfg,
      ),
    ).rejects.toThrow(/Telegram bot token missing/);
  });

  it("allows inline buttons by default (allowlist)", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok" } },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "@testchannel",
        content: "Choose",
        buttons: [[{ text: "Ok", callback_data: "cmd:ok" }]],
      },
      cfg,
    );
    expect(telegramMocks.sendMessageTelegram).toHaveBeenCalled();
  });

  it("blocks inline buttons when scope is off", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", capabilities: { inlineButtons: "off" } },
      },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "sendMessage",
          to: "@testchannel",
          content: "Choose",
          buttons: [[{ text: "Ok", callback_data: "cmd:ok" }]],
        },
        cfg,
      ),
    ).rejects.toThrow(/inline buttons are disabled/i);
  });

  it("blocks inline buttons in groups when scope is dm", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", capabilities: { inlineButtons: "dm" } },
      },
    } as ClawdbotConfig;
    await expect(
      handleTelegramAction(
        {
          action: "sendMessage",
          to: "-100123456",
          content: "Choose",
          buttons: [[{ text: "Ok", callback_data: "cmd:ok" }]],
        },
        cfg,
      ),
    ).rejects.toThrow(/inline buttons are limited to DMs/i);
  });

  it("allows inline buttons in DMs with tg: prefixed targets", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", capabilities: { inlineButtons: "dm" } },
      },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "tg:5232990709",
        content: "Choose",
        buttons: [[{ text: "Ok", callback_data: "cmd:ok" }]],
      },
      cfg,
    );
    expect(telegramMocks.sendMessageTelegram).toHaveBeenCalled();
  });

  it("allows inline buttons in groups with topic targets", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", capabilities: { inlineButtons: "group" } },
      },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "telegram:group:-1001234567890:topic:456",
        content: "Choose",
        buttons: [[{ text: "Ok", callback_data: "cmd:ok" }]],
      },
      cfg,
    );
    expect(telegramMocks.sendMessageTelegram).toHaveBeenCalled();
  });

  it("sends messages with inline keyboard buttons when enabled", async () => {
    const cfg = {
      channels: {
        telegram: { botToken: "tok", capabilities: { inlineButtons: "all" } },
      },
    } as ClawdbotConfig;
    await handleTelegramAction(
      {
        action: "sendMessage",
        to: "@testchannel",
        content: "Choose",
        buttons: [[{ text: "  Option A ", callback_data: " cmd:a " }]],
      },
      cfg,
    );
    expect(telegramMocks.sendMessageTelegram).toHaveBeenCalledWith(
      "@testchannel",
      "Choose",
      expect.objectContaining({
        buttons: [[{ text: "Option A", callback_data: "cmd:a" }]],
      }),
    );
  });
});

describe("readTelegramButtons", () => {
  it("returns trimmed button rows for valid input", () => {
    const result = readTelegramButtons({
      buttons: [[{ text: "  Option A ", callback_data: " cmd:a " }]],
    });
    expect(result).toEqual([[{ text: "Option A", callback_data: "cmd:a" }]]);
  });
});
