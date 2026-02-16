import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

import { compressExecOutput } from "./src/compress.js";
import { isRtkAvailable } from "./src/detect.js";
import { RTK_PROMPT_INSTRUCTIONS } from "./src/prompt.js";

/** Tool names whose output should be compressed by tool_result_persist. */
const COMPRESSIBLE_TOOLS = new Set(["exec", "bash", "shell", "terminal", "command"]);

type RtkConfig = {
  enabled?: boolean;
  promptInjection?: boolean;
  persistCompression?: boolean;
};

const rtkPlugin = {
  id: "rtk",
  name: "RTK (Rust Token Killer)",
  description: "Shell output compression via RTK for token savings",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" as const },
      promptInjection: { type: "boolean" as const },
      persistCompression: { type: "boolean" as const },
    },
  },

  register(api: ClawdbotPluginApi) {
    const cfg: RtkConfig = (api.pluginConfig as RtkConfig) ?? {};

    // Master switch (default: true)
    if (cfg.enabled === false) {
      api.logger.info?.("rtk: disabled via config");
      return;
    }

    const rtkAvailable = isRtkAvailable();
    api.logger.info?.(`rtk: binary ${rtkAvailable ? "found" : "not found"} in PATH`);

    // Hook 1: Inject RTK instructions into agent prompt
    if (cfg.promptInjection !== false && rtkAvailable) {
      api.on("before_agent_start", () => {
        return { prependContext: RTK_PROMPT_INSTRUCTIONS };
      });
      api.logger.info?.("rtk: registered before_agent_start hook (prompt injection)");
    }

    // Hook 2: Compress exec output before persisting to session
    if (cfg.persistCompression !== false) {
      api.on("tool_result_persist", (event) => {
        if (!event.toolName || !COMPRESSIBLE_TOOLS.has(event.toolName)) return;

        const msg = event.message as Record<string, unknown>;
        const content = msg.content;
        if (typeof content !== "string" || content.length < 200) return;

        const compressed = compressExecOutput(content);
        if (compressed === content) return;

        return { message: { ...msg, content: compressed } as typeof event.message };
      });
      api.logger.info?.("rtk: registered tool_result_persist hook (output compression)");
    }
  },
};

export default rtkPlugin;
