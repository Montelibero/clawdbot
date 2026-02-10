import { describe, expect, it } from "vitest";

import { getChannelDock } from "./dock.js";

describe("telegram dock threading toolContext", () => {
  it("does not treat ReplyToId as a thread id", () => {
    const dock = getChannelDock("telegram");
    expect(dock?.id).toBe("telegram");

    const ctx = dock?.threading?.buildToolContext?.({
      context: {
        To: "telegram:123",
        ReplyToId: "999", // reply_to_message_id
        // MessageThreadId intentionally omitted
      } as any,
      hasRepliedRef: undefined,
    });

    expect(ctx?.currentThreadTs).toBeUndefined();
  });

  it("uses MessageThreadId as the thread id", () => {
    const dock = getChannelDock("telegram");
    const ctx = dock?.threading?.buildToolContext?.({
      context: {
        To: "telegram:123",
        MessageThreadId: 777,
      } as any,
      hasRepliedRef: undefined,
    });

    expect(ctx?.currentThreadTs).toBe("777");
  });
});
