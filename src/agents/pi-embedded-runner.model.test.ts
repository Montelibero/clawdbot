import { describe, expect, it } from "vitest";

import type { ClawdbotConfig } from "../config/config.js";
import { resolveModel } from "./pi-embedded-runner/model.js";

describe("resolveModel fallback provider config", () => {
  it("preserves provider baseUrl apiKey and headers on fallback models", () => {
    const cfg = {
      models: {
        providers: {
          custom: {
            api: "openai-completions",
            baseUrl: " https://router.example/v1 ",
            apiKey: " sk-test ",
            headers: {
              "X-Test": "1",
            },
            models: [],
          },
        },
      },
    } as ClawdbotConfig;

    const result = resolveModel("custom", "free_combo", undefined, cfg);

    expect(result.error).toBeUndefined();
    expect(result.model).toMatchObject({
      provider: "custom",
      id: "free_combo",
      api: "openai-completions",
      baseUrl: "https://router.example/v1",
      apiKey: "sk-test",
      headers: {
        "X-Test": "1",
      },
    });
  });
});
