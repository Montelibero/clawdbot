/**
 * Compress exec tool output for the tool_result_persist hook.
 * Strips noise (progress bars, test passes, download output, ANSI artifacts)
 * and collapses consecutive duplicates.
 *
 * Only applied when compression ratio > 20% to avoid mangling small/useful output.
 */

const MAX_COMPRESSED_LINES = 300;
const MIN_COMPRESSION_RATIO = 0.2;

/** Patterns matching noisy lines that can be stripped. */
const NOISE_PATTERNS: RegExp[] = [
  // Test pass lines (vitest, jest, mocha)
  /^\s*[✓✔√⦿●]\s/,
  /^\s*PASS\s/,
  /^\s*✓\s+\d+\s/,
  // Progress / download bars
  /^\s*[\[█▓▒░\]]{3,}/,
  /\d+%\s*\|/,
  /downloading|Downloading|fetching|Fetching|resolving|Resolving/i,
  // npm/pnpm install noise
  /^\s*added \d+ packages?/,
  /^\s*Progress: resolved \d+/,
  /^\s*Packages: \+\d+/,
  // Spinner / animation artifacts
  /^[\s⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷]+$/,
  // Empty lines (consecutive will be collapsed)
  /^\s*$/,
  // ANSI escape-only lines
  /^(\x1b\[[0-9;]*m\s*)+$/,
];

/** Check if a line is "noise" that can be stripped. */
function isNoiseLine(line: string): boolean {
  // Strip ANSI codes for pattern matching
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
  return NOISE_PATTERNS.some((p) => p.test(clean));
}

/**
 * Collapse consecutive duplicate or near-duplicate lines into a count.
 * Lines are considered duplicates after stripping ANSI codes and numbers.
 */
function collapseConsecutiveDuplicates(lines: string[]): string[] {
  if (lines.length === 0) return lines;

  const result: string[] = [];
  let prevKey = "";
  let prevLine = "";
  let count = 1;

  const normalizeForDedup = (line: string): string =>
    line
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\d+/g, "N")
      .trim();

  for (const line of lines) {
    const key = normalizeForDedup(line);
    if (key === prevKey && key.length > 0) {
      count++;
    } else {
      if (count > 2) {
        result.push(`  ... (${count - 1} similar lines omitted)`);
      } else if (count === 2) {
        result.push(prevLine);
      }
      result.push(line);
      prevKey = key;
      prevLine = line;
      count = 1;
    }
  }
  // Flush last group
  if (count > 2) {
    result.push(`  ... (${count - 1} similar lines omitted)`);
  } else if (count === 2) {
    result.push(prevLine);
  }

  return result;
}

/**
 * Truncate lines with middle omission if over MAX_COMPRESSED_LINES.
 */
function truncateWithMiddleOmission(lines: string[]): string[] {
  if (lines.length <= MAX_COMPRESSED_LINES) return lines;

  const headCount = Math.floor(MAX_COMPRESSED_LINES * 0.6);
  const tailCount = MAX_COMPRESSED_LINES - headCount - 1;
  const omitted = lines.length - headCount - tailCount;

  return [
    ...lines.slice(0, headCount),
    `\n... (${omitted} lines omitted) ...\n`,
    ...lines.slice(lines.length - tailCount),
  ];
}

/**
 * Compress exec tool output text.
 * Returns compressed text, or the original if compression isn't worthwhile.
 */
export function compressExecOutput(output: string): string {
  const originalLength = output.length;
  if (originalLength < 200) return output;

  const lines = output.split("\n");

  // Strip noise lines
  let filtered = lines.filter((line) => !isNoiseLine(line));

  // Collapse consecutive empty lines to a single one
  filtered = filtered.reduce<string[]>((acc, line) => {
    if (line.trim() === "" && acc.length > 0 && acc[acc.length - 1].trim() === "") {
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);

  // Collapse consecutive duplicates
  filtered = collapseConsecutiveDuplicates(filtered);

  // Truncate if still too long
  filtered = truncateWithMiddleOmission(filtered);

  const compressed = filtered.join("\n");
  const ratio = 1 - compressed.length / originalLength;

  // Only use compressed version if savings are worthwhile
  if (ratio < MIN_COMPRESSION_RATIO) return output;

  return compressed;
}
