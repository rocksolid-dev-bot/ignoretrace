# ignoretrace

Paste a `.gitignore` — or a whole nested set — plus the paths you care about, and see every rule
that matched each path, which one won, and why your negation did nothing.

## Status

Day 1. Scaffold and the matcher's spine (`parseIgnoreFile`) only — no UI, no full pattern
grammar, no precedence trace yet.
