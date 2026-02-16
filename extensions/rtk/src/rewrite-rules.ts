/**
 * Commands that benefit from RTK prefix (significant output that can be compressed).
 * Used by the prompt injection to guide the agent, and potentially by future
 * before_tool_call hook for automatic rewriting.
 */
const RTK_PREFIXABLE = new Set([
  // Git
  "git",
  // Package managers
  "npm",
  "pnpm",
  "npx",
  "bun",
  "yarn",
  // Rust
  "cargo",
  // Test runners
  "vitest",
  "jest",
  "playwright",
  "pytest",
  // Build / lint
  "tsc",
  "lint",
  "eslint",
  "oxlint",
  "biome",
  "prettier",
  "oxfmt",
  "next",
  // Containers
  "docker",
  "kubectl",
  // Files & search
  "ls",
  "grep",
  "rg",
  "find",
  "fd",
  // Network
  "curl",
  "wget",
  // GitHub CLI
  "gh",
  // RTK meta
  "rtk",
]);

/** Commands that should NEVER be prefixed with rtk. */
const NEVER_PREFIX = new Set([
  // Shell builtins
  "cd",
  "export",
  "source",
  "alias",
  "unalias",
  "set",
  "unset",
  "eval",
  "exec",
  "exit",
  "return",
  "shift",
  "trap",
  "wait",
  // Editors
  "vim",
  "vi",
  "nano",
  "code",
  "emacs",
  // Interactive
  "ssh",
  "htop",
  "top",
  "less",
  "more",
  "man",
  // Minimal output (no benefit from filtering)
  "echo",
  "printf",
  "pwd",
  "cat",
  "head",
  "tail",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "chmod",
  "chown",
  "touch",
  "ln",
  "true",
  "false",
  "sleep",
  "date",
  "whoami",
  "which",
  "type",
  "env",
  "kill",
  "pkill",
  "nohup",
]);

/**
 * Extract the base command from a shell command string.
 * Handles: env vars, sudo, leading whitespace, semicolons, pipes.
 */
export function extractBaseCommand(cmd: string): string | null {
  // Strip leading whitespace
  let s = cmd.trimStart();

  // Skip env var assignments (FOO=bar cmd)
  while (/^\w+=\S*\s/.test(s)) {
    s = s.replace(/^\w+=\S*\s+/, "");
  }

  // Skip sudo
  if (s.startsWith("sudo ")) {
    s = s.slice(5).trimStart();
  }

  // Extract first word
  const match = s.match(/^([\w./-]+)/);
  return match ? match[1] : null;
}

/** Check if a command should be prefixed with `rtk`. */
export function shouldPrefixWithRtk(cmd: string): boolean {
  const base = extractBaseCommand(cmd);
  if (!base) return false;

  // Already has rtk prefix
  if (base === "rtk") return false;

  // Never prefix these
  if (NEVER_PREFIX.has(base)) return false;

  return RTK_PREFIXABLE.has(base);
}
