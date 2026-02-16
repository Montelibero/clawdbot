import { describe, expect, it } from "vitest";

import { extractBaseCommand, shouldPrefixWithRtk } from "./rewrite-rules.js";

describe("extractBaseCommand", () => {
  it("extracts simple command", () => {
    expect(extractBaseCommand("git status")).toBe("git");
  });

  it("strips leading whitespace", () => {
    expect(extractBaseCommand("  git log")).toBe("git");
  });

  it("skips env var assignments", () => {
    expect(extractBaseCommand("FOO=bar git status")).toBe("git");
  });

  it("skips multiple env vars", () => {
    expect(extractBaseCommand("NODE_ENV=test CI=1 vitest run")).toBe("vitest");
  });

  it("skips sudo", () => {
    expect(extractBaseCommand("sudo docker ps")).toBe("docker");
  });

  it("handles env var + sudo", () => {
    expect(extractBaseCommand("TERM=xterm sudo pnpm install")).toBe("pnpm");
  });

  it("returns null for empty string", () => {
    expect(extractBaseCommand("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(extractBaseCommand("   ")).toBeNull();
  });

  it("handles paths", () => {
    expect(extractBaseCommand("/usr/bin/git status")).toBe("/usr/bin/git");
  });
});

describe("shouldPrefixWithRtk", () => {
  it.each([
    "git status",
    "git log --oneline -20",
    "git diff HEAD~3",
    "pnpm install",
    "npm run build",
    "npx vitest run",
    "cargo build --release",
    "vitest run src/",
    "docker ps -a",
    "kubectl get pods",
    "ls -la",
    "grep -r pattern .",
    "curl https://example.com",
    "gh pr list",
    "tsc --noEmit",
  ])("returns true for: %s", (cmd) => {
    expect(shouldPrefixWithRtk(cmd)).toBe(true);
  });

  it.each([
    "cd /tmp",
    "echo hello",
    "export FOO=bar",
    "mkdir -p /tmp/test",
    "cp a b",
    "rm -f file",
    "chmod 755 file",
    "pwd",
    "cat file.txt",
    "ssh user@host",
    "vim file.ts",
    "sleep 5",
    "touch newfile",
  ])("returns false for: %s", (cmd) => {
    expect(shouldPrefixWithRtk(cmd)).toBe(false);
  });

  it("returns false when already prefixed with rtk", () => {
    expect(shouldPrefixWithRtk("rtk git status")).toBe(false);
  });

  it("returns false for empty command", () => {
    expect(shouldPrefixWithRtk("")).toBe(false);
  });

  it("handles sudo prefix", () => {
    expect(shouldPrefixWithRtk("sudo docker ps")).toBe(true);
  });

  it("handles env vars", () => {
    expect(shouldPrefixWithRtk("NODE_ENV=test vitest run")).toBe(true);
  });
});
