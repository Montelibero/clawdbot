/**
 * RTK prompt instructions injected into the agent's context via before_agent_start.
 * Tells the agent to prefix supported shell commands with `rtk` for token savings.
 */
export const RTK_PROMPT_INSTRUCTIONS = `<rtk-instructions>
RTK (Rust Token Killer) is available on this system. It filters shell command output to reduce token usage (60-90% savings).

**Usage:** Prefix supported commands with \`rtk\`. RTK is transparent — unrecognized commands pass through unchanged.

Prefix these with \`rtk\`:
- git (status, log, diff, show, add, commit, push, pull, branch, fetch, stash)
- npm, pnpm, npx (install, list, outdated, run)
- cargo (build, check, clippy, test)
- vitest, playwright, jest
- tsc, lint, prettier
- docker (ps, images, logs)
- kubectl (get, logs)
- ls, grep, find, curl
- gh (pr, issue, run)

Do NOT prefix:
- Shell builtins (cd, export, source, alias)
- Editors (vim, nano, code)
- Interactive tools (ssh, htop, top)
- Minimal-output commands (echo, pwd, cat, mkdir, cp, mv, rm, chmod)
- Package managers when adding/removing deps (pnpm add, npm install <pkg>)

In command chains, prefix each command: \`rtk git add . && rtk git commit -m "msg"\`
</rtk-instructions>`;
