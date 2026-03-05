import { FailoverError, resolveFailoverStatus } from "./failover-error.js";
import { classifyFailoverReason } from "./pi-embedded-helpers.js";

export function coerceFailoverErrorFromPayloads(params: {
  payloads?: Array<{
    text?: string;
    isError?: boolean;
    mediaUrl?: string;
    mediaUrls?: string[];
  }>;
  provider: string;
  model: string;
}): FailoverError | null {
  const payloads = params.payloads ?? [];
  // If we have any non-error content, treat the run as "successful enough" and avoid
  // forcing model failover. The caller can still filter error-ish payloads for non-owners.
  for (const payload of payloads) {
    if (!payload || payload.isError) continue;
    const hasText = Boolean((payload.text ?? "").trim());
    const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
    if (hasText || hasMedia) return null;
  }
  for (const payload of payloads) {
    if (!payload?.isError) continue;
    const text = (payload.text ?? "").trim();
    if (!text) continue;
    const reason = classifyFailoverReason(text);
    if (!reason) continue;
    return new FailoverError(text, {
      reason,
      provider: params.provider,
      model: params.model,
      status: resolveFailoverStatus(reason),
    });
  }
  return null;
}
