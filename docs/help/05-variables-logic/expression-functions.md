# Expression function reference

The evaluator supports these functions inside `[[...]]` expressions:

- **Math:** `abs`, `ceil`, `floor`, `round`, `min`, `max`, `random`
- **Text:** `concat`, `substring`, `replace`, `replaceAll`, `toUpperCase`, `toLowerCase`, `trim`, `length`
- **Types:** `toString`, `toNumber`, `toBoolean`
- **Date and formatting:** `now`, `formatDate`, `padStart`, `padEnd`

`substring(text, start, end)` uses substring indexes, and `replace(text, search, replacement)` replaces the first match, while `replaceAll(text, search, replacement)` replaces every match; the replacement is inserted exactly as written. `length(value)` counts the characters of text, the items of a list, and the characters of a number or true/false, so `length(123)` is 3. `min()` and `max()` need at least one value. `now()` returns Unix milliseconds. `formatDate(value, pattern)` supports `yyyy`, `MM`, `dd`, `HH`, `mm`, and `ss`; for example, `formatDate(now(), "yyyy-MM-dd")`. `random()` returns a number from 0 inclusive to 1 exclusive.

Arithmetic, comparison, and logical operators are also supported. A sign directly before `**` needs brackets: write `(-2) ** 2` (4) or `-(2 ** 2)` (-4), because `-2 ** 2` could mean either. This is a bounded expression language, not JavaScript: arbitrary statements, browser globals, and network access are not available.
