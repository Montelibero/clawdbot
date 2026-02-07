import { Type } from "@sinclair/typebox";
import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { StringSession } from "telegram/sessions";

import { resolveTelegramUserAccount } from "./accounts.js";
import {
  clearPendingLogin,
  readPendingLogin,
  readSessionString,
  resolveDefaultSessionFile,
  writePendingLogin,
  writeSessionString,
} from "./storage.js";
import type { ChannelAgentTool } from "clawdbot/plugin-sdk";
import type { ClawdbotConfig } from "clawdbot/plugin-sdk";

const ACTIONS = ["sendCode", "signIn", "status", "logout", "saveSession"] as const;

function stringEnum<T extends readonly string[]>(values: T, options: { description?: string } = {}) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

export const TelegramUserLoginToolSchema = Type.Object(
  {
    action: stringEnum(ACTIONS, { description: `Action: ${ACTIONS.join(", ")}` }),
    accountId: Type.Optional(Type.String()),
    apiId: Type.Optional(Type.Number()),
    apiHash: Type.Optional(Type.String()),
    phoneNumber: Type.Optional(Type.String()),
    phoneCode: Type.Optional(Type.String()),
    password: Type.Optional(Type.String()),
    sessionFile: Type.Optional(Type.String()),
    sessionString: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

async function createLoginClient(params: {
  apiId: number;
  apiHash: string;
  sessionFile: string;
  sessionString?: string | null;
}) {
  const baseSession = params.sessionString ?? (await readSessionString(params.sessionFile)) ?? "";
  if (params.sessionString) {
    await writeSessionString(params.sessionFile, params.sessionString);
  }
  const client = new TelegramClient(new StringSession(baseSession), params.apiId, params.apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  return client;
}

function resolveApiId(value?: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const env = process.env.TELEGRAM_USER_API_ID?.trim();
  if (!env) return undefined;
  const parsed = Number.parseInt(env, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveApiHash(value?: string): string | undefined {
  if (value?.trim()) return value.trim();
  const env = process.env.TELEGRAM_USER_API_HASH?.trim();
  return env || undefined;
}

export function createTelegramUserLoginTool(params?: {
  cfg?: ClawdbotConfig;
}): ChannelAgentTool {
  return {
    name: "telegram_user_login",
    label: "Telegram User Login",
    description:
      "Login helper for Telegram user (MTProto). Use sendCode, then signIn with phoneCode.",
    parameters: TelegramUserLoginToolSchema,
    execute: async (_toolCallId, args) => {
      const input = args as Record<string, unknown>;
      const action = String(input.action ?? "").trim() as (typeof ACTIONS)[number];
      if (!ACTIONS.includes(action)) {
        throw new Error(`Unknown action: ${String(action)}`);
      }

      const cfg = params?.cfg as ClawdbotConfig | undefined;
      const accountId = typeof input.accountId === "string" ? input.accountId.trim() : undefined;
      const account = resolveTelegramUserAccount({ cfg: cfg ?? ({} as ClawdbotConfig), accountId });
      const apiId = resolveApiId(
        typeof input.apiId === "number" ? input.apiId : account.apiId,
      );
      const apiHash = resolveApiHash(
        typeof input.apiHash === "string" ? input.apiHash : account.apiHash,
      );
      const sessionFile =
        (typeof input.sessionFile === "string" && input.sessionFile.trim()) ||
        account.sessionFile ||
        resolveDefaultSessionFile(account.accountId);
      const sessionString =
        (typeof input.sessionString === "string" && input.sessionString.trim()) ||
        account.sessionString;

      if (!apiId || !apiHash) {
        throw new Error("apiId/apiHash required (set in config or pass to tool)");
      }

      if (action === "status") {
        const existing = await readSessionString(sessionFile);
        const pending = await readPendingLogin(sessionFile);
        return jsonResult({
          ok: true,
          accountId: account.accountId,
          sessionFile,
          hasSession: Boolean(existing),
          pendingLogin: pending ? { phoneNumber: pending.phoneNumber } : null,
        });
      }

      if (action === "saveSession") {
        if (!sessionString) {
          throw new Error("sessionString required for saveSession");
        }
        await writeSessionString(sessionFile, sessionString);
        await clearPendingLogin(sessionFile);
        return jsonResult({ ok: true, saved: true, sessionFile });
      }

      if (action === "logout") {
        await writeSessionString(sessionFile, "");
        await clearPendingLogin(sessionFile);
        return jsonResult({ ok: true, cleared: true, sessionFile });
      }

      if (action === "sendCode") {
        const phoneNumber =
          typeof input.phoneNumber === "string" ? input.phoneNumber.trim() : "";
        if (!phoneNumber) {
          throw new Error("phoneNumber required for sendCode");
        }
        const client = await createLoginClient({
          apiId,
          apiHash,
          sessionFile,
          sessionString,
        });
        const result = await client.invoke(
          new Api.auth.SendCode({
            phoneNumber,
            apiId,
            apiHash,
            settings: new Api.CodeSettings({}),
          }),
        );
        await writePendingLogin(sessionFile, {
          phoneNumber,
          phoneCodeHash: result.phoneCodeHash,
          apiId,
          apiHash,
        });
        return jsonResult({ ok: true, phoneNumber, sessionFile, sent: true });
      }

      if (action === "signIn") {
        const phoneCode =
          typeof input.phoneCode === "string" ? input.phoneCode.trim() : "";
        if (!phoneCode) {
          throw new Error("phoneCode required for signIn");
        }
        const pending = await readPendingLogin(sessionFile);
        if (!pending) {
          throw new Error("No pending login. Run sendCode first.");
        }
        const client = await createLoginClient({
          apiId: pending.apiId,
          apiHash: pending.apiHash,
          sessionFile,
          sessionString,
        });
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: pending.phoneNumber,
            phoneCodeHash: pending.phoneCodeHash,
            phoneCode,
          }),
        );
        const saved = client.session.save();
        await writeSessionString(sessionFile, saved);
        await clearPendingLogin(sessionFile);
        return jsonResult({ ok: true, loggedIn: true, sessionFile });
      }

      throw new Error(`Unhandled action: ${String(action)}`);
    },
  };
}
