import { execSync } from "node:child_process";

let cached: boolean | undefined;

/** Check if `rtk` binary is available in PATH. Result is cached. */
export function isRtkAvailable(): boolean {
  if (cached !== undefined) return cached;
  try {
    execSync("rtk --version", { stdio: "ignore", timeout: 3000 });
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

/** Reset cached result (for testing). */
export function resetDetectionCache(): void {
  cached = undefined;
}
