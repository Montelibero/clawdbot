import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ClientToolDefinition } from "./pi-embedded-runner/run/params.js";
import { logDebug, logError } from "../logger.js";
import { normalizeToolName } from "./tool-policy.js";
import { jsonResult } from "./tools/common.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";

// biome-ignore lint/suspicious/noExplicitAny: TypeBox schema type from pi-agent-core uses a different module instance.
type AnyAgentTool = AgentTool<any, unknown>;

function describeToolExecutionError(err: unknown): {
  message: string;
  stack?: string;
} {
  if (err instanceof Error) {
    const message = err.message?.trim() ? err.message : String(err);
    return { message, stack: err.stack };
  }
  return { message: String(err) };
}

export function toToolDefinitions(tools: AnyAgentTool[]): ToolDefinition[] {
  return tools.map((tool) => {
    const name = tool.name || "tool";
    const normalizedName = normalizeToolName(name);
    return {
      name,
      label: tool.label ?? name,
      description: tool.description ?? "",
      // biome-ignore lint/suspicious/noExplicitAny: TypeBox schema from pi-agent-core uses a different module instance.
      parameters: tool.parameters as any,
      execute: async (
        toolCallId,
        params,
        onUpdate: AgentToolUpdateCallback<unknown> | undefined,
        _ctx,
        signal,
      ): Promise<AgentToolResult<unknown>> => {
        // KNOWN: pi-coding-agent `ToolDefinition.execute` has a different signature/order
        // than pi-agent-core `AgentTool.execute`. This adapter keeps our existing tools intact.

        const hookRunner = getGlobalHookRunner();
        const toolCtx = { toolName: normalizedName, toolCallId };

        // Run before_tool_call hook
        if (hookRunner?.hasHooks("before_tool_call")) {
          try {
            const beforeResult = await hookRunner.runBeforeToolCall(
              { toolName: normalizedName, params: params as Record<string, unknown> },
              toolCtx,
            );

            // Check if tool should be blocked
            if (beforeResult?.block) {
              return jsonResult({
                status: "blocked",
                tool: normalizedName,
                reason: beforeResult.blockReason ?? "Blocked by plugin",
              });
            }

            // Apply modified params if provided
            if (beforeResult?.params) {
              params = beforeResult.params;
            }
          } catch (hookErr) {
            logError(`[hooks] before_tool_call failed for ${normalizedName}: ${String(hookErr)}`);
          }
        }

        const startTime = performance.now();
        try {
          const result = await tool.execute(toolCallId, params, signal, onUpdate);

          // Run after_tool_call hook
          if (hookRunner?.hasHooks("after_tool_call")) {
            try {
              await hookRunner.runAfterToolCall(
                {
                  toolName: normalizedName,
                  params: params as Record<string, unknown>,
                  result: result as unknown,
                  durationMs: Math.round(performance.now() - startTime),
                },
                toolCtx,
              );
            } catch (hookErr) {
              logError(`[hooks] after_tool_call failed for ${normalizedName}: ${String(hookErr)}`);
            }
          }

          return result;
        } catch (err) {
          if (signal?.aborted) throw err;
          const name =
            err && typeof err === "object" && "name" in err
              ? String((err as { name?: unknown }).name)
              : "";
          if (name === "AbortError") throw err;
          const described = describeToolExecutionError(err);
          if (described.stack && described.stack !== described.message) {
            logDebug(`tools: ${normalizedName} failed stack:\n${described.stack}`);
          }
          logError(`[tools] ${normalizedName} failed: ${described.message}`);

          const errorResult = jsonResult({
            status: "error",
            tool: normalizedName,
            error: described.message,
          });

          // Run after_tool_call hook for errors too
          if (hookRunner?.hasHooks("after_tool_call")) {
            try {
              await hookRunner.runAfterToolCall(
                {
                  toolName: normalizedName,
                  params: params as Record<string, unknown>,
                  result: errorResult as unknown,
                  error: described.message,
                  durationMs: Math.round(performance.now() - startTime),
                },
                toolCtx,
              );
            } catch (hookErr) {
              logError(`[hooks] after_tool_call failed for ${normalizedName}: ${String(hookErr)}`);
            }
          }

          return errorResult;
        }
      },
    } satisfies ToolDefinition;
  });
}

// Convert client tools (OpenResponses hosted tools) to ToolDefinition format
// These tools are intercepted to return a "pending" result instead of executing
export function toClientToolDefinitions(
  tools: ClientToolDefinition[],
  onClientToolCall?: (toolName: string, params: Record<string, unknown>) => void,
): ToolDefinition[] {
  return tools.map((tool) => {
    const func = tool.function;
    return {
      name: func.name,
      label: func.name,
      description: func.description ?? "",
      parameters: func.parameters as any,
      execute: async (
        toolCallId,
        params,
        _onUpdate: AgentToolUpdateCallback<unknown> | undefined,
        _ctx,
        _signal,
      ): Promise<AgentToolResult<unknown>> => {
        // Notify handler that a client tool was called
        if (onClientToolCall) {
          onClientToolCall(func.name, params as Record<string, unknown>);
        }
        // Return a pending result - the client will execute this tool
        return jsonResult({
          status: "pending",
          tool: func.name,
          message: "Tool execution delegated to client",
        });
      },
    } satisfies ToolDefinition;
  });
}
