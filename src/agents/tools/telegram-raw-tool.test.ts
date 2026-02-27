import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClawdbotConfig } from "../../config/config.js";
import { createTelegramRawTool } from "./telegram-raw-tool.js";

const { botApi, botCtor } = vi.hoisted(() => {
  const api: Record<string, unknown> = {};
  const ctor = vi.fn();
  return { botApi: api, botCtor: ctor };
});

vi.mock("grammy", () => ({
  Bot: class {
    api = botApi;
    constructor(token: string) {
      botCtor(token);
    }
  },
}));

describe("createTelegramRawTool", () => {
  beforeEach(() => {
    for (const key of Object.keys(botApi)) {
      delete botApi[key];
    }
    botCtor.mockClear();
  });

  it("requires acknowledgeRisk=true", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", allowRawApi: true } },
    } as ClawdbotConfig;
    const tool = createTelegramRawTool({ config: cfg });
    await expect(
      tool.execute("1", {
        action: "callApi",
        apiMethod: "sendMessage",
        args: ["123", "hi"],
      }),
    ).rejects.toThrow(/acknowledgeRisk=true is required/);
  });

  it("respects allowRawApi gating", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", allowRawApi: false } },
    } as ClawdbotConfig;
    const tool = createTelegramRawTool({ config: cfg });
    await expect(
      tool.execute("1", {
        action: "callApi",
        acknowledgeRisk: true,
        apiMethod: "sendMessage",
        args: ["123", "hi"],
      }),
    ).rejects.toThrow(/Raw Telegram Bot API access is disabled/);
  });

  it("fails for unknown methods", async () => {
    const cfg = {
      channels: { telegram: { botToken: "tok", allowRawApi: true } },
    } as ClawdbotConfig;
    const tool = createTelegramRawTool({ config: cfg });
    await expect(
      tool.execute("1", {
        action: "callApi",
        acknowledgeRisk: true,
        apiMethod: "notRealMethod",
      }),
    ).rejects.toThrow(/Unknown Telegram Bot API method/);
  });

  it("calls bot.api methods with args", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 77 }));
    botApi.sendMessage = sendMessage;
    const cfg = {
      channels: { telegram: { botToken: "tok", allowRawApi: true } },
    } as ClawdbotConfig;
    const tool = createTelegramRawTool({ config: cfg });

    const result = await tool.execute("1", {
      action: "callApi",
      acknowledgeRisk: true,
      apiMethod: "sendMessage",
      args: ["123", "hello"],
    });

    expect(botCtor).toHaveBeenCalledWith("tok");
    expect(sendMessage).toHaveBeenCalledWith("123", "hello");
    expect(result.content).toContainEqual({
      type: "text",
      text: expect.stringContaining('"ok": true'),
    });
  });
});
