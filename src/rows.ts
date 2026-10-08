import type { IgnoreSource, TraceEntry } from "./trace.js";
import { traceDecision } from "./trace.js";

/**
 * Day 8 item 3: the UI's pure half. One row per input path, carrying the
 * verdict, the winning `file:line:pattern` (or an explicit "no rule
 * matched" marker — distinct from an empty string, which a renderer could
 * mistake for "no explanation needed"), and the losing entries with their
 * outcomes. Presentation shape only, never matching logic: every value
 * here is read straight off `traceDecision`'s own `TraceEntry` fields,
 * including `pattern`, which already carries its own leading "!" in-band
 * (day 5 item 1) — `buildRows` does not reconstruct it.
 */
export interface RowEntry {
  file: string;
  line: number;
  pattern: string;
  outcome: TraceEntry["outcome"];
}

export interface Row {
  path: string;
  ignored: boolean;
  winner: string;
  losers: RowEntry[];
}

export function buildRows(sources: IgnoreSource[], paths: string[]): Row[] {
  return paths.map((targetPath) => {
    const result = traceDecision(sources, targetPath, false);
    const won = result.entries.find((e) => e.outcome === "won");
    const winner = won ? `${won.file}:${won.line}:${won.pattern}` : "no rule matched";
    const losers: RowEntry[] = result.entries
      .filter((e) => e.outcome !== "won")
      .map((e) => ({ file: e.file, line: e.line, pattern: e.pattern, outcome: e.outcome }));

    return { path: targetPath, ignored: result.ignored, winner, losers };
  });
}
