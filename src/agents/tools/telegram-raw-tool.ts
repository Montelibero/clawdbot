import { inspect } from "node:util";

import { Type } from "@sinclair/typebox";
import { Bot } from "grammy";

import type { ClawdbotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveTelegramAccount } from "../../telegram/accounts.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";

const TELEGRAM_RAW_ACTIONS = ["callApi"] as const;

const TelegramRawToolSchema = Type.Object({
  action: stringEnum(TELEGRAM_RAW_ACTIONS),
  accountId: Type.Optional(Type.String()),
  acknowledgeRisk: Type.Boolean({ description: "Must be true for every call." }),
  apiMethod: Type.Optional(
    Type.String({
      description: "Telegram Bot API method name from grammY api client, e.g. sendMessage",
    }),
  ),
  args: Type.Optional(Type.Array(Type.Unknown())),
  params: Type.Optional(Type.Unknown()),
});

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
    content: [{ type: "text" as const, text: safeJson(payload) }],
    details: payload,
  };
}

function resolveApiMethod(apiMethod: string): string {
  const method = apiMethod.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(method)) {
    throw new Error(`Invalid apiMethod: ${apiMethod}`);
  }
  const lowered = method.toLowerCase();
  if (lowered === "__proto__" || lowered === "prototype" || lowered === "constructor") {
    throw new Error(`Invalid apiMethod: ${apiMethod}`);
  }
  return method;
}

export function createTelegramRawTool(opts?: { config?: ClawdbotConfig }): AnyAgentTool {
  return {
    label: "Telegram Raw Bot API",
    name: "telegram_raw",
    description:
      "Advanced raw Telegram Bot API access for this account. Requires channels.telegram.allowRawApi=true.",
    parameters: TelegramRawToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action !== "callApi") {
        throw new Error(`Unknown action: ${action}`);
      }

      if (params.acknowledgeRisk !== true) {
        throw new Error("acknowledgeRisk=true is required");
      }

      const cfg = opts?.config ?? loadConfig();
      const accountId =
        typeof params.accountId === "string" && params.accountId.trim()
          ? params.accountId.trim()
          : undefined;
      const account = resolveTelegramAccount({ cfg, accountId });
      if (account.config.allowRawApi !== true) {
        throw new Error(
          "Raw Telegram Bot API access is disabled. Set channels.telegram.allowRawApi=true (or account override).",
        );
      }
      if (!account.token) {
        throw new Error(
          `Telegram bot token missing for account "${account.accountId}" (set channels.telegram.accounts.${account.accountId}.botToken/tokenFile or TELEGRAM_BOT_TOKEN for default).`,
        );
      }

      const apiMethod = resolveApiMethod(readStringParam(params, "apiMethod", { required: true }));
      const bot = new Bot(account.token);
      const fn = (bot.api as unknown as Record<string, unknown>)[apiMethod];
      if (typeof fn !== "function") {
        throw new Error(`Unknown Telegram Bot API method: ${apiMethod}`);
      }

      const methodArgs = Array.isArray(params.args) ? [...params.args] : [];
      if (methodArgs.length === 0 && "params" in params) {
        methodArgs.push(params.params);
      }
      const response = await (fn as (...callArgs: unknown[]) => unknown).apply(bot.api, methodArgs);

      return jsonResult({
        ok: true,
        action,
        accountId: account.accountId,
        apiMethod,
        response,
      });
    },
  };
}
