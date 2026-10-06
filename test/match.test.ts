import { describe, expect, it } from "vitest";
import { parseIgnoreFile, matchPath } from "../src/index.js";

const basicGitignore = "build/\n!build/keep.txt\n*.log\n!important.log";

describe("matchPath", () => {
  const rules = parseIgnoreFile(basicGitignore);

  it("returns exactly one match for app.log", () => {
    const matches = matchPath(rules, "app.log", false);
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(3);
  });

  it("returns exactly two matches for important.log, in file order", () => {
    const matches = matchPath(rules, "important.log", false);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.line)).toEqual([3, 4]);
  });

  it("returns zero matches for a path nothing touches", () => {
    const matches = matchPath(rules, "notignored.txt", false);
    expect(matches).toHaveLength(0);
  });

  it("matches build/keep.txt against both the directory rule and its negation", () => {
    const matches = matchPath(rules, "build/keep.txt", false);
    expect(matches.map((m) => m.line)).toEqual([1, 2]);
  });
});
