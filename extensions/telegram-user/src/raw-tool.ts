import { inspect } from "node:util";

import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { ChannelAgentTool, ClawdbotConfig } from "clawdbot/plugin-sdk";

import { resolveTelegramUserAccount } from "./accounts.js";
import { getTelegramUserClient } from "./client.js";

const ACTIONS = ["invoke", "callClient"] as const;

function stringEnum<T extends readonly string[]>(values: T, options: { description?: string } = {}) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

export const TelegramUserRawToolSchema = Type.Object(
  {
    action: stringEnum(ACTIONS),
    accountId: Type.Optional(Type.String()),
    acknowledgeRisk: Type.Boolean({
      description: "Must be true for every call",
    }),
    apiMethod: Type.Optional(
      Type.String({
        description: "MTProto constructor path, e.g. channels.EditTitle or messages.UpdatePinnedMessage",
      }),
    ),
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    clientMethod: Type.Optional(
      Type.String({
        description: "Raw TelegramClient method name, e.g. getMessages",
      }),
    ),
    args: Type.Optional(Type.Array(Type.Unknown())),
  },
  { additionalProperties: false },
);

function safeJson(payload: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      payload,
      (_key, value) => {
        if (typeof value === "bigint") return value.toString();
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      },
      2,
    );
  } catch {
    return inspect(payload, { depth: 5, breakLength: 120 });
  }
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text", text: safeJson(payload) }],
    details: payload,
  };
}

function resolveApiCtor(path: string): new (params: Record<string, unknown>) => unknown {
  if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/.test(path)) {
    throw new Error(`Invalid apiMethod path: ${path}`);
  }
  const parts = path.split(".");
  let cursor: unknown = Api;
  for (const part of parts) {
    cursor = (cursor as Record<string, unknown> | undefined)?.[part];
    if (cursor == null) {
      throw new Error(`Unknown apiMethod path: ${path}`);
    }
  }
  if (typeof cursor !== "function") {
    throw new Error(`apiMethod is not a constructor: ${path}`);
  }
  return cursor as new (params: Record<string, unknown>) => unknown;
}

export function createTelegramUserRawTool(params?: {
  cfg?: ClawdbotConfig;
}): ChannelAgentTool {
  return {
    name: "telegram_user_raw",
    label: "Telegram User Raw MTProto",
    description:
      "Full raw Telegram access for this account. Requires channels.telegram-user.allowRawApi=true.",
    parameters: TelegramUserRawToolSchema,
    execute: async (_toolCallId, args) => {
      const input = args as Record<string, unknown>;
      const action = String(input.action ?? "").trim();
      const acknowledgeRisk = input.acknowledgeRisk === true;
      if (!acknowledgeRisk) {
        throw new Error("acknowledgeRisk=true is required");
      }

      const cfg = params?.cfg ?? ({} as ClawdbotConfig);
      const accountId = typeof input.accountId === "string" ? input.accountId.trim() : undefined;
      const account = resolveTelegramUserAccount({ cfg, accountId });
      if (account.config.allowRawApi !== true) {
        throw new Error(
          "Raw MTProto access is disabled. Set channels.telegram-user.allowRawApi=true (or account override).",
        );
      }
      const { client } = await getTelegramUserClient(account);

      if (action === "invoke") {
        const apiMethod = String(input.apiMethod ?? "").trim();
        if (!apiMethod) throw new Error("apiMethod is required for action=invoke");
        const ctor = resolveApiCtor(apiMethod);
        const ctorParams =
          typeof input.params === "object" && input.params !== null
            ? (input.params as Record<string, unknown>)
            : {};
        const request = new ctor(ctorParams);
        const response = await client.invoke(request as never);
        return jsonResult({
          ok: true,
          action,
          accountId: account.accountId,
          apiMethod,
          response,
        });
      }

      if (action === "callClient") {
        const clientMethod = String(input.clientMethod ?? "").trim();
        if (!clientMethod) throw new Error("clientMethod is required for action=callClient");
        const fn = (client as Record<string, unknown>)[clientMethod];
        if (typeof fn !== "function") {
          throw new Error(`Unknown client method: ${clientMethod}`);
        }
        const methodArgs = Array.isArray(input.args) ? input.args : [];
        const response = await (fn as (...args: unknown[]) => unknown).apply(client, methodArgs);
        return jsonResult({
          ok: true,
          action,
          accountId: account.accountId,
          clientMethod,
          response,
        });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}

