import { describe, expect, it, vi } from "vitest";

const createTelegramDraftStream = vi.hoisted(() => vi.fn());

vi.mock("../auto-reply/chunk.js", () => ({
  resolveChunkMode: () => "length",
}));

vi.mock("../auto-reply/reply/provider-dispatcher.js", () => ({
  dispatchReplyWithBufferedBlockDispatcher: async ({
    replyOptions,
  }: {
    replyOptions: { onPartialReply?: (payload: { text?: string }) => void };
  }) => {
    // Drive the draft stream via partial reply streaming.
    replyOptions.onPartialReply?.({ text: "hi" });
    return { queuedFinal: false };
  },
}));

vi.mock("../channels/reply-prefix.js", () => ({
  createReplyPrefixContext: () => ({
    responsePrefix: "",
    responsePrefixContextProvider: () => "",
    onModelSelected: () => {},
  }),
}));

vi.mock("../channels/typing.js", () => ({
  createTypingCallbacks: () => ({
    onReplyStart: () => {},
  }),
}));

vi.mock("../config/markdown-tables.js", () => ({
  resolveMarkdownTableMode: () => "off",
}));

vi.mock("../globals.js", () => ({
  danger: (x: string) => x,
  logVerbose: () => {},
}));

vi.mock("./draft-stream.js", () => ({
  createTelegramDraftStream,
}));

import { dispatchTelegramMessage } from "./bot-message-dispatch.js";

describe("telegram draft streaming (sendMessageDraft)", () => {
  it("streams drafts in private chats without requiring a thread id, and disables after unsupported", async () => {
    // First call: supported => draft stream created and partial reply triggers an "unsupported" callback.
    let supported = true;
    const resolveDraftStreamingSupported = () => supported;
    const markDraftStreamingUnsupported = () => {
      supported = false;
    };

    createTelegramDraftStream.mockImplementation(
      (params: { messageThreadId?: number; onUnsupported?: (err: unknown) => void }) => ({
        update: () => {
          params.onUnsupported?.(new Error("Call to 'sendMessageDraft' failed! (404: Not Found)"));
        },
        flush: async () => {},
        stop: () => {},
      }),
    );

    const base = {
      context: {
        ctxPayload: {},
        msg: { chat: { type: "private" }, message_id: 111 },
        chatId: 123,
        isGroup: false,
        resolvedThreadId: undefined,
        historyKey: undefined,
        historyLimit: 0,
        groupHistories: new Map(),
        route: { agentId: "main", accountId: "default" },
        skillFilter: undefined,
        sendTyping: async () => {},
        sendRecordVoice: async () => {},
        ackReactionPromise: undefined,
        reactionApi: undefined,
        removeAckAfterReply: false,
      },
      bot: { api: {} },
      cfg: {},
      runtime: { error: () => {} },
      replyToMode: "first",
      streamMode: "partial",
      textLimit: 4096,
      telegramCfg: {},
      opts: { token: "tok" },
      resolveDraftStreamingSupported,
      markDraftStreamingUnsupported,
    };

    await dispatchTelegramMessage(base);
    expect(createTelegramDraftStream).toHaveBeenCalledTimes(1);
    expect(createTelegramDraftStream.mock.calls[0]?.[0]?.messageThreadId).toBeUndefined();

    // Second call: auto-disabled => no draft stream created.
    await dispatchTelegramMessage(base);
    expect(createTelegramDraftStream).toHaveBeenCalledTimes(1);
  });
});
