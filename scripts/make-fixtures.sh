#!/usr/bin/env bash
# Builds fixture repos with git itself — never hand-shaped directories.
# Fixture "basic" matches the exact tree measured in BRIEF.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="$ROOT/test/fixtures"

rm -rf "$FIXTURES_DIR/basic"
mkdir -p "$FIXTURES_DIR/basic/build" "$FIXTURES_DIR/basic/sub"

git -C "$FIXTURES_DIR/basic" init -q
git -C "$FIXTURES_DIR/basic" config user.email "fixture@ignoretrace.local"
git -C "$FIXTURES_DIR/basic" config user.name "ignoretrace fixtures"

cat > "$FIXTURES_DIR/basic/.gitignore" <<'EOF'
build/
!build/keep.txt
*.log
!important.log
EOF

cat > "$FIXTURES_DIR/basic/sub/.gitignore" <<'EOF'
!*.log
EOF

echo "kept" > "$FIXTURES_DIR/basic/build/keep.txt"
echo "app log" > "$FIXTURES_DIR/basic/app.log"
echo "important" > "$FIXTURES_DIR/basic/important.log"
echo "debug" > "$FIXTURES_DIR/basic/sub/debug.log"
echo "plain" > "$FIXTURES_DIR/basic/notignored.txt"

git -C "$FIXTURES_DIR/basic" add -A
git -C "$FIXTURES_DIR/basic" commit -q -m "fixture: basic tree" --allow-empty

echo "fixture 'basic' built at $FIXTURES_DIR/basic"

# Fixture "patterns" — root .gitignore only, no nested ignore file (nested
# precedence is day 3 and must not leak in here). Exercises unanchored "**"
# in its three positions, "?", and character classes, including at least
# one unanchored-wildcard-in-root-deciding-a-nested-path case (mistake 63),
# which "basic" never has.
rm -rf "$FIXTURES_DIR/patterns"
mkdir -p "$FIXTURES_DIR/patterns/src" \
         "$FIXTURES_DIR/patterns/a/b/cache" \
         "$FIXTURES_DIR/patterns/logs/2026" \
         "$FIXTURES_DIR/patterns/doc/x/y"

git -C "$FIXTURES_DIR/patterns" init -q
git -C "$FIXTURES_DIR/patterns" config user.email "fixture@ignoretrace.local"
git -C "$FIXTURES_DIR/patterns" config user.name "ignoretrace fixtures"

cat > "$FIXTURES_DIR/patterns/.gitignore" <<'EOF'
*.tmp
**/cache/
logs/**
doc/**/draft.md
file?.txt
report[0-9].txt
EOF

echo "tmp"      > "$FIXTURES_DIR/patterns/src/notes.tmp"
echo "obj"      > "$FIXTURES_DIR/patterns/a/b/cache/x.o"
echo "log"      > "$FIXTURES_DIR/patterns/logs/2026/jan.txt"
echo "draft"    > "$FIXTURES_DIR/patterns/doc/x/y/draft.md"
echo "f1"       > "$FIXTURES_DIR/patterns/file1.txt"
echo "r7"       > "$FIXTURES_DIR/patterns/report7.txt"
echo "final"    > "$FIXTURES_DIR/patterns/doc/x/y/final.md"
echo "fab"      > "$FIXTURES_DIR/patterns/fileAB.txt"
echo "rx"       > "$FIXTURES_DIR/patterns/reportX.txt"
echo "keep"     > "$FIXTURES_DIR/patterns/keep.txt"

git -C "$FIXTURES_DIR/patterns" add -A
git -C "$FIXTURES_DIR/patterns" commit -q -m "fixture: patterns tree" --allow-empty

echo "fixture 'patterns' built at $FIXTURES_DIR/patterns"

# Fixture "nested" — cross-file precedence (day 3's subject). Four
# .gitignore files at different depths so that a single resolved path can
# be decided by root, middle, or deepest file, and one case (vendor/keep.me)
# where a parent directory exclusion makes a deeper negation powerless
# (lost-parent-excluded, not lost-outranked — git never reads vendor/.gitignore
# because it never descends into the excluded vendor/ directory).
rm -rf "$FIXTURES_DIR/nested"
mkdir -p "$FIXTURES_DIR/nested/a/b" "$FIXTURES_DIR/nested/vendor"

