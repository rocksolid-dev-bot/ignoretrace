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
    const trimmed = raw.trim();

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

  // Anchored if a "/" appears anywhere before the final character of what
  // remains (i.e. not just a trailing slash, which was already stripped
  // above). A pattern like "a/b" is anchored; "*.log" is not.
  const anchored = body.includes("/");

  return { pattern: body, negated, directoryOnly, anchored };
}
