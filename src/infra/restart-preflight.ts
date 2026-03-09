import { readConfigFileSnapshot } from "../config/config.js";

type RestartConfigPreflight =
  | {
      ok: true;
    }
  | {
      ok: false;
      path: string;
      issues: string[];
      message: string;
    };

function formatIssueLine(path: string, message: string) {
  return `- ${path || "<root>"}: ${message}`;
}

export async function checkRestartConfigPreflight(): Promise<RestartConfigPreflight> {
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.valid) return { ok: true };

  const issues =
    snapshot.issues.length > 0
      ? snapshot.issues.map((issue) => formatIssueLine(issue.path, issue.message))
      : ["- <root>: Unknown validation issue."];
  const message = [
    "Restart blocked: config is invalid.",
    `Path: ${snapshot.path}`,
    ...issues,
    "Run: clawdbot doctor --non-interactive",
  ].join("\n");

  return {
    ok: false,
    path: snapshot.path,
    issues,
    message,
  };
}
