# Runtime variables and reset

When Preview runs, project and screen variables hold runtime values used by rules, interpolated text, and expressions. Actions can change those values as the prototype is used. Runtime values are separate from the initial values saved in the project.

Reset Preview to start again from the project's configured initial state. This is especially useful when testing a sequence that increments a counter, changes a panel state, or adds repeater rows.

If a displayed value does not update, check the variable's scope and type, the action's target, and whether the expression is valid.
