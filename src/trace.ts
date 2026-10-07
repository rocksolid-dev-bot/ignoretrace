import type { IgnoreLine } from "./parse.js";
import { matchPath } from "./match.js";

/** One `.gitignore` file's rules, located by the directory it governs
 * (relative to the repo root; `""` is the root itself). */
export interface IgnoreSource {
  dir: string;
  lines: IgnoreLine[];
}

export type TraceOutcome = "won" | "lost-outranked" | "lost-parent-excluded";

export interface TraceEntry {
  file: string;
  line: number;
  pattern: string;
  negated: boolean;
  outcome: TraceOutcome;
}

export interface TraceResult {
  path: string;
  ignored: boolean;
  entries: TraceEntry[];
}

function sourceFile(dir: string): string {
  return dir === "" ? ".gitignore" : `${dir}/.gitignore`;
}

/** A source governs `targetPath` only when the path sits inside its dir
 * (the root source governs everything; any other source only governs
 * paths strictly nested under its own directory, never itself). */
function sourceApplies(dir: string, targetPath: string): boolean {
  if (dir === "") return true;
  return targetPath.startsWith(`${dir}/`);
}

function relativeToSource(dir: string, targetPath: string): string {
  return dir === "" ? targetPath : targetPath.slice(dir.length + 1);
}

/** Shallowest -> deepest by directory depth, stable at equal depth. This
 * single ordering *is* nearest-.gitignore-wins: concatenated with
 * last-match-wins, the deepest applicable source's matches always sort
 * last, so no separate depth comparison is needed (behaviour 2). */
function byDepth(sources: IgnoreSource[]): IgnoreSource[] {
  const depth = (dir: string) => (dir === "" ? 0 : dir.split("/").length);
  return [...sources].sort((a, b) => depth(a.dir) - depth(b.dir));
}

interface RawMatch {
  source: IgnoreSource;
  rule: IgnoreLine;
}

/** Every rule that matches `targetPath` across all applicable sources,
 * concatenated shallowest -> deepest, in file order within each source
 * (behaviours 1-2, scope + order, with no parent-exclusion applied yet). */
function rawMatches(sources: IgnoreSource[], targetPath: string, isDir: boolean): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const source of byDepth(sources)) {
    if (!sourceApplies(source.dir, targetPath)) continue;
    const relPath = relativeToSource(source.dir, targetPath);
    for (const rule of matchPath(source.lines, relPath, isDir)) {
      matches.push({ source, rule });
    }
  }
  return matches;
}

function isIgnoredByRawMatches(matches: RawMatch[]): boolean {
  if (matches.length === 0) return false;
  return !matches[matches.length - 1].rule.negated;
}

/** Ancestor directories of `targetPath`, shallowest -> deepest, excluding
 * the root and excluding the path's own final segment (that segment is
 * the path being decided, not one of its ancestors). */
function ancestorsOf(targetPath: string): string[] {
  const segments = targetPath.split("/").filter((s) => s.length > 0);
  const ancestors: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join("/"));
  }
  return ancestors;
}

function isAtOrBelow(sourceDir: string, excludedDir: string): boolean {
  return sourceDir === excludedDir || sourceDir.startsWith(`${excludedDir}/`);
}

function toEntry(m: RawMatch, outcome: TraceOutcome): TraceEntry {
  // Restore the leading "/" `parseIgnoreFile` strips into `leadingSlash`
  // and the trailing "/" it strips into `directoryOnly`, so `pattern`
  // reads the way the file (and git's own `-v` output) wrote it —
  // "/dir/" must render back as exactly "/dir/", never "dir", "/dir" or
  // "dir/" (day 4 item 2's second trap). `negated` already carries the
  // leading "!" out-of-band the same way, so it is never re-added here.
  const pattern =
    (m.rule.leadingSlash ? "/" : "") + (m.rule.pattern ?? "") + (m.rule.directoryOnly ? "/" : "");
  return {
    file: sourceFile(m.source.dir),
    line: m.rule.line,
    pattern,
    negated: m.rule.negated ?? false,
    outcome,
  };
}

/**
 * Resolves the full precedence chain for `path` across every given
 * `.gitignore` source, recording every rule that matched with its file,
 * line, pattern and outcome — including the losers, which is the
 * project's whole point (BRIEF.md).
 *
 * Behaviour 3 (parent exclusion): walking ancestor directories shallowest
 * -> deepest and deciding each as a directory with behaviours 1-2 only.
 * At the first ignored ancestor, the path is ignored and every rule from
 * a source at or below that ancestor is `lost-parent-excluded` — git
 * never reads those files, because it never descends into the excluded
 * directory. `matchPath` already extends a directory-only rule to match a
 * deeper file via its ancestor segment (`**\/cache` deciding `cache/x.o`
 * at `isDir=false`); that is reused here via `rawMatches`, never
 * re-implemented, so the excluding rule always itself re-appears as a
 * match on the full path from an unaffected (shallower) source.
 */
export function traceDecision(sources: IgnoreSource[], path: string, isDir: boolean): TraceResult {
  let excludedAt: string | null = null;
  for (const ancestor of ancestorsOf(path)) {
    if (isIgnoredByRawMatches(rawMatches(sources, ancestor, true))) {
      excludedAt = ancestor;
      break;
    }
  }

  const all = rawMatches(sources, path, isDir);

  if (excludedAt !== null) {
    const unaffected = all.filter((m) => !isAtOrBelow(m.source.dir, excludedAt!));
    const winner = unaffected.length > 0 ? unaffected[unaffected.length - 1] : null;

    const entries = all.map((m) => {
      if (isAtOrBelow(m.source.dir, excludedAt!)) return toEntry(m, "lost-parent-excluded");
      return toEntry(m, m === winner ? "won" : "lost-outranked");
    });

    return { path, ignored: true, entries };
  }

  const winner = all.length > 0 ? all[all.length - 1] : null;
  const entries = all.map((m) => toEntry(m, m === winner ? "won" : "lost-outranked"));

  return { path, ignored: isIgnoredByRawMatches(all), entries };
}
