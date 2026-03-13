import { getProviderLabel } from "./provider-usage.shared.js";
import type { ProviderUsageSnapshot, UsageWindow } from "./provider-usage.types.js";

export async function fetchCustomUsage(
  provider: string,
  baseUrl: string,
  token: string,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<ProviderUsageSnapshot> {
  const displayName = getProviderLabel(provider);
  const defaultSnapshot: ProviderUsageSnapshot = { provider, displayName, windows: [] };

  try {
    const url = new URL("/v1/limits", baseUrl).toString();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetcher(url, { headers, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );

    if (!res.ok) {
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        return { ...defaultSnapshot, error: "Unsupported provider" };
      }
      return { ...defaultSnapshot, error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as Record<string, unknown>;
    const windows: UsageWindow[] = [];

    for (const [key, val] of Object.entries(data)) {
      if (val && typeof val === "object" && "used" in val && "limit" in val) {
        const entry = val as { used: number; limit: number; resetAt?: number };
        const used = Number(entry.used);
        const limit = Number(entry.limit);
        if (!Number.isNaN(used) && limit > 0) {
          windows.push({
            label: key,
            usedPercent: (used / limit) * 100,
            resetAt: entry.resetAt,
          });
        }
      }
    }

    return { ...defaultSnapshot, windows };
  } catch (err) {
    return { ...defaultSnapshot, error: err instanceof Error ? err.message : String(err) };
  }
}
