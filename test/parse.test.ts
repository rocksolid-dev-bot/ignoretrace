import { describe, expect, it } from "vitest";
import { parseIgnoreFile } from "../src/index.js";

describe("parseIgnoreFile", () => {
  it("retains blank and comment lines with their 1-based line numbers", () => {
    const input = "# c\n\na.txt\n\nb.txt";
    const result = parseIgnoreFile(input);
    expect(result.map((entry) => entry.line)).toEqual([1, 2, 3, 4, 5]);
    expect(result).toHaveLength(5);
  });

  it("classifies each line's kind correctly", () => {
    const input = "# c\n\na.txt\n\nb.txt";
    const result = parseIgnoreFile(input);
    expect(result.map((entry) => entry.kind)).toEqual([
      "comment",
      "blank",
      "rule",
      "blank",
      "rule",
    ]);
  });

  it("preserves the raw text of each line", () => {
    const input = "# c\n\na.txt\n\nb.txt";
    const result = parseIgnoreFile(input);
    expect(result.map((entry) => entry.raw)).toEqual(["# c", "", "a.txt", "", "b.txt"]);
  });

  it("does not report a phantom trailing blank line for a file ending in a newline", () => {
    const input = "a.txt\nb.txt\n";
    const result = parseIgnoreFile(input);
    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.line)).toEqual([1, 2]);
  });

  it("treats a line with only whitespace as blank", () => {
    const input = "a.txt\n   \nb.txt";
    const result = parseIgnoreFile(input);
    expect(result[1].kind).toBe("blank");
  });

  it("parses the basic fixture's rule flags exactly", () => {
    const input = "build/\n!build/keep.txt\n*.log\n!important.log";
    const result = parseIgnoreFile(input);
    expect(result[0]).toMatchObject({
      pattern: "build",
      directoryOnly: true,
      negated: false,
    });
    expect(result[1]).toMatchObject({
      pattern: "build/keep.txt",
      negated: true,
      anchored: true,
    });
    expect(result[2]).toMatchObject({
      pattern: "*.log",
      anchored: false,
    });
    expect(result[3]).toMatchObject({
      pattern: "important.log",
      negated: true,
      anchored: false,
    });
  });

  it("resolves an escaped leading '!' to a literal, non-negated pattern", () => {
    const input = "\\!literal";
    const result = parseIgnoreFile(input);
    expect(result[0]).toMatchObject({
      pattern: "!literal",
      negated: false,
    });
  });

  // Measured directly against git (scratch repo, not assumed from a
  // description — mistake 9): `git check-ignore -v` on "foo.txt   " shows
  // the pattern as "foo.txt" (trailing spaces stripped) and matches a
  // file named "foo.txt"; "bar.txt\ " shows "bar.txt\ " and matches only
  // a file literally named "bar.txt " (trailing space kept, backslash
  // consumed) — not "bar.txt" without it.
  it("strips unescaped trailing spaces from a pattern", () => {
    const result = parseIgnoreFile("foo.txt   ");
    expect(result[0]).toMatchObject({ pattern: "foo.txt" });
  });

  it("keeps a backslash-escaped trailing space literal, consuming the backslash", () => {
    const result = parseIgnoreFile("bar.txt\\ ");
    expect(result[0]).toMatchObject({ pattern: "bar.txt " });
  });
});
