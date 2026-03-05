import { describe, expect, it } from "vitest";
import { coerceFailoverErrorFromPayloads } from "./failover-from-payloads.js";

describe("coerceFailoverErrorFromPayloads", () => {
  it("returns FailoverError for failover-worthy error payloads (429)", () => {
    const err = coerceFailoverErrorFromPayloads({
      provider: "openai",
      model: "gpt-4.1-mini",
      payloads: [
        {
          isError: true,
          text: "Summarization failed: 429 API key token limit exceeded: weekly limit reached",
        },
      ],
    });
    expect(err?.name).toBe("FailoverError");
    expect(err?.reason).toBe("rate_limit");
  });

  it("returns null when payload is not marked as error", () => {
    const err = coerceFailoverErrorFromPayloads({
      provider: "openai",
      model: "gpt-4.1-mini",
      payloads: [{ text: "429 too many requests", isError: false }],
    });
    expect(err).toBeNull();
  });

  it("returns null for non-failover error payloads", () => {
    const err = coerceFailoverErrorFromPayloads({
      provider: "openai",
      model: "gpt-4.1-mini",
      payloads: [{ text: "Some random error", isError: true }],
    });
    expect(err).toBeNull();
  });

  it("returns null when there is non-error content alongside error payloads", () => {
    const err = coerceFailoverErrorFromPayloads({
      provider: "openai",
      model: "gpt-4.1-mini",
      payloads: [{ text: "⚠️ 429 too many requests", isError: true }, { text: "Normal reply" }],
    });
    expect(err).toBeNull();
  });
});
