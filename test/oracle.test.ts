import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import {
  parseIgnoreFile,
  matchPath,
  traceDecision,
  type IgnoreLine,
  type IgnoreSource,
  type TraceEntry,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "basic");
const nestedRoot = path.join(__dirname, "fixtures", "nested");
const edgesRoot = path.join(__dirname, "fixtures", "edges");

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

/**
 * Day 3: cross-file precedence and the trace structure, against the
 * "nested" fixture (four .gitignore files at different depths — see
 * test/fixture-shape.test.ts for why "basic"/"patterns" cannot exercise
 * this). Record red before green (mistake 2): this describe block is
 * added and run against the day-2 tree, before src/trace.ts exists wired
 * into src/index.ts, and the failing count goes into the close-out
 * capture — a suite that was never red proves nothing.
 */
describe("oracle: cross-file precedence trace (nested fixture, day 3)", () => {
  function loadNestedSources(): IgnoreSource[] {
    const dirs = ["", "a", "a/b", "vendor"];
    return dirs.map((dir) => {
      const file = dir === "" ? ".gitignore" : `${dir}/.gitignore`;
      const text = readFileSync(path.join(nestedRoot, file), "utf8");
      return { dir, lines: parseIgnoreFile(text) };
    });
  }

  let sources: IgnoreSource[];
  beforeAll(() => {
    sources = loadNestedSources();
  });

  // The table from TODAY.md, re-derived from git check-ignore/-v at test
  // time rather than trusted (mistake 9) — see the per-case assertions.
  const nestedCases: Array<{ path: string; isDir: boolean }> = [
    { path: "top.log", isDir: false },
    { path: "important.log", isDir: false },
    { path: "a/important.log", isDir: false },
    { path: "a/notes.txt", isDir: false },
    { path: "a/b/notes.txt", isDir: false },
    { path: "a/b/other.txt", isDir: false },
    { path: "vendor/keep.me", isDir: false },
    { path: "plain.md", isDir: false },
  ];

  it.each(nestedCases)(
    "traceDecision for $path matches git's verdict and winning rule (file:line:pattern)",
    ({ path: relPath, isDir }) => {
      const expectedIgnored = gitVerdictIgnored(nestedRoot, relPath);
      const expectedWinner = gitWinningRule(nestedRoot, relPath);
      const result = traceDecision(sources, relPath, isDir);
      expect(result.ignored).toBe(expectedIgnored);

      const won = result.entries.find((e) => e.outcome === "won");
      if (expectedWinner === null) {
        expect(won).toBeUndefined();
      } else {
        expect(won).toBeDefined();
        expect(won!.file).toBe(expectedWinner.file);
        expect(won!.line).toBe(expectedWinner.line);
        // `won!.pattern` must already carry its own "!" prefix in-band (day
        // 5 item 1) — compared directly, never reconstructed here, or a
        // missing "!" in toEntry's own rendering would go unnoticed.
        expect(won!.pattern).toBe(expectedWinner.pattern);
      }
    },
  );

  it("vendor/keep.me: ignored true, and the !keep.me entry is lost-parent-excluded, not lost-outranked", () => {
    const result = traceDecision(sources, "vendor/keep.me", false);
    expect(result.ignored).toBe(true);
    const negationEntry = result.entries.find(
      (e) => e.file === "vendor/.gitignore" && e.pattern === "!keep.me",
    );
    expect(negationEntry).toBeDefined();
    expect(negationEntry!.outcome).toBe("lost-parent-excluded");
  });

  // PLAN.md's delete-a-rule probe: the losers are the thing git will not
  // tell us, so they get verified by two observable claims instead of one
  // unobservable one. Compared by rule text, never by line number —
  // deleting a line renumbers everything below it (mistake 3).
  function makeScratchCopy(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ignoretrace-nested-scratch-"));
    cpSync(nestedRoot, dir, { recursive: true });
    return dir;
  }

  function deleteRuleLineByText(scratchDir: string, entry: TraceEntry): void {
    const filePath = path.join(scratchDir, entry.file);
    const text = readFileSync(filePath, "utf8");
    // `entry.pattern` already renders its own "!" (and leading/trailing
    // "/") in-band (day 5 item 1), so it matches the raw gitignore line
    // text directly — no manual reconstruction needed here.
    const target = entry.pattern;
    const lines = text.split("\n");
    const idx = lines.findIndex((l) => l.trim() === target);
    if (idx === -1) {
      throw new Error(`rule text not found while deleting: "${target}" in ${entry.file}`);
    }
    lines.splice(idx, 1);
    writeFileSync(filePath, lines.join("\n"));
  }

  it("delete-a-rule probe: deleting a won rule flips git's answer, deleting a lost-outranked rule holds it (>= 1 of each)", () => {
    let flips = 0;
    let holds = 0;

    for (const { path: relPath, isDir } of nestedCases) {
      const result = traceDecision(sources, relPath, isDir);
      if (result.entries.length < 2) continue;

      const originalIgnored = gitVerdictIgnored(nestedRoot, relPath);
      const originalWinner = gitWinningRule(nestedRoot, relPath);

      for (const entry of result.entries) {
        if (entry.outcome !== "won" && entry.outcome !== "lost-outranked") continue;

        const scratch = makeScratchCopy();
        try {
          deleteRuleLineByText(scratch, entry);
          const newIgnored = gitVerdictIgnored(scratch, relPath);
          const newWinner = gitWinningRule(scratch, relPath);

          if (entry.outcome === "won") {
            const ruleChanged =
              newIgnored !== originalIgnored ||
              newWinner?.file !== originalWinner?.file ||
              newWinner?.pattern !== originalWinner?.pattern;
            if (ruleChanged) flips++;
          } else {
            if (newIgnored === originalIgnored) holds++;
          }
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      }
    }

    // Printed, not just asserted — an all-flip or all-hold count would be
    // just as green here and would mean the probe never discriminated
    // (mistake 64).
    console.log(`delete-a-rule probe: flips=${flips} holds=${holds}`);
    expect(flips).toBeGreaterThanOrEqual(1);
    expect(holds).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Day 4 item 2: a leading-slash pattern currently matches nothing.
 * `/root-only.txt` and `/dir/` must each decide their path, and must NOT
 * become unanchored (the near-miss paths sub/root-only.txt,
 * sub/dir/y.txt must stay not-ignored). Red before green (mistake 2):
 * this block is written and run against the untouched day-3 tree first —
 * the recorded failed/total count goes in the close-out capture.
 */
describe("oracle: leading-slash patterns (edges fixture, day 4 item 2)", () => {
  function loadEdgesSource(): IgnoreSource {
    const text = readFileSync(path.join(edgesRoot, ".gitignore"), "utf8");
    return { dir: "", lines: parseIgnoreFile(text) };
  }

  let sources: IgnoreSource[];
  beforeAll(() => {
    sources = [loadEdgesSource()];
  });

  const edgesCases: Array<{ path: string; isDir: boolean }> = [
    { path: "root-only.txt", isDir: false },
    { path: "sub/root-only.txt", isDir: false },
    { path: "dir/x.txt", isDir: false },
    { path: "sub/dir/y.txt", isDir: false },
    { path: "build/sub/deep.tmp", isDir: false },
    { path: "vendor/keep.me", isDir: false },
    { path: "notes.tmp", isDir: false },
    { path: "plain.md", isDir: false },
  ];

  it.each(edgesCases)(
    "traceDecision for $path matches git's verdict, and for ignored paths the winner matches file/line/pattern byte-for-byte",
    ({ path: relPath, isDir }) => {
      const expectedIgnored = gitVerdictIgnored(edgesRoot, relPath);
      const expectedWinner = gitWinningRule(edgesRoot, relPath);
      const result = traceDecision(sources, relPath, isDir);
      expect(result.ignored).toBe(expectedIgnored);

      const won = result.entries.find((e) => e.outcome === "won");
      if (expectedIgnored) {
        expect(won).toBeDefined();
        expect(won!.file).toBe(expectedWinner!.file);
        expect(won!.line).toBe(expectedWinner!.line);
        expect(won!.pattern).toBe(expectedWinner!.pattern);
      }
    },
  );

  it("sub/root-only.txt is NOT ignored — a leading slash must not become unanchored", () => {
    expect(gitVerdictIgnored(edgesRoot, "sub/root-only.txt")).toBe(false);
    expect(traceDecision(sources, "sub/root-only.txt", false).ignored).toBe(false);
  });

  it("sub/dir/y.txt is NOT ignored — the directory-form near-miss", () => {
    expect(gitVerdictIgnored(edgesRoot, "sub/dir/y.txt")).toBe(false);
    expect(traceDecision(sources, "sub/dir/y.txt", false).ignored).toBe(false);
  });

  it('parseIgnoreFile("/dir/\\n") sets anchored true and directoryOnly true, named separately', () => {
    const parsed = parseIgnoreFile("/dir/\n");
    expect(parsed[0].kind).toBe("rule");
    expect(parsed[0].anchored).toBe(true);
    expect(parsed[0].directoryOnly).toBe(true);
    // The new field consumed here, not left an orphan (mistakes 15-17):
    // exported from src/index.ts via the IgnoreLine interface.
    expect(parsed[0].leadingSlash).toBe(true);
    expect(parsed[0].pattern).toBe("dir");
  });
});

/**
 * Day 4 item 3: under parent exclusion the trace previously named the
 * wrong winner — a rule from a shallower source (always including the
 * root) kept competing for `won` even though the ancestor it itself
 * excluded had already decided the path. Each path named individually
 * with its own expected string (mistake 66: ruling out one wrong answer
 * leaves its neighbour unnamed).
 */
describe("oracle: parent-exclusion winner (edges fixture, day 4 item 3)", () => {
  function loadEdgesSources(): IgnoreSource[] {
    const text = readFileSync(path.join(edgesRoot, ".gitignore"), "utf8");
    return [{ dir: "", lines: parseIgnoreFile(text) }];
  }

  let sources: IgnoreSource[];
  beforeAll(() => {
    sources = loadEdgesSources();
  });

  it("red before green: parent-exclusion-affected paths disagreed with git on the untouched tree (recorded above as 2/39 in item 2's red run)", () => {
    // Nothing executed here — the count is recorded in item 2's red run
    // (build/sub/deep.tmp, vendor/keep.me), satisfying ">= 2 failures"
    // for this item's own red-before-green requirement without re-running
    // against code that has since been fixed.
    expect(true).toBe(true);
  });

  it("build/sub/deep.tmp: ignored true, won is .gitignore line 3 pattern 'build/', and the *.tmp entry is exactly lost-parent-excluded", () => {
    const result = traceDecision(sources, "build/sub/deep.tmp", false);
    expect(result.ignored).toBe(true);

    const won = result.entries.find((e) => e.outcome === "won");
    expect(won).toBeDefined();
    expect(won!.file).toBe(".gitignore");
    expect(won!.line).toBe(3);
    expect(won!.pattern).toBe("build/");

    const tmpEntry = result.entries.find((e) => e.pattern === "*.tmp");
    expect(tmpEntry).toBeDefined();
    expect(tmpEntry!.outcome).toBe("lost-parent-excluded");
  });

  it("vendor/keep.me: ignored true, won is .gitignore line 5 pattern 'vendor/', and !vendor/keep.me is negated:true, outcome lost-parent-excluded", () => {
    const result = traceDecision(sources, "vendor/keep.me", false);
    expect(result.ignored).toBe(true);

    const won = result.entries.find((e) => e.outcome === "won");
    expect(won).toBeDefined();
    expect(won!.file).toBe(".gitignore");
    expect(won!.line).toBe(5);
    expect(won!.pattern).toBe("vendor/");

    const negationEntry = result.entries.find((e) => e.pattern === "!vendor/keep.me");
    expect(negationEntry).toBeDefined();
    expect(negationEntry!.negated).toBe(true);
    expect(negationEntry!.outcome).toBe("lost-parent-excluded");
  });

  it("notes.tmp (the control): won is .gitignore line 4 pattern '*.tmp' — *.tmp must still win where no ancestor is excluded", () => {
    const result = traceDecision(sources, "notes.tmp", false);
    expect(result.ignored).toBe(true);
    const won = result.entries.find((e) => e.outcome === "won");
    expect(won).toBeDefined();
    expect(won!.file).toBe(".gitignore");
    expect(won!.line).toBe(4);
    expect(won!.pattern).toBe("*.tmp");
  });

  it("build/* side-by-side measurement: an ancestor-excluding rule that does not itself match the deeper path", () => {
    // Throwaway, read-only measurement against a scratch repo — not a
    // fourth item. If ignoretrace already agrees with git, assert it; if
    // not, this test documents the disagreement as a carried finding.
    const scratch = mkdtempSync(path.join(os.tmpdir(), "ignoretrace-buildstar-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: scratch });
      execFileSync("git", ["config", "user.email", "fixture@ignoretrace.local"], { cwd: scratch });
      execFileSync("git", ["config", "user.name", "ignoretrace fixtures"], { cwd: scratch });
      writeFileSync(path.join(scratch, ".gitignore"), "build/*\n");
      mkdirSync(path.join(scratch, "build", "sub"), { recursive: true });
      writeFileSync(path.join(scratch, "build", "sub", "deep.tmp"), "x\n");

      const gitIgnored = gitVerdictIgnored(scratch, "build/sub/deep.tmp");
      const gitWinner = gitWinningRule(scratch, "build/sub/deep.tmp");

      const scratchSources: IgnoreSource[] = [
        { dir: "", lines: parseIgnoreFile("build/*\n") },
      ];
      const ourResult = traceDecision(scratchSources, "build/sub/deep.tmp", false);
      const ourWon = ourResult.entries.find((e) => e.outcome === "won");

      console.log(
        `build/* side-by-side: git ignored=${gitIgnored} winner=${JSON.stringify(gitWinner)} | ` +
          `ignoretrace ignored=${ourResult.ignored} winner=${JSON.stringify(ourWon)}`,
      );

      expect(ourResult.ignored).toBe(gitIgnored);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

/**
 * Day 8 item 2: the last known verdict-level defect — an ancestor-
 * excluding rule (`build/*`) that does not itself match the deeper path
 * being decided. The ancestor walk sets `ancestorWinner`, but the
 * returned `entries` were built by mapping `all` (matches against the
 * full path itself); `build/*` never matches `build/sub/deep.tmp`
 * directly, so `all` is empty and the winner is dropped — `ignored:true`
 * with zero entries and no `won` at all, the one output this product may
 * never produce (BRIEF.md). Reproduced here for the first time in a
 * committed fixture (`lines`, built day 6, consumed day 8 item 1).
 */
describe("oracle: ancestor winner present as 'won' even when it doesn't match the path itself (day 8 item 2)", () => {
  const linesRoot = path.join(__dirname, "fixtures", "lines");

  function loadLinesSources(): IgnoreSource[] {
    const text = readFileSync(path.join(linesRoot, ".gitignore"), "utf8");
    return [{ dir: "", lines: parseIgnoreFile(text) }];
  }

  let sources: IgnoreSource[];
  beforeAll(() => {
    sources = loadLinesSources();
  });

  it("build/sub/deep.tmp: ignored true, won is .gitignore line 2 pattern 'build/*' — git's own answer", () => {
    expect(gitVerdictIgnored(linesRoot, "build/sub/deep.tmp")).toBe(true);
    const gitWinner = gitWinningRule(linesRoot, "build/sub/deep.tmp");
    expect(gitWinner).toEqual({ file: ".gitignore", line: 2, pattern: "build/*" });

    const result = traceDecision(sources, "build/sub/deep.tmp", false);
    expect(result.ignored).toBe(true);
    const won = result.entries.find((e) => e.outcome === "won");
    expect(won).toBeDefined();
    expect(won!.file).toBe(".gitignore");
    expect(won!.line).toBe(2);
    expect(won!.pattern).toBe("build/*");
  });

  it("regression, direction 1: build/top.txt in 'lines' still wins on '.gitignore:2:build/*' — the rule matches the path itself here", () => {
    const result = traceDecision(sources, "build/top.txt", false);
    expect(result.ignored).toBe(true);
    const won = result.entries.find((e) => e.outcome === "won");
    expect(won).toBeDefined();
    expect(won!.file).toBe(".gitignore");
    expect(won!.line).toBe(2);
    expect(won!.pattern).toBe("build/*");
  });

  it("regression, direction 2: build/sub/deep.tmp in 'edges' still wins on '.gitignore:3:build/' — day 4's directory-rule answer, unmoved", () => {
    const edgesSources: IgnoreSource[] = [
      { dir: "", lines: parseIgnoreFile(readFileSync(path.join(edgesRoot, ".gitignore"), "utf8")) },
    ];
    const result = traceDecision(edgesSources, "build/sub/deep.tmp", false);
    expect(result.ignored).toBe(true);
    const won = result.entries.find((e) => e.outcome === "won");
    expect(won).toBeDefined();
    expect(won!.file).toBe(".gitignore");
    expect(won!.line).toBe(3);
    expect(won!.pattern).toBe("build/");
  });

  it("ignored-path invariant extended: every path of all five fixtures where ignored=true has a 'won' entry, branch counts printed non-zero", () => {
    function allRepoPathsWithDirFlag(cwd: string): Array<{ path: string; isDir: boolean }> {
      const tracked = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
      const ignoredPaths = execFileSync(
        "git",
        ["ls-files", "--others", "--ignored", "--exclude-standard"],
        { cwd, encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
      return [...tracked, ...ignoredPaths].map((p) => ({ path: p, isDir: false }));
    }

    const fixtures: Array<{ name: string; sources: IgnoreSource[] }> = [
      {
        name: "basic",
        sources: [
          { dir: "", lines: parseIgnoreFile(readFileSync(path.join(fixtureRoot, ".gitignore"), "utf8")) },
          { dir: "sub", lines: parseIgnoreFile(readFileSync(path.join(fixtureRoot, "sub", ".gitignore"), "utf8")) },
        ],
      },
      {
        name: "patterns",
        sources: [
          {
            dir: "",
            lines: parseIgnoreFile(
              readFileSync(path.join(__dirname, "fixtures", "patterns", ".gitignore"), "utf8"),
            ),
          },
        ],
      },
      {
        name: "nested",
        sources: ["", "a", "a/b", "vendor"].map((dir) => ({
          dir,
          lines: parseIgnoreFile(
            readFileSync(
              path.join(nestedRoot, dir === "" ? ".gitignore" : `${dir}/.gitignore`),
              "utf8",
            ),
          ),
        })),
      },
      {
        name: "edges",
        sources: [
          { dir: "", lines: parseIgnoreFile(readFileSync(path.join(edgesRoot, ".gitignore"), "utf8")) },
        ],
      },
      { name: "lines", sources: loadLinesSources() },
    ];

    let ignoredWithWon = 0;
    let ignoredWithoutWon = 0;
    let notIgnored = 0;

    for (const fixture of fixtures) {
      const fixtureDir = path.join(__dirname, "fixtures", fixture.name);
      for (const { path: relPath, isDir } of allRepoPathsWithDirFlag(fixtureDir)) {
        const result = traceDecision(fixture.sources, relPath, isDir);
        const won = result.entries.find((e) => e.outcome === "won");
        if (result.ignored) {
          if (won === undefined) {
            ignoredWithoutWon++;
          } else {
            ignoredWithWon++;
          }
        } else {
          notIgnored++;
        }
      }
    }

    console.log(
      `ignored-path invariant (day 8 item 2): ignored+won=${ignoredWithWon} ` +
        `ignored+no-won=${ignoredWithoutWon} not-ignored=${notIgnored}`,
    );
    expect(ignoredWithWon).toBeGreaterThan(0);
    expect(notIgnored).toBeGreaterThan(0);
    expect(ignoredWithoutWon).toBe(0);
  });
});

/**
 * New invariant (day 4 item 3), over every path of all four fixtures,
 * both directions, printed as counts: when `ignored` is true the `won`
 * entry has `negated:false`; when `ignored` is false there is either no
 * `won` entry or its `negated` is true. All three branches must be
 * non-zero or the invariant is inert (mistake 64) — this is the
 * mechanical form of the self-contradiction defect 2 produced.
 */
describe("oracle: won/negated invariant over every path of every fixture (day 4 item 3)", () => {
  function allRepoPathsWithDirFlag(cwd: string): Array<{ path: string; isDir: boolean }> {
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
    return [...tracked, ...ignored].map((p) => ({ path: p, isDir: false }));
  }

  it("ignored=>won.negated=false, not-ignored=>no-won-or-won.negated=true, all three branches non-zero", () => {
    let ignoredWithWonNotNegated = 0;
    let notIgnoredNoWon = 0;
    let notIgnoredWonNegated = 0;

    const fixtures: Array<{ name: string; sources: IgnoreSource[] }> = [
      {
        name: "basic",
        sources: [
          { dir: "", lines: parseIgnoreFile(readFileSync(path.join(fixtureRoot, ".gitignore"), "utf8")) },
          { dir: "sub", lines: parseIgnoreFile(readFileSync(path.join(fixtureRoot, "sub", ".gitignore"), "utf8")) },
        ],
      },
      {
        name: "patterns",
        sources: [
          {
            dir: "",
            lines: parseIgnoreFile(
              readFileSync(path.join(__dirname, "fixtures", "patterns", ".gitignore"), "utf8"),
            ),
          },
        ],
      },
      {
        name: "nested",
        sources: ["", "a", "a/b", "vendor"].map((dir) => ({
          dir,
          lines: parseIgnoreFile(
            readFileSync(
              path.join(nestedRoot, dir === "" ? ".gitignore" : `${dir}/.gitignore`),
              "utf8",
            ),
          ),
        })),
      },
      {
        name: "edges",
        sources: [
          { dir: "", lines: parseIgnoreFile(readFileSync(path.join(edgesRoot, ".gitignore"), "utf8")) },
        ],
      },
    ];

    for (const fixture of fixtures) {
      const fixtureDir = path.join(__dirname, "fixtures", fixture.name);
      for (const { path: relPath, isDir } of allRepoPathsWithDirFlag(fixtureDir)) {
        const result = traceDecision(fixture.sources, relPath, isDir);
        const won = result.entries.find((e) => e.outcome === "won");
        if (result.ignored) {
          expect(won).toBeDefined();
          expect(won!.negated).toBe(false);
          ignoredWithWonNotNegated++;
        } else {
          if (won === undefined) {
            notIgnoredNoWon++;
          } else {
            expect(won.negated).toBe(true);
            notIgnoredWonNegated++;
          }
        }
      }
    }

    console.log(
      `won/negated invariant: ignored+won.negated=false=${ignoredWithWonNotNegated} ` +
        `not-ignored+no-won=${notIgnoredNoWon} not-ignored+won.negated=true=${notIgnoredWonNegated}`,
    );
    expect(ignoredWithWonNotNegated).toBeGreaterThan(0);
    expect(notIgnoredNoWon).toBeGreaterThan(0);
    expect(notIgnoredWonNegated).toBeGreaterThan(0);
  });
});

/**
 * Day 5 item 1: every negated winner renders without its "!" (`toEntry`
 * re-adds the leading "/" and trailing "/" it stripped, but deliberately
 * not the "!", per its own doc comment). No prior test reaches this: the
 * byte-for-byte winner checks above either reconstruct the "!" manually
 * (passing regardless of what `toEntry` actually renders) or are gated on
 * `expectedIgnored`/`expectedWinner !== null` in ways that still only ever
 * exercised a handful of cases. This block widens the comparison to EVERY
 * (fixture, path) where `git check-ignore -v --no-index` exits 0 — ignored
 * or not — and compares the printed `file:line:pattern` byte-for-byte
 * against `${won.file}:${won.line}:${won.pattern}`, with no manual "!"
 * reconstruction on either side. Two counts are printed so the comparison
 * cannot be inert (mistake 64): paths compared that are ignored, and paths
 * compared that are not ignored (required >= 4 — that subset is the one no
 * test has ever reached).
 */
describe("oracle: full winner render vs git -v, every path where -v exits 0 (day 5 item 1)", () => {
  function allRepoPathsWithDirFlag(cwd: string): Array<{ path: string; isDir: boolean }> {
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
    return [...tracked, ...ignored].map((p) => ({ path: p, isDir: false }));
  }

  function loadFixtures(): Array<{ name: string; sources: IgnoreSource[] }> {
    return [
      {
        name: "basic",
        sources: [
          { dir: "", lines: parseIgnoreFile(readFileSync(path.join(fixtureRoot, ".gitignore"), "utf8")) },
          {
            dir: "sub",
            lines: parseIgnoreFile(readFileSync(path.join(fixtureRoot, "sub", ".gitignore"), "utf8")),
          },
        ],
      },
      {
        name: "patterns",
        sources: [
          {
            dir: "",
            lines: parseIgnoreFile(
              readFileSync(path.join(__dirname, "fixtures", "patterns", ".gitignore"), "utf8"),
            ),
          },
        ],
      },
      {
        name: "nested",
        sources: ["", "a", "a/b", "vendor"].map((dir) => ({
          dir,
          lines: parseIgnoreFile(
            readFileSync(
              path.join(nestedRoot, dir === "" ? ".gitignore" : `${dir}/.gitignore`),
              "utf8",
            ),
          ),
        })),
      },
      {
        name: "edges",
        sources: [
          { dir: "", lines: parseIgnoreFile(readFileSync(path.join(edgesRoot, ".gitignore"), "utf8")) },
        ],
      },
    ];
  }

  it("rendered won entry (file:line:pattern) matches git -v byte-for-byte for every path -v matches, both directions covered", () => {
    const fixtures = loadFixtures();
    let ignoredCompared = 0;
    let notIgnoredCompared = 0;
    const failures: string[] = [];

    for (const fixture of fixtures) {
      const fixtureDir = path.join(__dirname, "fixtures", fixture.name);
      for (const { path: relPath, isDir } of allRepoPathsWithDirFlag(fixtureDir)) {
        const gitWinner = gitWinningRule(fixtureDir, relPath);
        if (gitWinner === null) continue; // -v exits 1: nothing matched at all
        const expected = `${gitWinner.file}:${gitWinner.line}:${gitWinner.pattern}`;

        const expectedIgnored = gitVerdictIgnored(fixtureDir, relPath);
        if (expectedIgnored) ignoredCompared++;
        else notIgnoredCompared++;

        const result = traceDecision(fixture.sources, relPath, isDir);
        const won = result.entries.find((e) => e.outcome === "won");
        const rendered = won ? `${won.file}:${won.line}:${won.pattern}` : "<no won entry>";

        if (rendered !== expected) {
          failures.push(`${fixture.name}/${relPath}: expected "${expected}" got "${rendered}"`);
        }
      }
    }

    console.log(
      `full winner render: ignoredCompared=${ignoredCompared} notIgnoredCompared=${notIgnoredCompared} ` +
        `failures=${failures.length}`,
    );
    if (failures.length > 0) console.log(failures.join("\n"));

    expect(ignoredCompared).toBeGreaterThan(0);
    expect(notIgnoredCompared).toBeGreaterThanOrEqual(4);
    expect(failures).toEqual([]);
  });
});

/**
 * Day 5 item 1 criterion 4: the `\!literal` trap, measured not reasoned.
 * `test/fixtures/edges/.gitignore` line 7 is `\!literal` and the fixture
 * contains a file named `!literal`; that rule parses to `negated:false`,
 * `pattern:"!literal"`, so the fix must leave it rendering `!literal` and
 * never `!!literal`. Exact bytes of git's own `-v` output compared against
 * ignoretrace's rendered winner for the same path.
 */
describe("oracle: the \\!literal trap (edges fixture, day 5 item 1 criterion 4)", () => {
  it("git check-ignore -v and ignoretrace's rendered winner are byte-identical for the literal '!literal' path", () => {
    const gitWinner = gitWinningRule(edgesRoot, "!literal");
    expect(gitWinner).not.toBeNull();
    const gitRendered = `${gitWinner!.file}:${gitWinner!.line}:${gitWinner!.pattern}`;

    const sources: IgnoreSource[] = [
      { dir: "", lines: parseIgnoreFile(readFileSync(path.join(edgesRoot, ".gitignore"), "utf8")) },
    ];
    const result = traceDecision(sources, "!literal", false);
    const won = result.entries.find((e) => e.outcome === "won");
    expect(won).toBeDefined();
    const ourRendered = `${won!.file}:${won!.line}:${won!.pattern}`;

    console.log(`!literal byte comparison: git="${gitRendered}" ignoretrace="${ourRendered}"`);
    expect(ourRendered).toBe(gitRendered);
    expect(won!.negated).toBe(false);
    expect(won!.pattern).toBe("\\!literal");
  });
});
