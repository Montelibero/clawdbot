// Lazy-load pi-coding-agent model metadata so we can infer context windows when
// the agent reports a model id. This includes custom models.json entries.

import { loadConfig } from "../config/config.js";
import { resolveClawdbotAgentDir } from "./agent-paths.js";
import { ensureClawdbotModelsJson } from "./models-config.js";

type ModelEntry = { id: string; contextWindow?: number };

const MODEL_CACHE = new Map<string, number>();
const loadPromise = (async () => {
  try {
    const { AuthStorage, ModelRegistry } = await import("@mariozechner/pi-coding-agent");
    const path = await import("node:path");
    const cfg = loadConfig();
    await ensureClawdbotModelsJson(cfg);
    const agentDir = resolveClawdbotAgentDir();
    const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
    const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
    const models = modelRegistry.getAll() as ModelEntry[];
    for (const m of models) {
      if (!m?.id) continue;
      if (typeof m.contextWindow === "number" && m.contextWindow > 0) {
        MODEL_CACHE.set(m.id, m.contextWindow);
      }
    }
  } catch {
    // If pi-ai isn't available, leave cache empty; lookup will fall back.
  }
})();

export function lookupContextTokens(modelId?: string): number | undefined {
  if (!modelId) return undefined;
  // Best-effort: kick off loading, but don't block.
  void loadPromise;
  return MODEL_CACHE.get(modelId);
}
