# Rich expressions

ProtoFlow evaluates expressions inside `[[ ... ]]` at preview and export runtime. The evaluator uses a bounded parser and an allowlist; expressions cannot access JavaScript globals, the DOM, the network, or arbitrary object properties.

```text
Subtotal: [[ unitPrice * quantity ]]
Visible: [[ isReady && attempts >= 2 ]]
Greeting: [[ toUpperCase(concat("hello ", item.name)) ]]
```

Expressions can appear within text, image URLs, interaction action values, and repeater item content. A field containing only an expression returns its result type, so `[[ 2 + 3 ]]` can set a number variable. Embedded expressions are converted to text. Existing `{{variable}}` and `{{item.field}}` bindings continue to work.

## Operators

| Category | Operators |
| --- | --- |
| Arithmetic | `+`, `-`, `*`, `/`, `%`, `**` |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Logical | `&&`, `||`, `!` |
| Grouping | `(...)` |

Arithmetic requires finite numeric values. `+` concatenates if either operand is a string. Logical operators short-circuit. Equality uses strict type equality.

## Functions

| Category | Functions |
| --- | --- |
| Math | `abs`, `ceil`, `floor`, `round`, `min`, `max`, `random` |
| String | `concat`, `substring`, `replace`, `toUpperCase`, `toLowerCase`, `trim`, `length` |
| Type | `toString`, `toNumber`, `toBoolean` |
| Date | `now`, `formatDate` |
| Formatting | `padStart`, `padEnd` |

`substring(text, start, end)` uses JavaScript-style substring indexes. `replace(text, search, replacement)` replaces the first match. `now()` returns Unix milliseconds. `formatDate(value, pattern)` supports `yyyy`, `MM`, `dd`, `HH`, `mm`, and `ss`; for example, `formatDate(now(), "yyyy-MM-dd")`. `random()` returns a value in `[0, 1)`.

## References

- Project and screen variables: `[[ cartTotal ]]`
- Widget properties: `[[ Card.width ]]` (the widget's name is used)
- Current repeater record: `[[ item.name ]]`
- Current interaction widget: `[[ this.x ]]`

Project/screen variable names take precedence over widget names. Available fields depend on the current runtime context. Missing references evaluate to an empty value in text and cause a type error when numeric arithmetic requires a number.

## Editor and errors

Double-click editable text and choose **Insert [[ ]]** to add an expression. The editor offers expression-name/function suggestions and a live result preview. Interaction condition and action fields provide the same insertion, autocomplete, and preview controls. Invalid expressions remain visible as written and show an error in the editor; runtime preview does not crash if an expression is invalid.

Expressions are limited to 2,000 characters, 500 tokens, and 64 levels of parser nesting. Only the functions in the table above are callable. Property access to `constructor`, `prototype`, and `__proto__` is rejected. Do not put secrets in expressions; they are part of the project document and exports.
