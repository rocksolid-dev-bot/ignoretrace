# ignoretrace

Paste a `.gitignore` — or a whole nested set — plus the paths you care about, and see every rule
that matched each path, which one won, and why your negation did nothing.

## Status

Day 4. The matcher's spine (`parseIgnoreFile`, full single-file grammar, `matchPath`), cross-file
precedence (nearest-`.gitignore`-wins) and leading-slash anchoring, plus `traceDecision`'s
precedence trace: every matched rule across every applicable `.gitignore` gets one of three
outcomes — `won` (the rule that decided the path), `lost-outranked` (a rule that matched but a
later rule in the same unexcluded chain overrode it), or `lost-parent-excluded` (the rule was
powerless because an ancestor directory was itself excluded — git never read the file it came
from, or, if it came from the same file as the excluding rule, it never got to compete because the
ancestor's own rule already decided the path). No UI yet.

## Limitations

ignoretrace reads only the `.gitignore` files given to it as input. It does not read
`.git/info/exclude` or a user's `core.excludesFile`, both of which git itself consults — those are
out of scope.
