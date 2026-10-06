export type IgnoreLineKind = "blank" | "comment" | "rule";

export interface IgnoreLine {
  line: number;
  raw: string;
  kind: IgnoreLineKind;
}

/**
 * Parses the raw lines of a .gitignore-style file, preserving blank lines
 * and comments with their original 1-based line numbers so a later trace
 * can cite "line 7" and mean line 7. Only the trivial classification is
 * done here: blank / comment / rule. Rule flags (pattern, negated,
 * directoryOnly, anchored) are added in item 2.
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
    let kind: IgnoreLineKind;
    if (trimmed === "") {
      kind = "blank";
    } else if (trimmed.startsWith("#")) {
      kind = "comment";
    } else {
      kind = "rule";
    }
    return { line, raw, kind };
  });
}
