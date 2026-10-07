# ignoretrace

Paste a `.gitignore` — or a whole nested set — plus the paths you care about, and see every rule
that matched each path, which one won, and why your negation did nothing.

## Status

Day 2. The matcher's spine (`parseIgnoreFile`), the full single-file pattern grammar (`**` in all
three positions, character classes, escapes, trailing-space handling), and `matchPath` returning
every matching rule for a path within one file — no UI yet.

## Limitations

ignoretrace reads only the `.gitignore` files given to it as input. It does not read
`.git/info/exclude` or a user's `core.excludesFile`, both of which git itself consults — those are
out of scope.
