import type { IgnoreLine } from "./parse.js";

/**
 * Converts a single gitignore path *segment* (no "/" inside — "**" as a
 * whole segment is handled separately by `matchSegments`, never reaching
 * here) into a regex source: "*" and "?" as day 1, plus day 2's character
 * classes ("[...]", "[!...]" negated) and "\" escapes (a backslash makes
 * the following character literal, including "*", "?", "[" themselves).
 */
function segmentGlobToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "\\" && i + 1 < glob.length) {
      out += glob[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      let j = i + 1;
      let negate = false;
      if (glob[j] === "!" || glob[j] === "^") {
        negate = true;
        j++;
      }
      let body = "";
      while (j < glob.length && glob[j] !== "]") {
        body += glob[j];
        j++;
      }
      if (j < glob.length && body.length > 0) {
        // A well-formed, non-empty class: pass the body through (escaping
        // only the regex-class-breaking "\" itself), negate with "^" the
        // way regex does, matching gitignore's "[!...]"/"[^...]".
        out += `[${negate ? "^" : ""}${body.replace(/\\/g, "\\\\")}]`;
        i = j;
      } else {
        // Unterminated "[": gitignore has no such case in scope here;
        // treat the bracket as a literal rather than throwing.
        out += "\\[";
      }
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return out;
}

/**
 * Matches an anchored pattern's segments against a path's segments,
 * handling "**" in all three gitignore positions (leading, trailing,
 * mid-pattern) by letting it consume zero or more whole path segments —
 * the only place "**" differs from "*": it crosses "/" boundaries.
 */
function matchSegments(patternSegs: string[], pathSegs: string[]): boolean {
  if (patternSegs.length === 0) return pathSegs.length === 0;
  const [head, ...restPattern] = patternSegs;
  if (head === "**") {
    for (let i = 0; i <= pathSegs.length; i++) {
      if (matchSegments(restPattern, pathSegs.slice(i))) return true;
    }
    return false;
  }
  if (pathSegs.length === 0) return false;
  if (!new RegExp(`^${segmentGlobToRegex(head)}$`).test(pathSegs[0])) return false;
  return matchSegments(restPattern, pathSegs.slice(1));
}

/**
 * Returns every rule (in file order) that matches the given path, given
 * whether the path itself is a directory. This is the whole matching
 * surface: it does not decide a verdict (last-match-wins) or apply the
 * parent-exclusion rule — those are the oracle's and day 3's job
 * respectively. It returns the losers as well as the winner, because the
 * losers are the point of the project (BRIEF.md).
 */
export function matchPath(rules: IgnoreLine[], path: string, isDir: boolean): IgnoreLine[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const matches: IgnoreLine[] = [];

  for (const rule of rules) {
    if (rule.kind !== "rule" || rule.pattern === undefined) continue;

    if (rule.anchored) {
      const patternSegs = rule.pattern.split("/");
      if (rule.directoryOnly) {
        // The pattern must match some directory-valued prefix of the path:
        // every prefix except possibly the last (which is only a
        // directory if the path itself is one).
        for (let i = 1; i <= segments.length; i++) {
          const isLastPrefix = i === segments.length;
          if (isLastPrefix && !isDir) continue;
          if (matchSegments(patternSegs, segments.slice(0, i))) {
            matches.push(rule);
            break;
          }
        }
      } else if (matchSegments(patternSegs, segments)) {
        matches.push(rule);
      }
    } else {
      // Non-anchored: the pattern (never containing "/", so never "**")
      // matches a single path segment at any depth (it behaves like
      // "**/pattern"). directoryOnly restricts the final segment to a
      // directory.
      const regex = new RegExp(`^${segmentGlobToRegex(rule.pattern)}$`);
      for (let i = 0; i < segments.length; i++) {
        const isLastSegment = i === segments.length - 1;
        if (rule.directoryOnly && isLastSegment && !isDir) continue;
        if (regex.test(segments[i])) {
          matches.push(rule);
          break;
        }
      }
    }
  }

  return matches;
}
