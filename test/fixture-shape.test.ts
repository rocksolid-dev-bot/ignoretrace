import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseIgnoreFile } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mistake 63: four green wildcard assertions in "basic" read as "wildcards
 * are tested" but are not — every wildcard decision there sits at depth 0.
 * This test asserts, mechanically and by running git rather than trusting
 * a table, that "patterns" has at least one path where an *unanchored*
 * wildcard in the *root* .gitignore decides a *nested* path, and that
 * "basic" has none — the falsifying half in the same test.
 *
 * A path counts when all three hold:
 *  - it contains "/" (nested, not depth 0);
 *  - the file git's `-v` names as deciding it is the root .gitignore
 *    (not a nested .gitignore, which would be cross-file/day-3);
 *  - that rule's pattern contains no "/" (unanchored).
 */
function decidingFileAndPattern(
  cwd: string,
  relPath: string,
): { file: string; pattern: string } | null {
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
      pattern: locator.slice(lastColon + 1),
    };
  } catch {
    return null; // rc=1: -v found no deciding rule
  }
}

function allRepoPaths(cwd: string): string[] {
  // The candidate set must include ignored files too — that is the whole
  // point of this fixture — so `git ls-files` (tracked only) is wrong:
  // `git add -A` never tracked the ignored ones in the first place.
  // `--others --ignored --exclude-standard` plus the normally-tracked
  // files together give every path make-fixtures.sh created, without
  // hand-maintaining a path list here.
  const tracked = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const ignored = execFileSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard"],
    { cwd, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  return [...tracked, ...ignored];
}

function countUnanchoredRootNestedDecisions(fixtureDir: string): number {
  let count = 0;
  for (const relPath of allRepoPaths(fixtureDir)) {
    if (!relPath.includes("/")) continue; // depth 0, not nested
    const decided = decidingFileAndPattern(fixtureDir, relPath);
    if (decided === null) continue; // not ignored, nothing decided it
    if (decided.file !== ".gitignore") continue; // decided by a nested file (day 3)
    if (decided.pattern.includes("/")) continue; // anchored, not unanchored
    count++;
  }
  return count;
}

describe("fixture shape: unanchored-wildcard-decides-nested-path (mistake 63)", () => {
  it("'patterns' yields at least one such path", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "patterns");
    expect(countUnanchoredRootNestedDecisions(fixtureDir)).toBeGreaterThanOrEqual(1);
  });

  it("'basic' yields none — the falsification", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "basic");
    expect(countUnanchoredRootNestedDecisions(fixtureDir)).toBe(0);
  });
});

/**
 * Cross-file precedence (day 3's subject): a path counts when the file
 * `git check-ignore -v --no-index` names as deciding it is a *nested*
 * .gitignore, not the root one. The verdict (ignored / not ignored) is
 * read from plain `git check-ignore` (rc 0/1) and never from `-v`'s exit
 * code — `-v` returns 0 for a winning *negation* too (mistake 61's trap,
 * measured in BRIEF.md), so an all-ignored or all-not-ignored result from
 * this predicate would prove nothing about which direction was exercised.
 */
function isIgnoredPlain(cwd: string, relPath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "--no-index", relPath], { cwd, encoding: "utf8" });
    return true; // rc=0: ignored
  } catch {
    return false; // rc=1: not ignored
  }
}

function crossFileDecisions(fixtureDir: string): {
  total: number;
  ignored: number;
  notIgnored: number;
} {
  let total = 0;
  let ignored = 0;
  let notIgnored = 0;
  for (const relPath of allRepoPaths(fixtureDir)) {
    const decided = decidingFileAndPattern(fixtureDir, relPath);
    if (decided === null) continue; // nothing matched it
    if (decided.file === ".gitignore") continue; // root decided it, not cross-file
    total++;
    if (isIgnoredPlain(fixtureDir, relPath)) {
      ignored++;
    } else {
      notIgnored++;
    }
  }
  return { total, ignored, notIgnored };
}

/**
 * Day 4 item 1: count rule lines, across every .gitignore file in a
 * fixture (found by walking, not hand-listed), whose pattern begins with
 * "/" (after the optional leading "!"). Mechanical, off the fixture's own
 * files — never off TODAY.md's table.
 */
function findGitignoreFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findGitignoreFiles(full));
    } else if (entry.name === ".gitignore") {
      out.push(full);
    }
  }
  return out;
}

function countLeadingSlashRuleLines(fixtureDir: string): number {
  let count = 0;
  for (const file of findGitignoreFiles(fixtureDir)) {
    const lines = readFileSync(file, "utf8").split(/\r\n|\n|\r/);
    for (const raw of lines) {
      const trimmed = raw.replace(/^[ \t]+/, "");
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const body = trimmed.startsWith("!") ? trimmed.slice(1) : trimmed;
      if (body.startsWith("/")) count++;
    }
  }
  return count;
}

describe("fixture shape: leading-slash rule lines (day 4, mistake 65)", () => {
  it("'edges' has at least 3 leading-slash rule lines", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "edges");
    expect(countLeadingSlashRuleLines(fixtureDir)).toBeGreaterThanOrEqual(3);
  });

  it("'basic' has none — the falsification", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "basic");
    expect(countLeadingSlashRuleLines(fixtureDir)).toBe(0);
  });
});

/**
 * Of the eight "edges" paths, the predicate for "decided by a
 * leading-slash rule" (git's -v names a pattern starting with "/") must
 * come back >= 2 ignored and >= 1 not-ignored — a fixture that only
 * agrees in one direction proves nothing (mistake 64).
 */
function decidedByLeadingSlash(fixtureDir: string, relPath: string): boolean {
  const decided = decidingFileAndPattern(fixtureDir, relPath);
  return decided !== null && decided.pattern.startsWith("/");
}

describe("fixture shape: 'edges' leading-slash deciding rule, both directions (day 4)", () => {
  it("at least 2 ignored and 1 not-ignored among the eight edges paths", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "edges");
    const paths = [
      "root-only.txt",
      "sub/root-only.txt",
      "dir/x.txt",
      "sub/dir/y.txt",
      "build/sub/deep.tmp",
      "vendor/keep.me",
      "notes.tmp",
      "plain.md",
    ];
    let decided = 0;
    let notDecided = 0;
    for (const p of paths) {
      if (decidedByLeadingSlash(fixtureDir, p)) decided++;
      else notDecided++;
    }
    console.log(`edges leading-slash deciding: decided=${decided} notDecided=${notDecided}`);
    expect(decided).toBeGreaterThanOrEqual(2);
    expect(notDecided).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Day 8 item 1: closes the orphan import. `lines`' root .gitignore has 2
 * comment lines and 3 blank lines before its first rule, so the three
 * rule lines (2, 5, 8) are not the same sequence as their 1-based rule
 * indices among rule lines (1, 2, 3) — the first fixture where the two
 * differ. `basic` is the falsification: every one of its rule lines
 * equals its own rule index, because it has no comments or blanks above
 * its rules.
 */
function ruleLinesAndIndicesDiffer(fixtureDir: string): boolean {
  const content = readFileSync(path.join(fixtureDir, ".gitignore"), "utf8");
  const parsed = parseIgnoreFile(content);
  const ruleLines = parsed.filter((l) => l.kind === "rule");
  return ruleLines.some((rule, idx) => rule.line !== idx + 1);
}

describe("fixture shape: rule line numbers vs rule indices (day 8 item 1)", () => {
  it("'lines' rule lines are not the same sequence as their 1-based rule indices", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "lines");
    expect(ruleLinesAndIndicesDiffer(fixtureDir)).toBe(true);
  });

  it("'basic' rule lines equal their rule indices — the falsification", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "basic");
    expect(ruleLinesAndIndicesDiffer(fixtureDir)).toBe(false);
  });
});

describe("fixture shape: cross-file precedence (day 3's subject)", () => {
  it("'nested' yields at least 3 cross-file decisions, with both verdicts present", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "nested");
    const result = crossFileDecisions(fixtureDir);
    console.log(
      `nested cross-file decisions: total=${result.total} ignored=${result.ignored} notIgnored=${result.notIgnored}`,
    );
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.ignored).toBeGreaterThanOrEqual(1);
    expect(result.notIgnored).toBeGreaterThanOrEqual(1);
  });

  it("'patterns' yields none — the falsification", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "patterns");
    const total = crossFileDecisions(fixtureDir).total;
    console.log(`patterns cross-file decisions: total=${total}`);
    expect(total).toBe(0);
  });
});