git -C "$FIXTURES_DIR/nested" init -q
git -C "$FIXTURES_DIR/nested" config user.email "fixture@ignoretrace.local"
git -C "$FIXTURES_DIR/nested" config user.name "ignoretrace fixtures"

cat > "$FIXTURES_DIR/nested/.gitignore" <<'EOF'
*.log
!important.log
vendor/
EOF

cat > "$FIXTURES_DIR/nested/a/.gitignore" <<'EOF'
important.log
*.txt
EOF

cat > "$FIXTURES_DIR/nested/a/b/.gitignore" <<'EOF'
!notes.txt
EOF

cat > "$FIXTURES_DIR/nested/vendor/.gitignore" <<'EOF'
!keep.me
EOF

echo "top"       > "$FIXTURES_DIR/nested/top.log"
echo "important" > "$FIXTURES_DIR/nested/important.log"
echo "a-important" > "$FIXTURES_DIR/nested/a/important.log"
echo "a-notes"   > "$FIXTURES_DIR/nested/a/notes.txt"
echo "ab-notes"  > "$FIXTURES_DIR/nested/a/b/notes.txt"
echo "ab-other"  > "$FIXTURES_DIR/nested/a/b/other.txt"
echo "keep"      > "$FIXTURES_DIR/nested/vendor/keep.me"
echo "plain"     > "$FIXTURES_DIR/nested/plain.md"

git -C "$FIXTURES_DIR/nested" add -A
git -C "$FIXTURES_DIR/nested" commit -q -m "fixture: nested tree" --allow-empty

echo "fixture 'nested' built at $FIXTURES_DIR/nested"

# Fixture "edges" — day 4 item 1. No prior fixture has ever held a
# leading-slash pattern (grep -rn "^/\|^!/" over all seven prior .gitignore
# files returns rc=1). Root .gitignore only: both of day 4's defects are
# reachable from a single source, which is the surprising part of defect 2
# (parent-exclusion winner, exercised here via build/ + *.tmp and
# vendor/ + !vendor/keep.me).
rm -rf "$FIXTURES_DIR/edges"
mkdir -p "$FIXTURES_DIR/edges/dir" \
         "$FIXTURES_DIR/edges/sub/dir" \
         "$FIXTURES_DIR/edges/build/sub" \
         "$FIXTURES_DIR/edges/vendor"

git -C "$FIXTURES_DIR/edges" init -q
git -C "$FIXTURES_DIR/edges" config user.email "fixture@ignoretrace.local"
git -C "$FIXTURES_DIR/edges" config user.name "ignoretrace fixtures"

cat > "$FIXTURES_DIR/edges/.gitignore" <<'EOF'
/root-only.txt
/dir/
build/
*.tmp
vendor/
!vendor/keep.me
\!literal
/second-root.txt
EOF

echo "root-only"     > "$FIXTURES_DIR/edges/root-only.txt"
echo "sub root-only" > "$FIXTURES_DIR/edges/sub/root-only.txt"
echo "dir x"         > "$FIXTURES_DIR/edges/dir/x.txt"
echo "sub dir y"     > "$FIXTURES_DIR/edges/sub/dir/y.txt"
echo "deep tmp"      > "$FIXTURES_DIR/edges/build/sub/deep.tmp"
echo "keep"          > "$FIXTURES_DIR/edges/vendor/keep.me"
echo "notes tmp"      > "$FIXTURES_DIR/edges/notes.tmp"
echo "plain"         > "$FIXTURES_DIR/edges/plain.md"
echo "literal bang"  > "$FIXTURES_DIR/edges/\!literal"
echo "second root"   > "$FIXTURES_DIR/edges/second-root.txt"

git -C "$FIXTURES_DIR/edges" add -A
git -C "$FIXTURES_DIR/edges" commit -q -m "fixture: edges tree (leading slash, parent exclusion)" --allow-empty

echo "fixture 'edges' built at $FIXTURES_DIR/edges"
