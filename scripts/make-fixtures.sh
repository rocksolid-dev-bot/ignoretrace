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
