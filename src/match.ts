import type { IgnoreLine } from "./parse.js";

/**
 * Converts a day-1 subset of gitignore glob syntax ("*" and "?", no "**",
 * no character classes — those are day 2, BRIEF.md scope) into a regex
 * source that matches a single path segment or a full anchored path.
 */
function globToRegexSource(glob: string): string {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return out;
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
    const regex = new RegExp(`^${globToRegexSource(rule.pattern)}$`);

    if (rule.anchored) {
      if (rule.directoryOnly) {
        // The pattern must match some directory-valued prefix of the path:
        // every prefix except possibly the last (which is only a
        // directory if the path itself is one).
        for (let i = 1; i <= segments.length; i++) {
          const isLastPrefix = i === segments.length;
          if (isLastPrefix && !isDir) continue;
          const prefix = segments.slice(0, i).join("/");
          if (regex.test(prefix)) {
            matches.push(rule);
            break;
          }
        }
      } else if (regex.test(segments.join("/"))) {
        matches.push(rule);
      }
    } else {
      // Non-anchored: the pattern matches a single path segment at any
      // depth (it behaves like "**/pattern"). directoryOnly restricts the
      // final segment to a directory.
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
