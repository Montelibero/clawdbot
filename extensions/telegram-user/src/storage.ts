import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SESSION_DIR_NAME = "telegram-user";

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

function resolveStateDir(): string {
  const override = process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(os.homedir(), ".clawdbot");
}

export function resolveCredentialsDir(): string {
  const override = process.env.CLAWDBOT_OAUTH_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(resolveStateDir(), "credentials");
}

export function resolveDefaultSessionFile(accountId: string): string {
  return path.join(resolveCredentialsDir(), SESSION_DIR_NAME, `${accountId}.session`);
}

export function resolvePendingFile(sessionFile: string): string {
  return `${sessionFile}.pending.json`;
}

export async function readSessionString(sessionFile: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(sessionFile, "utf8");
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function writeSessionString(sessionFile: string, value: string): Promise<void> {
  const dir = path.dirname(sessionFile);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(sessionFile, value.trim() + "\n", "utf8");
}

export type PendingLogin = {
  phoneNumber: string;
  phoneCodeHash: string;
  apiId: number;
  apiHash: string;
};

export async function readPendingLogin(sessionFile: string): Promise<PendingLogin | null> {
  try {
    const raw = await fs.readFile(resolvePendingFile(sessionFile), "utf8");
    return JSON.parse(raw) as PendingLogin;
  } catch {
    return null;
  }
}

export async function writePendingLogin(
  sessionFile: string,
  pending: PendingLogin,
): Promise<void> {
  const dir = path.dirname(sessionFile);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    resolvePendingFile(sessionFile),
    JSON.stringify(pending, null, 2),
    "utf8",
  );
}

export async function clearPendingLogin(sessionFile: string): Promise<void> {
  try {
    await fs.unlink(resolvePendingFile(sessionFile));
  } catch {
    // ignore
  }
}
