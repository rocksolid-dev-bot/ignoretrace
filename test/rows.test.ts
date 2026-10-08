import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRows, parseIgnoreFile, type IgnoreSource } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const linesRoot = path.join(__dirname, "fixtures", "lines");

function loadLinesSources(): IgnoreSource[] {
  const text = readFileSync(path.join(linesRoot, ".gitignore"), "utf8");
  return [{ dir: "", lines: parseIgnoreFile(text) }];
}

/**
 * Day 8 item 3: `buildRows` exercised over all six `lines` paths — four
 * ignored, two not, so the assertion is not inert (mistake 64). Verdicts
 * and winners match what items 1 and 2 measured at this WAKE: item 2's
 * fix is what makes `build/sub/deep.tmp` carry a winner at all.
 */
describe("buildRows: pure presentation over traceDecision (day 8 item 3)", () => {
  const sources = loadLinesSources();
  const paths = [
    "build/sub/deep.tmp",
    "build/top.txt",
    "app.log",
    "src/app.log",
    "keep.log",
    "notes.txt",
  ];
  const rows = buildRows(sources, paths);

  it("returns one row per input path, in input order", () => {
    expect(rows.map((r) => r.path)).toEqual(paths);
  });

  it("four ignored, two not — the fixture is not inert", () => {
    const ignoredCount = rows.filter((r) => r.ignored).length;
    const notIgnoredCount = rows.filter((r) => !r.ignored).length;
    expect(ignoredCount).toBe(4);
    expect(notIgnoredCount).toBe(2);
  });

  it("build/sub/deep.tmp: ignored, winner '.gitignore:2:build/*' (day 8 item 2's fix)", () => {
    const row = rows.find((r) => r.path === "build/sub/deep.tmp")!;
    expect(row.ignored).toBe(true);
    expect(row.winner).toBe(".gitignore:2:build/*");
  });

  it("build/top.txt: ignored, winner '.gitignore:2:build/*'", () => {
    const row = rows.find((r) => r.path === "build/top.txt")!;
    expect(row.ignored).toBe(true);
    expect(row.winner).toBe(".gitignore:2:build/*");
  });

  it("app.log: ignored, winner '.gitignore:5:*.log'", () => {
    const row = rows.find((r) => r.path === "app.log")!;
    expect(row.ignored).toBe(true);
    expect(row.winner).toBe(".gitignore:5:*.log");
  });

  it("src/app.log: ignored, winner '.gitignore:5:*.log'", () => {
    const row = rows.find((r) => r.path === "src/app.log")!;
    expect(row.ignored).toBe(true);
    expect(row.winner).toBe(".gitignore:5:*.log");
  });

  it("keep.log: NOT ignored, winner renders its own leading '!' — '.gitignore:8:!keep.log'", () => {
    const row = rows.find((r) => r.path === "keep.log")!;
    expect(row.ignored).toBe(false);
    expect(row.winner).toBe(".gitignore:8:!keep.log");
  });

  it("notes.txt: NOT ignored, no rule matched at all", () => {
    const row = rows.find((r) => r.path === "notes.txt")!;
    expect(row.ignored).toBe(false);
    expect(row.winner).toBe("no rule matched");
  });

  it("losing entries carry their own outcome (not just the winner)", () => {
    const row = rows.find((r) => r.path === "app.log")!;
    expect(row.losers.every((l) => l.outcome !== "won")).toBe(true);
  });
});
