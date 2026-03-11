import crypto from "node:crypto";
import { resolveAgentModelFallbacksOverride } from "../../agents/agent-scope.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { coerceFailoverErrorFromPayloads } from "../../agents/failover-from-payloads.js";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { classifyFailoverReason } from "../../agents/pi-embedded-helpers.js";
import {
  resolveAgentIdFromSessionKey,
  type SessionEntry,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import type { TypingMode } from "../../config/types.js";
import { logVerbose } from "../../globals.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { defaultRuntime } from "../../runtime.js";
import { stripHeartbeatToken } from "../heartbeat.js";
import type { OriginatingChannelType } from "../templating.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import type { FollowupRun } from "./queue.js";
import {
  applyReplyThreading,
  filterMessagingToolDuplicates,
  shouldSuppressMessagingToolReplies,
} from "./reply-payloads.js";
import { resolveReplyToMode } from "./reply-threading.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import { persistSessionUsageUpdate } from "./session-usage.js";
import { incrementCompactionCount } from "./session-updates.js";
import type { TypingController } from "./typing.js";
import { createTypingSignaler } from "./typing-mode.js";

export function createFollowupRunner(params: {
  opts?: GetReplyOptions;
  typing: TypingController;
  typingMode: TypingMode;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
}): (queued: FollowupRun) => Promise<void> {
  const {
    opts,
    typing,
    typingMode,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
  } = params;
  const typingSignals = createTypingSignaler({
    typing,
    mode: typingMode,
    isHeartbeat: opts?.isHeartbeat === true,
  });
  const OWNER_ALERT_COOLDOWN_MS = 10 * 60 * 1000;

  const isErrorishPayload = (payload: ReplyPayload): boolean => {
    if (payload.isError) return true;
    const text = (payload.text ?? "").trim();
    return text.startsWith("⚠️");
  };

  const computeOwnerAlertKey = (params: {
    text: string;
    provider?: string;
    model?: string;
    sessionKey?: string;
  }): string => {
    const h = crypto.createHash("sha1");
    h.update(params.sessionKey ?? "");
    h.update("\n");
    h.update(params.provider ?? "");
    h.update("/");
    h.update(params.model ?? "");
    h.update("\n");
    h.update(params.text);
    return h.digest("hex");
  };

  const notifyOwners = async (queued: FollowupRun, alert: { text: string; reason?: string }) => {
    const owners = (queued.run.ownerNumbers ?? []).map((v) => v.trim()).filter(Boolean);
    if (owners.length === 0) {
      defaultRuntime.error?.(
        `Owner alert dropped (no owners configured): ${alert.reason ?? "error"}`,
      );
      return;
    }
    const replyToChannel =
      queued.originatingChannel ??
      (queued.run.messageProvider?.toLowerCase() as OriginatingChannelType | undefined);
    if (!isRoutableChannel(replyToChannel)) {
      defaultRuntime.error?.(
        `Owner alert dropped (unroutable channel ${String(replyToChannel)}): ${alert.reason ?? "error"}`,
      );
      return;
    }

    const providerUsed = queued.run.provider;
    const modelUsed = queued.run.model;
    const alertKey = computeOwnerAlertKey({
      text: alert.text,
      provider: providerUsed,
      model: modelUsed,
      sessionKey,
    });
    const now = Date.now();
    const lastAt = sessionEntry?.lastOwnerAlertAt ?? 0;
    const lastKey = sessionEntry?.lastOwnerAlertKey ?? "";
    if (now - lastAt < OWNER_ALERT_COOLDOWN_MS && lastKey === alertKey) return;

    const header = [
      "⚠️ Clawdbot alert",
      alert.reason ? `Reason: ${alert.reason}` : null,
      replyToChannel ? `Channel: ${replyToChannel}` : null,
      queued.originatingTo ? `Origin: ${queued.originatingTo}` : null,
      queued.run.sessionKey ? `Session: ${queued.run.sessionKey}` : null,
      queued.run.sessionId ? `RunSessionId: ${queued.run.sessionId}` : null,
      providerUsed ? `Model: ${providerUsed}/${modelUsed}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const text = `${header}\n\n${alert.text}`;

    for (const owner of owners) {
      await routeReply({
        payload: { text, isError: true },
        channel: replyToChannel,
        to: owner,
        sessionKey,
        accountId: queued.originatingAccountId,
        cfg: queued.run.config,
        mirror: false,
      });
    }

    if (sessionEntry && sessionStore && sessionKey) {
      sessionEntry.lastOwnerAlertAt = now;
      sessionEntry.lastOwnerAlertKey = alertKey;
      sessionStore[sessionKey] = sessionEntry;
      if (storePath) {
        await updateSessionStoreEntry({
          storePath,
          sessionKey,
          update: async () => ({ lastOwnerAlertAt: now, lastOwnerAlertKey: alertKey }),
        });
      }
    }
  };

  /**
   * Sends followup payloads, routing to the originating channel if set.
   *
   * When originatingChannel/originatingTo are set on the queued run,
   * replies are routed directly to that provider instead of using the
   * session's current dispatcher. This ensures replies go back to
   * where the message originated.
   */
  const sendFollowupPayloads = async (payloads: ReplyPayload[], queued: FollowupRun) => {
    // Check if we should route to originating channel.
    const { originatingChannel, originatingTo } = queued;
    const shouldRouteToOriginating = isRoutableChannel(originatingChannel) && originatingTo;

    if (!shouldRouteToOriginating && !opts?.onBlockReply) {
      logVerbose("followup queue: no onBlockReply handler; dropping payloads");
      return;
    }

    for (const payload of payloads) {
      if (!payload?.text && !payload?.mediaUrl && !payload?.mediaUrls?.length) {
        continue;
      }
      if (
        isSilentReplyText(payload.text, SILENT_REPLY_TOKEN) &&
        !payload.mediaUrl &&
        !payload.mediaUrls?.length
      ) {
        continue;
      }
      await typingSignals.signalTextDelta(payload.text);

      // Route to originating channel if set, otherwise fall back to dispatcher.
      if (shouldRouteToOriginating) {
        const result = await routeReply({
          payload,
          channel: originatingChannel,
          to: originatingTo,
          sessionKey: queued.run.sessionKey,
          accountId: queued.originatingAccountId,
          threadId: queued.originatingThreadId,
          cfg: queued.run.config,
        });
        if (!result.ok) {
          // Log error and fall back to dispatcher if available.
          const errorMsg = result.error ?? "unknown error";
          logVerbose(`followup queue: route-reply failed: ${errorMsg}`);
          // Fallback: try the dispatcher if routing failed.
          if (opts?.onBlockReply) {
            await opts.onBlockReply(payload);
          }
        }
      } else if (opts?.onBlockReply) {
        await opts.onBlockReply(payload);
      }
    }
  };

  return async (queued: FollowupRun) => {
    try {
      const runId = crypto.randomUUID();
      if (queued.run.sessionKey) {
        registerAgentRunContext(runId, {
          sessionKey: queued.run.sessionKey,
          verboseLevel: queued.run.verboseLevel,
        });
      }
      let autoCompactionCompleted = false;
      let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
      let fallbackProvider = queued.run.provider;
      let fallbackModel = queued.run.model;
      try {
        const fallbackResult = await runWithModelFallback({
          cfg: queued.run.config,
          provider: queued.run.provider,
          model: queued.run.model,
          fallbacksOverride: resolveAgentModelFallbacksOverride(
            queued.run.config,
            resolveAgentIdFromSessionKey(queued.run.sessionKey),
          ),
          run: (provider, model) => {
            const authProfileId =
              provider === queued.run.provider ? queued.run.authProfileId : undefined;
            return runEmbeddedPiAgent({
              sessionId: queued.run.sessionId,
              sessionKey: queued.run.sessionKey,
              messageProvider: queued.run.messageProvider,
              agentAccountId: queued.run.agentAccountId,
              messageTo: queued.originatingTo,
              messageThreadId: queued.originatingThreadId,
              groupId: queued.run.groupId,
              groupChannel: queued.run.groupChannel,
              groupSpace: queued.run.groupSpace,
              sessionFile: queued.run.sessionFile,
              workspaceDir: queued.run.workspaceDir,
              config: queued.run.config,
              skillsSnapshot: queued.run.skillsSnapshot,
              prompt: queued.prompt,
              extraSystemPrompt: queued.run.extraSystemPrompt,
              ownerNumbers: queued.run.ownerNumbers,
              enforceFinalTag: queued.run.enforceFinalTag,
              provider,
              model,
              authProfileId,
              authProfileIdSource: authProfileId ? queued.run.authProfileIdSource : undefined,
              thinkLevel: queued.run.thinkLevel,
              verboseLevel: queued.run.verboseLevel,
              reasoningLevel: queued.run.reasoningLevel,
              execOverrides: queued.run.execOverrides,
              bashElevated: queued.run.bashElevated,
              timeoutMs: queued.run.timeoutMs,
              runId,
              blockReplyBreak: queued.run.blockReplyBreak,
              onAgentEvent: (evt) => {
                if (evt.stream !== "compaction") return;
                const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
                const willRetry = Boolean(evt.data.willRetry);
                if (phase === "end" && !willRetry) {
                  autoCompactionCompleted = true;
                }
              },
            }).then((res) => {
              const failover = coerceFailoverErrorFromPayloads({
                payloads: res.payloads,
                provider,
                model,
              });
              if (failover) throw failover;
              return res;
            });
          },
        });
        runResult = fallbackResult.result;
        fallbackProvider = fallbackResult.provider;
        fallbackModel = fallbackResult.model;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        defaultRuntime.error?.(`Followup agent failed before reply: ${message}`);

        const isOwnerSender = queued.originatingIsOwnerSender === true;
        const replyToChannel =
          queued.originatingChannel ??
          (queued.run.messageProvider?.toLowerCase() as OriginatingChannelType | undefined);
        const text = message.trim().startsWith("⚠️") ? message.trim() : `⚠️ ${message}`.trim();

        if (!isOwnerSender) {
          await notifyOwners(queued, {
            text,
            reason: classifyFailoverReason(text) ?? "error",
          });
          return;
        }

        if (isRoutableChannel(replyToChannel) && queued.originatingTo) {
          await routeReply({
            payload: { text, isError: true },
            channel: replyToChannel,
            to: queued.originatingTo,
            sessionKey: queued.run.sessionKey,
            accountId: queued.originatingAccountId,
            threadId: queued.originatingThreadId,
            cfg: queued.run.config,
          });
        } else if (opts?.onBlockReply) {
          await opts.onBlockReply({ text, isError: true });
        }
        return;
      }

      if (storePath && sessionKey) {
        const usage = runResult.meta.agentMeta?.usage;
        const modelUsed = runResult.meta.agentMeta?.model ?? fallbackModel ?? defaultModel;
        const contextTokensUsed =
          agentCfgContextTokens ??
          lookupContextTokens(modelUsed) ??
          sessionEntry?.contextTokens ??
          DEFAULT_CONTEXT_TOKENS;

        await persistSessionUsageUpdate({
          storePath,
          sessionKey,
          usage,
          modelUsed,
          providerUsed: fallbackProvider,
          contextTokensUsed,
          logLabel: "followup",
        });
      }

      const payloadArray = runResult.payloads ?? [];
      const isOwnerSender = queued.originatingIsOwnerSender === true;
      const replyToChannel =
        queued.originatingChannel ??
        (queued.run.messageProvider?.toLowerCase() as OriginatingChannelType | undefined);
      if (payloadArray.length === 0) {
        return;
      }
      const sanitizedPayloads = payloadArray.flatMap((payload) => {
        const text = payload.text;
        if (!text || !text.includes("HEARTBEAT_OK")) return [payload];
        const stripped = stripHeartbeatToken(text, { mode: "message" });
        const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
        if (stripped.shouldSkip && !hasMedia) return [];
        return [{ ...payload, text: stripped.text }];
      });
      const replyToMode = resolveReplyToMode(
        queued.run.config,
        replyToChannel,
        queued.originatingAccountId,
        queued.originatingChatType,
      );

      const replyTaggedPayloads: ReplyPayload[] = applyReplyThreading({
        payloads: sanitizedPayloads,
        replyToMode,
        replyToChannel,
      });

      const dedupedPayloads = filterMessagingToolDuplicates({
        payloads: replyTaggedPayloads,
        sentTexts: runResult.messagingToolSentTexts ?? [],
      });
      const suppressMessagingToolReplies = shouldSuppressMessagingToolReplies({
        messageProvider: queued.run.messageProvider,
        messagingToolSentTargets: runResult.messagingToolSentTargets,
        originatingTo: queued.originatingTo,
        accountId: queued.run.agentAccountId,
      });
      let finalPayloads = suppressMessagingToolReplies ? [] : dedupedPayloads;

      if (finalPayloads.length === 0) return;
      if (!isOwnerSender) {
        const errorish = finalPayloads.filter(isErrorishPayload);
        if (errorish.length > 0) {
          const text =
            errorish.find((p) => (p.text ?? "").trim())?.text?.trim() ??
            "Agent failed with an unknown error.";
          await notifyOwners(queued, { text, reason: classifyFailoverReason(text) ?? "error" });
        }
        finalPayloads = finalPayloads.filter((p) => !isErrorishPayload(p));
        if (finalPayloads.length === 0) return;
      }

      if (autoCompactionCompleted) {
        const count = await incrementCompactionCount({
          sessionEntry,
          sessionStore,
          sessionKey,
          storePath,
        });
        if (queued.run.verboseLevel && queued.run.verboseLevel !== "off") {
          const suffix = typeof count === "number" ? ` (count ${count})` : "";
          finalPayloads.unshift({
            text: `🧹 Auto-compaction complete${suffix}.`,
          });
        }
      }

      await sendFollowupPayloads(finalPayloads, queued);
    } finally {
      typing.markRunComplete();
    }
  };
}
