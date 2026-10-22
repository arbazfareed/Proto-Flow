# Interaction-local variables

Every interaction rule can declare text, number, and boolean local variables. They are stored with the rule as `localVariables` entries containing `name`, `type`, and `initial`.

```json
{
  "localVariables": [
    { "name": "nextTotal", "type": "number", "initial": 0 }
  ]
}
```

When a rule fires, its locals are initialized before its conditions are evaluated. Conditions and actions can read them by name or use `[[ expression ]]`. A **Set variable** action targeting a local updates that rule's local value; later actions in the same rule see the update. The value is discarded when the rule invocation completes, including when the same widget is clicked again.

For the same name, lookup precedence is:

1. Local variable declared by the current rule.
2. Variable scoped to the current screen.
3. Project variable.

Local shadowing does not mutate the screen or project variable. The editor warns when the shadowed variable has a different type, and when a local is never read. Names must be valid, non-reserved identifiers, and each rule may declare a name only once.

Repeater row events additionally expose the current record through `item.field` expressions and `{{item.field}}` interpolation. Item data is invocation context; it does not persist after the row event.

Interaction locals are evaluated in the in-app preview, standalone HTML preview, and generated React export. They are project data, not secrets. Local preview and editing work offline; network-dependent AI, collaboration, and cloud publishing features remain unavailable until the app reconnects.
