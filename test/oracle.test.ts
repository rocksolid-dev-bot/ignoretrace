import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseIgnoreFile, matchPath, type IgnoreLine } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "basic");

/**
 * The oracle has a trap, measured in BRIEF.md and not negotiable:
 *  - verdict comes from `git check-ignore --no-index` (rc 0 = ignored).
 *  - winning rule comes from `git check-ignore -v --no-index`, which
 *    prints `<file>:<line>:<pattern>\t<path>`.
 *  - `-v` exits 0 whenever *a pattern matched*, including a negation, so
 *    its exit code is never the verdict on its own.
 */
function gitVerdictIgnored(cwd: string, relPath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "--no-index", relPath], { cwd });
    return true; // rc=0
  } catch {
    return false; // rc=1 (or other non-zero, not expected here)
  }
}

interface GitWinningRule {
  file: string;
  line: number;
  pattern: string;
}

function gitWinningRule(cwd: string, relPath: string): GitWinningRule | null {
  try {
    const out = execFileSync("git", ["check-ignore", "-v", "--no-index", relPath], {
      cwd,
      encoding: "utf8",
    });
    const [locator] = out.split("\t");
    const firstColon = locator.indexOf(":");
    const lastColon = locator.lastIndexOf(":");
    return {
      file: locator.slice(0, firstColon),
      line: Number(locator.slice(firstColon + 1, lastColon)),
      pattern: locator.slice(lastColon + 1),
    };
  } catch {
    return null; // rc=1: -v found nothing either
  }
}

/**
 * Day-1 verdict over a *single* ruleset, honoring the parent-exclusion
 * rule within that one file: a path cannot be re-included by a negation
 * if a parent directory of that path is itself excluded. This is not the
 * cross-file "nearest .gitignore wins" precedence (day 3) — it is the
 * single-file semantics that build/keep.txt's own fixture requires to get
 * a correct verdict at all.
 */
function ignoredVerdict(rules: IgnoreLine[], relPath: string, isDir: boolean): boolean {
  const segments = relPath.split("/").filter(Boolean);
  if (segments.length > 1) {
    const parentPath = segments.slice(0, -1).join("/");
    if (ignoredVerdict(rules, parentPath, true)) return true;
  }
  const matches = matchPath(rules, relPath, isDir);
  if (matches.length === 0) return false;
  const winner = matches[matches.length - 1];
  return !winner.negated;
}

/**
 * The winning rule obeys the same parent-exclusion short-circuit as
 * `ignoredVerdict`: if an ancestor directory is itself excluded, that is
 * the rule that actually decided the path's fate — a deeper negation that
 * never took effect is not "the winner" just because it is last in file
 * order (this is exactly build/keep.txt's trap).
 */
