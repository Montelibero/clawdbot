import type { AgentTool } from "@mariozechner/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toToolDefinitions } from "./pi-tool-definition-adapter.js";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../plugins/hook-runner-global.js";
import type { PluginRegistry } from "../plugins/registry.js";

function makeTool(
  name: string,
  fn: (...args: unknown[]) => Promise<unknown>,
): AgentTool<unknown, unknown> {
  return { name, label: name, description: name, parameters: {}, execute: fn as any };
}

function makeRegistry(typedHooks: PluginRegistry["typedHooks"] = []): PluginRegistry {
  return {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks,
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
}

describe("pi tool definition adapter", () => {
  afterEach(() => {
    resetGlobalHookRunner();
  });

  it("wraps tool errors into a tool result", async () => {
    const tool = {
      name: "boom",
      label: "Boom",
      description: "throws",
      parameters: {},
      execute: async () => {
        throw new Error("nope");
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call1", {}, undefined, undefined);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "boom",
    });
    expect(result.details).toMatchObject({ error: "nope" });
    expect(JSON.stringify(result.details)).not.toContain("\n    at ");
  });

  it("normalizes exec tool aliases in error results", async () => {
    const tool = {
      name: "bash",
      label: "Bash",
      description: "throws",
      parameters: {},
      execute: async () => {
        throw new Error("nope");
      },
    } satisfies AgentTool<unknown, unknown>;

    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call2", {}, undefined, undefined);

    expect(result.details).toMatchObject({
      status: "error",
      tool: "exec",
      error: "nope",
    });
  });

  it("calls before_tool_call and after_tool_call hooks", async () => {
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();

    const registry = makeRegistry([
      { pluginId: "test", hookName: "before_tool_call", handler: beforeHandler, source: "test" },
      { pluginId: "test", hookName: "after_tool_call", handler: afterHandler, source: "test" },
    ]);
    initializeGlobalHookRunner(registry);

    const tool = makeTool("greet", async () => ({ text: "hello" }));
    const defs = toToolDefinitions([tool]);
    await defs[0].execute("call-1", { name: "world" }, undefined, undefined);

    expect(beforeHandler).toHaveBeenCalledOnce();
    expect(beforeHandler.mock.calls[0][0]).toMatchObject({
      toolName: "greet",
      params: { name: "world" },
    });

    expect(afterHandler).toHaveBeenCalledOnce();
    expect(afterHandler.mock.calls[0][0]).toMatchObject({
      toolName: "greet",
      params: { name: "world" },
    });
    expect(afterHandler.mock.calls[0][0].durationMs).toBeTypeOf("number");
  });

  it("blocks tool execution via before_tool_call", async () => {
    const beforeHandler = vi.fn().mockReturnValue({ block: true, blockReason: "nope" });
    const afterHandler = vi.fn();

    const registry = makeRegistry([
      { pluginId: "test", hookName: "before_tool_call", handler: beforeHandler, source: "test" },
      { pluginId: "test", hookName: "after_tool_call", handler: afterHandler, source: "test" },
    ]);
    initializeGlobalHookRunner(registry);

    const executeFn = vi.fn(async () => ({ ok: true }));
    const tool = makeTool("secret", executeFn);
    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call-2", {}, undefined, undefined);

    expect(result.details).toMatchObject({ status: "blocked", reason: "nope" });
    expect(executeFn).not.toHaveBeenCalled();
    expect(afterHandler).not.toHaveBeenCalled();
  });

  it("modifies params via before_tool_call", async () => {
    const beforeHandler = vi.fn().mockReturnValue({ params: { injected: true } });

    const registry = makeRegistry([
      { pluginId: "test", hookName: "before_tool_call", handler: beforeHandler, source: "test" },
    ]);
    initializeGlobalHookRunner(registry);

    const executeFn = vi.fn(async (_id: string, params: unknown) => params);
    const tool = makeTool("echo", executeFn);
    const defs = toToolDefinitions([tool]);
    await defs[0].execute("call-3", { original: true }, undefined, undefined);

    expect(executeFn).toHaveBeenCalledOnce();
    expect(executeFn.mock.calls[0][1]).toEqual({ injected: true });
  });

  it("calls after_tool_call with error on tool failure", async () => {
    const afterHandler = vi.fn();

    const registry = makeRegistry([
      { pluginId: "test", hookName: "after_tool_call", handler: afterHandler, source: "test" },
    ]);
    initializeGlobalHookRunner(registry);

    const tool = makeTool("fail", async () => {
      throw new Error("boom");
    });
    const defs = toToolDefinitions([tool]);
    const result = await defs[0].execute("call-4", { x: 1 }, undefined, undefined);

    expect(result.details).toMatchObject({ status: "error", error: "boom" });
    expect(afterHandler).toHaveBeenCalledOnce();
    expect(afterHandler.mock.calls[0][0]).toMatchObject({
      toolName: "fail",
      error: "boom",
    });
    expect(afterHandler.mock.calls[0][0].durationMs).toBeTypeOf("number");
  });

  it("passes toolCallId in hook context", async () => {
    const beforeHandler = vi.fn();

    const registry = makeRegistry([
      { pluginId: "test", hookName: "before_tool_call", handler: beforeHandler, source: "test" },
    ]);
    initializeGlobalHookRunner(registry);

    const tool = makeTool("ping", async () => "pong");
    const defs = toToolDefinitions([tool]);
    await defs[0].execute("my-call-id", {}, undefined, undefined);

    const ctx = beforeHandler.mock.calls[0][1];
    expect(ctx).toMatchObject({ toolName: "ping", toolCallId: "my-call-id" });
  });
});
