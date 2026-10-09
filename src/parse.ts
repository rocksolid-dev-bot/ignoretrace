export type IgnoreLineKind = "blank" | "comment" | "rule";

export interface IgnoreLine {
  line: number;
  raw: string;
  kind: IgnoreLineKind;
  /** Only present when kind === "rule". */
  pattern?: string;
  negated?: boolean;
  directoryOnly?: boolean;
  anchored?: boolean;
  /**
   * True when the rule's pattern began with an (unescaped) leading "/" in
   * the file — stripped from `pattern` for matching the same way the
   * trailing "/" is stripped into `directoryOnly`, and re-added by
   * `src/trace.ts`'s `toEntry` so the printed pattern reads the way git
   * itself prints it (leading slash included). Day 4 item 2: without
   * this flag, stripping the leading slash leaves no record that the
   * rule must stay *anchored* — the bug this flag exists to prevent.
   */
  leadingSlash?: boolean;
}

/**
 * Parses the raw lines of a .gitignore-style file, preserving blank lines
 * and comments with their original 1-based line numbers so a later trace
 * can cite "line 7" and mean line 7. Rule lines additionally carry the
 * resolved pattern and its flags (negated, directoryOnly, anchored).
 *
 * Grammar handled here (gitignore(5), the subset in scope for day 1):
 *  - a leading "!" negates the rule; it can be escaped with "\!" to mean a
 *    literal "!" at the start of the pattern.
 *  - a leading "#" would be a comment; a literal leading "#" is written
 *    "\#" and is NOT treated as a comment (not exercised by day-1 fixtures
 *    but resolved here since it is the same escape mechanism as "\!").
 *  - a single trailing "/" (not escaped) marks the rule directory-only and
 *    is stripped from the pattern.
 *  - the pattern is "anchored" (matches only relative to the directory of
 *    the .gitignore file) if it contains a "/" other than a single
 *    trailing one — i.e. any "/" before the last character.
 *  - "**", character classes, and other grammar are out of scope for day 1
 *    (BRIEF.md / TODAY.md item 3, note 5).
 */
/**
 * Measured against git directly (not assumed from a description, mistake
 * 9): trailing spaces are stripped unless escaped with a backslash, in
 * which case the backslash is consumed and the space is kept literal —
 * `foo.txt   ` ignores `foo.txt`, but `foo.txt\ ` (escaped) ignores only
 * the literal `foo.txt ` (trailing space and all), not `foo.txt`. A
 * trailing *tab* is gitignore(5)'s "trailing spaces" are stripped unless
 * escaped" — tabs are left alone, full stop: `b.o<TAB>` does not strip to
 * `b.o`, and git answers `b.o` **not ignored** (mistake 78 — the day-9
 * oracle). Leading whitespace is unaffected by this function; it is
 * trimmed separately by the caller, matching day-1 behavior (out of
 * today's scope).
 */
function stripTrailingUnescapedSpaces(s: string): string {
  let result = s;
  while (result.length > 0 && result.endsWith(" ")) {
    let backslashes = 0;
    let idx = result.length - 2;
    while (idx >= 0 && result[idx] === "\\") {
      backslashes++;
      idx--;
    }
    if (backslashes % 2 === 1) {
      // The trailing space is escaped: drop the one backslash that
      // escapes it, keep the space itself, and stop — git does not
      // cascade past an escaped space to strip further ones behind it.
      result = result.slice(0, result.length - 2) + result.slice(result.length - 1);
      break;
    }
    result = result.slice(0, -1);
  }
  return result;
}

export function parseIgnoreFile(text: string): IgnoreLine[] {
  const lines = text.split(/\r\n|\n|\r/);
  // A trailing newline produces one extra empty element after split; drop
  // it so a file ending in "\n" doesn't report a phantom final blank line
  // that was never actually in the input.
  if (lines.length > 0 && lines[lines.length - 1] === "" && /\r\n|\n|\r$/.test(text)) {
    lines.pop();
  }

  return lines.map((raw, index) => {
    const line = index + 1;
    const trimmed = stripTrailingUnescapedSpaces(raw.replace(/^[ \t]+/, ""));

    if (trimmed === "") {
      return { line, raw, kind: "blank" as const };
    }

    // An unescaped leading "#" is a comment. A leading "\#" is a literal
    // "#" and falls through to rule parsing below.
    if (trimmed.startsWith("#")) {
      return { line, raw, kind: "comment" as const };
    }

    return { line, raw, kind: "rule" as const, ...parseRule(trimmed) };
  });
}

function parseRule(trimmed: string): {
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
  leadingSlash: boolean;
} {
  let body = trimmed;

  // Leading negation: "!pattern". An escaped "\!" is a literal "!" and the
  // rule is not negated.
  let negated = false;
  if (body.startsWith("!")) {
    negated = true;
    body = body.slice(1);
  } else if (body.startsWith("\\!")) {
    body = body.slice(1); // drop the backslash, keep the literal "!"
  }

  // Leading escaped "#": drop the backslash, keep the literal "#".
  if (body.startsWith("\\#")) {
    body = body.slice(1);
  }

  // Trailing "/" (unescaped) marks directory-only and is stripped from the
  // pattern used for matching.
  let directoryOnly = false;
  if (body.endsWith("/") && !body.endsWith("\\/")) {
    directoryOnly = true;
    body = body.slice(0, -1);
  }

  // A leading "/" also anchors the rule to the .gitignore's own directory
  // (gitignore(5)): strip it from the matching pattern the same way the
  // trailing "/" is stripped into `directoryOnly`, but — the day-4 item-2
  // trap — `anchored` must be set explicitly here, true, rather than left
  // to the `body.includes("/")` check below. Stripped naively, "/dir"
  // would read as containing no further "/" and come back unanchored,
  // which would make it match at any depth (`sub/dir`) when git does not.
  let leadingSlash = false;
  if (body.startsWith("/")) {
    leadingSlash = true;
    body = body.slice(1);
  }

  // Anchored if a "/" appears anywhere before the final character of what
  // remains (i.e. not just a trailing slash, which was already stripped
  // above), OR the pattern had a leading "/" of its own (stripped above,
  // so it no longer shows up in this scan). A pattern like "a/b" is
  // anchored; "*.log" is not; "/root.txt" is (leadingSlash).
  const anchored = leadingSlash || body.includes("/");

  return { pattern: body, negated, directoryOnly, anchored, leadingSlash };
}