function winningRule(rules: IgnoreLine[], relPath: string, isDir: boolean): IgnoreLine | null {
  const segments = relPath.split("/").filter(Boolean);
  if (segments.length > 1) {
    const parentPath = segments.slice(0, -1).join("/");
    if (ignoredVerdict(rules, parentPath, true)) {
      return winningRule(rules, parentPath, true);
    }
  }
  const matches = matchPath(rules, relPath, isDir);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

describe("oracle: parseIgnoreFile + matchPath vs git check-ignore", () => {
  let topRules: IgnoreLine[];
  let subRules: IgnoreLine[];

  beforeAll(() => {
    const topText = readFileSync(path.join(fixtureRoot, ".gitignore"), "utf8");
    const subText = readFileSync(path.join(fixtureRoot, "sub", ".gitignore"), "utf8");
    topRules = parseIgnoreFile(topText);
    subRules = parseIgnoreFile(subText);
  });

  // relPath/isDir are what git sees (repo-root relative); localPath is what
  // our single-file ruleset sees relative to its own .gitignore's directory
  // (cross-file combination is day 3, so sub/debug.log is tested against
  // sub/.gitignore alone — the file that actually decides its fate here).
  const cases: Array<{ relPath: string; rules: "top" | "sub"; localPath: string }> = [
    { relPath: "build/keep.txt", rules: "top", localPath: "build/keep.txt" },
    { relPath: "app.log", rules: "top", localPath: "app.log" },
    { relPath: "important.log", rules: "top", localPath: "important.log" },
    { relPath: "sub/debug.log", rules: "sub", localPath: "debug.log" },
    { relPath: "notignored.txt", rules: "top", localPath: "notignored.txt" },
  ];

  it.each(cases)("verdict for $relPath matches plain check-ignore", ({ relPath, rules, localPath }) => {
    const ruleset = rules === "top" ? topRules : subRules;
    const expected = gitVerdictIgnored(fixtureRoot, relPath);
    const actual = ignoredVerdict(ruleset, localPath, false);
    expect(actual).toBe(expected);
  });

  it("notignored.txt matches nothing and -v also reports rc=1", () => {
    const expected = gitWinningRule(fixtureRoot, "notignored.txt");
    expect(expected).toBeNull();
    const winner = winningRule(topRules, "notignored.txt", false);
    expect(winner).toBeNull();
  });

  const winningCases: Array<{ relPath: string; rules: "top" | "sub"; localPath: string }> = [
    { relPath: "build/keep.txt", rules: "top", localPath: "build/keep.txt" },
    { relPath: "app.log", rules: "top", localPath: "app.log" },
    { relPath: "important.log", rules: "top", localPath: "important.log" },
    { relPath: "sub/debug.log", rules: "sub", localPath: "debug.log" },
  ];

  it.each(winningCases)(
    "winning rule for $relPath matches -v's file, line and pattern",
    ({ relPath, rules, localPath }) => {
      const expected = gitWinningRule(fixtureRoot, relPath);
      expect(expected).not.toBeNull();
      const ruleset = rules === "top" ? topRules : subRules;
      const winner = winningRule(ruleset, localPath, false);
      expect(winner).not.toBeNull();
      expect(winner!.line).toBe(expected!.line);
      // git's -v prints the pattern as literally written (with its "!"
      // prefix, if any); our structured pattern strips that into
      // `negated`, so compare against the raw line instead.
      expect(winner!.raw.trim()).toBe(expected!.pattern);
    },
  );
});

/**
 * Day 2: the full pattern grammar, against the "patterns" fixture (root
 * .gitignore only, no nested file — see test/fixture-shape.test.ts for why
 * it exists). Each feature gets a hit and its near-miss as two separate
 * assertions, not one line joined by "or" (mistake 61).
 */
describe("oracle: pattern grammar (**, ?, character classes) vs git check-ignore", () => {
  const patternsRoot = path.join(__dirname, "fixtures", "patterns");
  let patternRules: IgnoreLine[];

  beforeAll(() => {
    const text = readFileSync(path.join(patternsRoot, ".gitignore"), "utf8");
    patternRules = parseIgnoreFile(text);
  });

  it("src/notes.tmp is ignored by the unanchored *.tmp", () => {
    expect(gitVerdictIgnored(patternsRoot, "src/notes.tmp")).toBe(true);
    expect(ignoredVerdict(patternRules, "src/notes.tmp", false)).toBe(true);
  });

  it("a/b/cache/x.o is ignored by **/cache/ (leading **)", () => {
    expect(gitVerdictIgnored(patternsRoot, "a/b/cache/x.o")).toBe(true);
    expect(ignoredVerdict(patternRules, "a/b/cache/x.o", false)).toBe(true);
  });

  it("logs/2026/jan.txt is ignored by logs/** (trailing **)", () => {
    expect(gitVerdictIgnored(patternsRoot, "logs/2026/jan.txt")).toBe(true);
    expect(ignoredVerdict(patternRules, "logs/2026/jan.txt", false)).toBe(true);
  });

  it("doc/x/y/draft.md is ignored by doc/**/draft.md (mid **); doc/x/y/final.md is not", () => {
    expect(gitVerdictIgnored(patternsRoot, "doc/x/y/draft.md")).toBe(true);
    expect(ignoredVerdict(patternRules, "doc/x/y/draft.md", false)).toBe(true);
    expect(gitVerdictIgnored(patternsRoot, "doc/x/y/final.md")).toBe(false);
    expect(ignoredVerdict(patternRules, "doc/x/y/final.md", false)).toBe(false);
  });

  it("file1.txt is ignored by file?.txt; fileAB.txt is not (two chars, not one)", () => {
    expect(gitVerdictIgnored(patternsRoot, "file1.txt")).toBe(true);
    expect(ignoredVerdict(patternRules, "file1.txt", false)).toBe(true);
    expect(gitVerdictIgnored(patternsRoot, "fileAB.txt")).toBe(false);
    expect(ignoredVerdict(patternRules, "fileAB.txt", false)).toBe(false);
  });

  it("report7.txt is ignored by report[0-9].txt; reportX.txt is not (outside the class)", () => {
    expect(gitVerdictIgnored(patternsRoot, "report7.txt")).toBe(true);
    expect(ignoredVerdict(patternRules, "report7.txt", false)).toBe(true);
    expect(gitVerdictIgnored(patternsRoot, "reportX.txt")).toBe(false);
    expect(ignoredVerdict(patternRules, "reportX.txt", false)).toBe(false);
  });

  it("keep.txt matches nothing — the plain near-miss", () => {
    expect(gitVerdictIgnored(patternsRoot, "keep.txt")).toBe(false);
    expect(ignoredVerdict(patternRules, "keep.txt", false)).toBe(false);
  });

  it("src/notes.tmp is matched by the root *.tmp, winning rule is .gitignore line 1", () => {
    const expected = gitWinningRule(patternsRoot, "src/notes.tmp");
    expect(expected).not.toBeNull();
    expect(expected!.line).toBe(1);
    const winner = winningRule(patternRules, "src/notes.tmp", false);
    expect(winner).not.toBeNull();
    expect(winner!.line).toBe(1);
  });
});
