import { Api } from "telegram";
import { NewMessage } from "telegram/events";
import { getPeerId } from "telegram/Utils";

import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { ResolvedTelegramUserAccount } from "./types.js";
import { getTelegramUserRuntime } from "./runtime.js";
import { getTelegramUserClient } from "./client.js";
import { sendTelegramUserMessage } from "./send.js";

export type TelegramUserMonitorOptions = {
  config: ClawdbotConfig;
  account: ResolvedTelegramUserAccount;
  runtime?: { log?: (msg: string) => void; error?: (msg: string) => void };
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

function isSenderAllowed(senderId: string, allowFrom: Array<string | number> | undefined): boolean {
  const normalized = senderId.toLowerCase();
  if (!allowFrom || allowFrom.length === 0) return false;
  if (allowFrom.includes("*")) return true;
  return allowFrom.some((entry) => String(entry).trim().toLowerCase() === normalized);
}

function getChatType(peer: unknown): "direct" | "group" | "channel" {
  if (peer instanceof Api.PeerUser) return "direct";
  if (peer instanceof Api.PeerChat) return "group";
  if (peer instanceof Api.PeerChannel) return "channel";
  return "direct";
}

export async function monitorTelegramUserProvider(
  opts: TelegramUserMonitorOptions,
): Promise<{ stop: () => void }> {
  const core = getTelegramUserRuntime();
  const logger = opts.runtime;
  const account = opts.account;
  const cfg = opts.config;
  const { client } = await getTelegramUserClient(account);

  let stopped = false;
  const stop = () => {
    stopped = true;
    try {
      client.removeEventHandler(onMessage);
    } catch {
      // ignore
    }
  };

  const onMessage = async (event: { message?: Api.Message }) => {
    if (stopped) return;
    const msg = event.message as Api.Message | undefined;
    if (!msg) return;
    if ((msg as { out?: boolean }).out) return;
    const rawBody = (msg as { message?: string }).message ?? "";
    if (!rawBody.trim()) return;

    const peerId = (msg as { peerId?: unknown }).peerId;
    if (!peerId) return;
    const chatId = String(getPeerId(peerId as Parameters<typeof getPeerId>[0]));
    const chatType = getChatType(peerId);

    const senderPeer = (msg as { fromId?: unknown }).fromId ?? peerId;
    const senderId = String(getPeerId(senderPeer as Parameters<typeof getPeerId>[0]));
    const senderLabel = `user:${senderId}`;

    const dmPolicy = account.config.dmPolicy ?? "pairing";
    const allowFrom = account.config.allowFrom ?? [];

    if (chatType === "direct") {
      if (dmPolicy === "disabled") return;
      if (dmPolicy !== "open") {
        const allowed = isSenderAllowed(senderId, allowFrom);
        if (!allowed) {
          if (dmPolicy === "pairing") {
            const { code, created } = await core.channel.pairing.upsertPairingRequest({
              channel: "telegram-user",
              id: senderId,
              meta: { name: senderId },
            });
            if (created) {
              try {
                await sendTelegramUserMessage({
                  to: chatId,
                  text: core.channel.pairing.buildPairingReply({
                    channel: "telegram-user",
                    idLine: `Your Telegram user id: ${senderId}`,
                    code,
                  }),
                  account,
                });
                opts.statusSink?.({ lastOutboundAt: Date.now() });
              } catch (err) {
                logger?.error?.(`telegram-user pairing reply failed: ${String(err)}`);
              }
            }
          }
          return;
        }
      }
    }
    if (chatType !== "direct") {
      const groupPolicy = account.config.groupPolicy ?? "allowlist";
      if (groupPolicy === "disabled") return;
      const groupConfig =
        account.config.groups?.[chatId] ?? account.config.groups?.[\"*\"] ?? undefined;
      if (groupConfig?.enabled === false) return;
      if (groupPolicy !== "open") {
        const groupAllowFrom = groupConfig?.allowFrom ?? account.config.groupAllowFrom ?? [];
        const allowed = isSenderAllowed(senderId, groupAllowFrom);
        if (!allowed) return;
      }
    }

    const peer = {
      kind: chatType === "direct" ? ("dm" as const) : chatType === "group" ? ("group" as const) : ("channel" as const),
      id: chatId,
    };

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "telegram-user",
      accountId: account.accountId,
      peer,
    });

    const storePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    const previousTimestamp = core.channel.session.readSessionUpdatedAt({
      storePath,
      sessionKey: route.sessionKey,
    });
    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const timestampMs = typeof msg.date === "number" ? msg.date * 1000 : undefined;

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Telegram User",
      from: senderLabel,
      timestamp: timestampMs,
      previousTimestamp,
      envelope: envelopeOptions,
      body: rawBody,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: rawBody,
      CommandBody: rawBody,
      From: `telegram-user:${senderId}`,
      To: `telegram-user:${chatId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: chatType,
      ConversationLabel: senderLabel,
      SenderName: senderId,
      SenderId: senderId,
      CommandAuthorized: true,
      Provider: "telegram-user",
      Surface: "telegram-user",
      MessageSid: String(msg.id),
      OriginatingChannel: "telegram-user",
      OriginatingTo: `telegram-user:${chatId}`,
    });

    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err) => {
        logger?.error?.(`telegram-user: failed updating session meta: ${String(err)}`);
      },
    });

    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        deliver: async (payload) => {
          const text = (payload as { text?: string }).text;
          if (!text) return;
          await sendTelegramUserMessage({ to: chatId, text, account });
          opts.statusSink?.({ lastOutboundAt: Date.now() });
        },
      },
    });

    opts.statusSink?.({ lastInboundAt: Date.now() });
  };

  client.addEventHandler(onMessage, new NewMessage({}));

  opts.abortSignal.addEventListener(
    "abort",
    () => {
      stop();
    },
    { once: true },
  );

  return { stop };
}
