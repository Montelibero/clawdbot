import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { readSessionString, writeSessionString } from "./storage.js";
import type { ResolvedTelegramUserAccount } from "./types.js";

type ClientEntry = {
  client: TelegramClient;
  sessionFile: string;
  apiId: number;
  apiHash: string;
};

const clients = new Map<string, ClientEntry>();

export async function getTelegramUserClient(
  account: ResolvedTelegramUserAccount,
): Promise<ClientEntry> {
  const key = account.accountId;
  const existing = clients.get(key);
  if (existing) return existing;
  if (!account.apiId || !account.apiHash) {
    throw new Error("telegram-user missing apiId/apiHash (set channels['telegram-user'].apiId/apiHash)");
  }
  const sessionFile = account.sessionFile?.trim();
  if (!sessionFile) {
    throw new Error("telegram-user missing sessionFile");
  }
  const fileSession = await readSessionString(sessionFile);
  const baseSession = account.sessionString ?? fileSession ?? "";
  if (account.sessionString && account.sessionString !== fileSession) {
    await writeSessionString(sessionFile, account.sessionString);
  }
  const session = new StringSession(baseSession);
  const client = new TelegramClient(session, account.apiId, account.apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  const entry: ClientEntry = {
    client,
    sessionFile,
    apiId: account.apiId,
    apiHash: account.apiHash,
  };
  clients.set(key, entry);
  return entry;
}

export async function dropTelegramUserClient(accountId: string): Promise<void> {
  const existing = clients.get(accountId);
  if (!existing) return;
  clients.delete(accountId);
  try {
    await existing.client.disconnect();
  } catch {
    // ignore
  }
}
