import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

describe("fixture shape: cross-file precedence (day 3's subject)", () => {
  it("'nested' yields at least 3 cross-file decisions, with both verdicts present", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "nested");
    const result = crossFileDecisions(fixtureDir);
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.ignored).toBeGreaterThanOrEqual(1);
    expect(result.notIgnored).toBeGreaterThanOrEqual(1);
  });

  it("'patterns' yields none — the falsification", () => {
    const fixtureDir = path.join(__dirname, "fixtures", "patterns");
    expect(crossFileDecisions(fixtureDir).total).toBe(0);
  });
});
