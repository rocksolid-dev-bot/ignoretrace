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

function toEntry(m: RawMatch, outcome: TraceOutcome): TraceEntry {
  // Restore the leading "/" `parseIgnoreFile` strips into `leadingSlash`
  // and the trailing "/" it strips into `directoryOnly`, so `pattern`
  // reads the way the file (and git's own `-v` output) wrote it —
  // "/dir/" must render back as exactly "/dir/", never "dir", "/dir" or
  // "dir/" (day 4 item 2's second trap). Day 5 item 1: a negated winner
  // must render its own "!" too, in-band in `pattern` (not left for a
  // caller to reconstruct from the separate `negated` field) — that is
  // the string that answers "why is this file not ignored?", the
  // product's whole pitch.
  const rawPattern = m.rule.pattern ?? "";
  // A "rule"-kind line's pattern can only ever begin with a literal "!"
  // or "#" via gitignore's own escape ("\!" or "\#"): a true leading "!"
  // is stripped into `negated` before `pattern` is set, and an unescaped
  // leading "#" would have been classified as a comment line, never a
  // rule at all. So restoring exactly one backslash here whenever an
  // unnegated pattern starts with "!" or "#" reproduces git's own `-v`
  // output byte-for-byte, including the `\!literal` case (day 5 item 1
  // criterion 4) — never double-escaping, never dropping it.
  const escapedLiteral = !m.rule.negated && (rawPattern.startsWith("!") || rawPattern.startsWith("#"));
  const pattern =
    (m.rule.negated ? "!" : "") +
    (m.rule.leadingSlash ? "/" : "") +
    (escapedLiteral ? "\\" : "") +
    rawPattern +
    (m.rule.directoryOnly ? "/" : "");
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
 * At the first ignored ancestor, git never descends into it, so it is
 * the rule that decided *that ancestor* — not whatever rule happens to
 * sort last among the full path's own matches — that decides `path`
 * too (day 4 item 3's fix: the previous version scoped exclusion by
 * *source directory*, so a rule from a shallower source, always
 * including the root, kept competing for `won` even though an ancestor
 * it itself excluded had already settled the question). Every other
 * matched rule on the full path is `lost-parent-excluded`: widened from
 * "git never read this file" to "this rule was powerless because an
 * ancestor was excluded", which is what the label has always meant for a
 * negation sitting inside the excluded directory itself. `matchPath`
 * already extends a directory-only rule to match a deeper file via its
 * ancestor segment (`**\/cache` deciding `cache/x.o` at `isDir=false`);
 * that is reused here via `rawMatches`, never re-implemented.
 */
export function traceDecision(sources: IgnoreSource[], path: string, isDir: boolean): TraceResult {
  let ancestorWinner: RawMatch | null = null;
  for (const ancestor of ancestorsOf(path)) {
    const ancestorMatches = rawMatches(sources, ancestor, true);
    if (isIgnoredByRawMatches(ancestorMatches)) {
      ancestorWinner = ancestorMatches[ancestorMatches.length - 1];
      break;
    }
  }

  const all = rawMatches(sources, path, isDir);

  if (ancestorWinner !== null) {
    const winner = ancestorWinner;
    const entries = all.map((m) => {
      const isWinner = m.source === winner.source && m.rule === winner.rule;
      return toEntry(m, isWinner ? "won" : "lost-parent-excluded");
    });

    return { path, ignored: true, entries };
  }

  const winner = all.length > 0 ? all[all.length - 1] : null;
  const entries = all.map((m) => toEntry(m, m === winner ? "won" : "lost-outranked"));

  return { path, ignored: isIgnoredByRawMatches(all), entries };
}
