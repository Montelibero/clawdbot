import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEntry } from "../../config/sessions.js";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();
const runWithModelFallbackMock = vi.fn();
const routeReplyMock = vi.fn(async () => ({ ok: true }));

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: (params: {
    provider: string;
    model: string;
    run: (provider: string, model: string) => Promise<unknown>;
  }) => runWithModelFallbackMock(params),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return {
    ...actual,
    enqueueFollowupRun: vi.fn(),
    scheduleFollowupDrain: vi.fn(),
  };
});

vi.mock("./route-reply.js", async () => {
  const actual = await vi.importActual<typeof import("./route-reply.js")>("./route-reply.js");
  return {
    ...actual,
    routeReply: (params: unknown) => routeReplyMock(params),
  };
});

import { runReplyAgent } from "./agent-runner.js";

function createRun(params: {
  responseUsage: "tokens" | "full";
  sessionKey: string;
  runOverrides?: Partial<FollowupRun["run"]>;
  followupOverrides?: Partial<FollowupRun>;
}) {
  const typing = createMockTypingController();
  const sessionCtx = {
    Provider: "whatsapp",
    OriginatingTo: "+15550001111",
    AccountId: "primary",
    MessageSid: "msg",
  } as unknown as TemplateContext;
  const resolvedQueue = { mode: "interrupt" } as unknown as QueueSettings;

  const sessionEntry: SessionEntry = {
    sessionId: "session",
    updatedAt: Date.now(),
    responseUsage: params.responseUsage,
  };

  const followupRun = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    run: {
      agentId: "main",
      agentDir: "/tmp/agent",
      sessionId: "session",
      sessionKey: params.sessionKey,
      messageProvider: "whatsapp",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
      ownerNumbers: [],
      ...params.runOverrides,
    },
    ...params.followupOverrides,
  } as unknown as FollowupRun;

  return runReplyAgent({
    commandBody: "hello",
    followupRun,
    queueKey: "main",
    resolvedQueue,
    shouldSteer: false,
    shouldFollowup: false,
    isActive: false,
    isStreaming: false,
    typing,
    sessionCtx,
    sessionEntry,
    sessionKey: params.sessionKey,
    defaultModel: "anthropic/claude-opus-4-5",
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
  });
}

describe("runReplyAgent response usage footer", () => {
  beforeEach(() => {
    runEmbeddedPiAgentMock.mockReset();
    runWithModelFallbackMock.mockReset();
    routeReplyMock.mockClear();
  });

  it("appends session key when responseUsage=full", async () => {
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "ok" }],
      meta: {
        agentMeta: {
          provider: "anthropic",
          model: "claude",
          usage: { input: 12, output: 3 },
        },
      },
    });
    runWithModelFallbackMock.mockImplementationOnce(
      async ({ run }: { run: (provider: string, model: string) => Promise<unknown> }) => ({
        result: await run("anthropic", "claude"),
        provider: "anthropic",
        model: "claude",
      }),
    );

    const sessionKey = "agent:main:whatsapp:dm:+1000";
    const res = await createRun({ responseUsage: "full", sessionKey });
    const payload = Array.isArray(res) ? res[0] : res;
    expect(String(payload?.text ?? "")).toContain("Usage:");
    expect(String(payload?.text ?? "")).toContain(`· session ${sessionKey}`);
  });

  it("does not append session key when responseUsage=tokens", async () => {
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "ok" }],
      meta: {
        agentMeta: {
          provider: "anthropic",
          model: "claude",
          usage: { input: 12, output: 3 },
        },
      },
    });
    runWithModelFallbackMock.mockImplementationOnce(
      async ({ run }: { run: (provider: string, model: string) => Promise<unknown> }) => ({
        result: await run("anthropic", "claude"),
        provider: "anthropic",
        model: "claude",
      }),
    );

    const sessionKey = "agent:main:whatsapp:dm:+1000";
    const res = await createRun({ responseUsage: "tokens", sessionKey });
    const payload = Array.isArray(res) ? res[0] : res;
    expect(String(payload?.text ?? "")).toContain("Usage:");
    expect(String(payload?.text ?? "")).not.toContain("· session ");
  });

  it("retries the fallback model when embedded run returns only failover metadata", async () => {
    runEmbeddedPiAgentMock
      .mockResolvedValueOnce({
        meta: {
          stopReason: "error",
          errorMessage: "429 API key token limit exceeded: daily limit reached",
          agentMeta: { provider: "custom", model: "default_combo" },
        },
      })
      .mockResolvedValueOnce({
        payloads: [{ text: "fallback ok" }],
        meta: {
          agentMeta: { provider: "custom", model: "free_combo" },
        },
      });
    runWithModelFallbackMock.mockImplementationOnce(
      async ({ run }: { run: (provider: string, model: string) => Promise<unknown> }) => {
        try {
          await run("custom", "default_combo");
        } catch {
          // metadata-only failover should still advance to the next candidate
        }
        return {
          result: await run("custom", "free_combo"),
          provider: "custom",
          model: "free_combo",
        };
      },
    );

    const sessionKey = "agent:main:whatsapp:dm:+1000";
    const res = await createRun({ responseUsage: "tokens", sessionKey });
    const payload = Array.isArray(res) ? res[0] : res;

    expect(runEmbeddedPiAgentMock).toHaveBeenCalledTimes(2);
    expect(runEmbeddedPiAgentMock.mock.calls[0]?.[0]?.model).toBe("default_combo");
    expect(runEmbeddedPiAgentMock.mock.calls[1]?.[0]?.model).toBe("free_combo");
    expect(String(payload?.text ?? "")).toContain("fallback ok");
  });

  it("notifies owners and suppresses the origin reply for metadata-only rate-limit failures", async () => {
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      meta: {
        stopReason: "error",
        errorMessage: "429 API key token limit exceeded: daily limit reached",
        agentMeta: { provider: "custom", model: "default_combo" },
      },
    });
    runWithModelFallbackMock.mockImplementationOnce(
      async ({ run }: { run: (provider: string, model: string) => Promise<unknown> }) => {
        await run("custom", "default_combo");
        throw new Error("unreachable");
      },
    );

    const sessionKey = "agent:main:whatsapp:dm:+1000";
    const res = await createRun({
      responseUsage: "tokens",
      sessionKey,
      runOverrides: {
        ownerNumbers: ["owner:1"],
        provider: "custom",
        model: "default_combo",
      },
      followupOverrides: { originatingIsOwnerSender: false },
    });

    expect(res).toBeUndefined();
    expect(routeReplyMock).toHaveBeenCalledTimes(1);
    const call = routeReplyMock.mock.calls[0]?.[0] as {
      to?: string;
      payload?: { text?: string };
    };
    expect(call.to).toBe("owner:1");
    expect(call.payload?.text ?? "").toContain("Clawdbot alert");
    expect(call.payload?.text ?? "").toContain("429 API key token limit exceeded");
  });
});
