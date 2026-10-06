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
});
