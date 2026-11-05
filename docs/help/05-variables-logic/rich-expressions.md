# Rich expressions with double brackets

Use `[[ expression ]]` in supported fields and interaction values to calculate a value at runtime. Expressions can use literals, operators, variables, widget properties, the current widget (`this`), and the current repeater item (`item`) where the context supports them.

For example, `[[count + 1]]` can increment a numeric value. The expression editor offers context-aware suggestions and reports invalid expressions. Only the application's supported expression grammar is evaluated; this is not JavaScript execution.

See **Expression function reference** for supported helpers and **Local variables** for rule-scoped state.
