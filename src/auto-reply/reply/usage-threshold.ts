import type { SessionEntry } from "../../config/sessions/types.js";
import { formatTokenCount } from "../../utils/usage-format.js";

// --- Hourly accumulator (in-memory) ---

type TokenEntry = { sessionKey: string; tokens: number; timestamp: number };
const hourlyLog: TokenEntry[] = [];

export function recordTokenUsage(sessionKey: string, tokens: number): void {
  hourlyLog.push({ sessionKey, tokens, timestamp: Date.now() });
}

function getHourlyTotal(): { total: number; topSessions: { key: string; tokens: number }[] } {
  const cutoff = Date.now() - 60 * 60 * 1000;
  // Prune old entries
  while (hourlyLog.length > 0 && hourlyLog[0].timestamp < cutoff) hourlyLog.shift();
  // Aggregate
  const bySession = new Map<string, number>();
  let total = 0;
  for (const entry of hourlyLog) {
    total += entry.tokens;
    bySession.set(entry.sessionKey, (bySession.get(entry.sessionKey) ?? 0) + entry.tokens);
  }
  const topSessions = [...bySession.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, tokens]) => ({ key, tokens }));
  return { total, topSessions };
}

// --- Per-session threshold check ---

const SESSION_TOKEN_THRESHOLD = 100_000;
const SESSION_WARNING_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export function checkSessionTokenThreshold(params: { sessionEntry?: SessionEntry }): string | null {
  const { sessionEntry } = params;
  if (!sessionEntry) return null;
  const total = (sessionEntry.inputTokens ?? 0) + (sessionEntry.outputTokens ?? 0);
  if (total < SESSION_TOKEN_THRESHOLD) return null;
  const now = Date.now();
  if (now - (sessionEntry.lastUsageWarningAt ?? 0) < SESSION_WARNING_COOLDOWN_MS) return null;
  return `\u26a0\ufe0f Session usage: ${formatTokenCount(total)} tokens.`;
}

// --- Hourly global threshold check ---

const HOURLY_TOKEN_THRESHOLD = 1_000_000;
let lastHourlyWarningAt = 0;
const HOURLY_WARNING_COOLDOWN_MS = 60 * 60 * 1000;

export function checkHourlyTokenThreshold(): string | null {
  const now = Date.now();
  if (now - lastHourlyWarningAt < HOURLY_WARNING_COOLDOWN_MS) return null;
  const { total, topSessions } = getHourlyTotal();
  if (total < HOURLY_TOKEN_THRESHOLD) return null;
  lastHourlyWarningAt = now;
  const sessionLines = topSessions
    .map((s) => `  ${s.key}: ${formatTokenCount(s.tokens)}`)
    .join("\n");
  return `\u26a0\ufe0f High token usage: ${formatTokenCount(total)} in the last hour.\nTop sessions:\n${sessionLines}`;
}
