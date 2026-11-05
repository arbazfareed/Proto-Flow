# Expression function reference

The evaluator supports these functions inside `[[...]]` expressions:

- **Math:** `abs`, `ceil`, `floor`, `round`, `min`, `max`, `random`
- **Text:** `concat`, `substring`, `replace`, `toUpperCase`, `toLowerCase`, `trim`, `length`
- **Types:** `toString`, `toNumber`, `toBoolean`
- **Date and formatting:** `now`, `formatDate`, `padStart`, `padEnd`

`substring(text, start, end)` uses substring indexes, and `replace(text, search, replacement)` replaces the first match. `now()` returns Unix milliseconds. `formatDate(value, pattern)` supports `yyyy`, `MM`, `dd`, `HH`, `mm`, and `ss`; for example, `formatDate(now(), "yyyy-MM-dd")`. `random()` returns a number from 0 inclusive to 1 exclusive.

Arithmetic, comparison, and logical operators are also supported. This is a bounded expression language, not JavaScript: arbitrary statements, browser globals, and network access are not available.
