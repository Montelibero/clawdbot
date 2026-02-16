import { describe, expect, it } from "vitest";

import { compressExecOutput } from "./compress.js";

describe("compressExecOutput", () => {
  it("returns short output unchanged", () => {
    const short = "hello world";
    expect(compressExecOutput(short)).toBe(short);
  });

  it("returns output under 200 chars unchanged", () => {
    const output = "line1\nline2\nline3\n";
    expect(compressExecOutput(output)).toBe(output);
  });

  it("strips test pass lines (checkmark)", () => {
    const lines = [
      "Test Suites: 1 passed, 1 total",
      ...Array.from({ length: 30 }, (_, i) => `  ✓ test case ${i} (${i}ms)`),
      "FAIL src/broken.test.ts",
      "  ✗ should work",
      "    Expected: true",
      "    Received: false",
    ];
    const output = lines.join("\n");
    const compressed = compressExecOutput(output);
    expect(compressed).not.toContain("✓ test case");
    expect(compressed).toContain("FAIL");
    expect(compressed).toContain("Expected: true");
  });

  it("strips PASS lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `PASS src/mod${i}.test.ts`);
    lines.push("FAIL src/broken.test.ts");
    lines.push("  Error: assertion failed");
    const output = lines.join("\n");
    const compressed = compressExecOutput(output);
    expect(compressed).not.toContain("PASS src/mod");
    expect(compressed).toContain("FAIL");
  });

  it("strips progress bar lines", () => {
    const lines = [
      "Building project...",
      "[████████████████████████████░░] 90%",
      "[██████████████████████████████] 100%",
      "Build complete.",
    ];
    const output = lines.join("\n").padEnd(250, " ");
    const compressed = compressExecOutput(output);
    expect(compressed).not.toContain("████");
    expect(compressed).toContain("Building project...");
  });

  it("collapses consecutive duplicate lines", () => {
    const lines = [
      "Starting...",
      ...Array.from({ length: 20 }, (_, i) => `  Compiling module_${i} v0.1.0`),
      "Done.",
    ];
    const output = lines.join("\n");
    const compressed = compressExecOutput(output);
    expect(compressed).toContain("similar lines omitted");
    expect(compressed.split("\n").length).toBeLessThan(lines.length);
  });

  it("collapses consecutive empty lines", () => {
    const parts = ["line1", "", "", "", "", "", "line2"];
    // Pad to get past the 200 char min
    const output = parts.join("\n").padEnd(250, "\npadding line here");
    const compressed = compressExecOutput(output);
    // Should not have more than 2 consecutive empty-like lines
    expect(compressed).not.toMatch(/\n\n\n/);
  });

  it("truncates very long output with middle omission", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `unique line ${i}: ${Math.random()}`);
    const output = lines.join("\n");
    const compressed = compressExecOutput(output);
    expect(compressed).toContain("lines omitted");
    expect(compressed.split("\n").length).toBeLessThanOrEqual(310);
  });

  it("returns original if compression ratio is below threshold", () => {
    // All unique, meaningful content with different structures — no noise or dups to strip
    const lines = [
      "error: cannot find module 'foo'",
      "  at Object.<anonymous> (src/index.ts:12:5)",
      "  at Module._compile (node:internal/modules/cjs/loader:1364:14)",
      "  at Module._extensions..js (node:internal/modules/cjs/loader:1422:10)",
      "TypeError: Cannot read properties of undefined (reading 'bar')",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      "warning: unused variable `x` in function `main`",
      "note: `#[warn(unused_variables)]` on by default",
      "hint: if this is intentional, prefix it with an underscore: `_x`",
      "Build failed with errors above.",
    ];
    const output = lines.join("\n").padEnd(250, " ");
    const compressed = compressExecOutput(output);
    // Should return original since there's nothing useful to compress
    expect(compressed).toBe(output);
  });

  it("strips npm install noise", () => {
    const lines = [
      "added 150 packages in 5s",
      "Progress: resolved 200, reused 150, downloaded 50",
      "Packages: +150",
      "npm warn deprecated some-pkg@1.0.0",
    ];
    const output = lines.join("\n").padEnd(250, " ");
    const compressed = compressExecOutput(output);
    expect(compressed).not.toContain("added 150 packages");
    expect(compressed).not.toContain("Progress: resolved");
  });

  it("strips spinner artifacts", () => {
    const lines = ["⠋", "⠙", "⠹", "⠸", "real output here"];
    const output = lines.join("\n").padEnd(250, " ");
    const compressed = compressExecOutput(output);
    expect(compressed).toContain("real output here");
  });
});
