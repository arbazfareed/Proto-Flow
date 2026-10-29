# PF-T513 Axure-style workflow protocols

These are reproducible test protocols for the current ProtoFlow UI. They are not claims that a session has already been completed. Run each workflow in the browser and in a native desktop build where available; record the exact build, OS, browser/display context, result, and evidence. To claim Axure RP parity, have an Axure RP user independently confirm the named workflow and record their consent.

## Test 1 — Three-screen dashboard

1. Create a project with `Overview`, `Activity`, and `Settings` screens. Save it as a new `.pflow` file.
2. On `Overview`, create a dynamic panel with `Summary` and `Details` states. Put different widgets in each state and set a visible transition. Switch states in the editor, then trigger a state change in Preview.
3. Add a repeater with a name/amount row template and a small dataset. Bind row text to `{{item.name}}`; add a numeric total using a supported expression such as `[[ item.amount * item.quantity ]]`.
4. Exercise repeater data editing and the supported set/add/remove/sort/filter actions. Confirm row interactions see their own `item` record and do not leak values between rows.
5. Add a note to the total widget with a requirement ID, priority, status, and tag. Check the note marker/priority treatment, then export notes to CSV and Markdown.
6. Navigate between all three screens in Preview, save, reopen the project, and confirm the screen data, panel states, repeater records, expression text, and note remain.

**Expected evidence:** `.pflow` fixture (sanitized), screenshots/video of the editor and Preview, exported note files, and a completed result record. Automated model/runtime coverage is not a substitute for the editor and reopen steps.

## Test 2 — Five-step onboarding

1. Create five onboarding screens or a five-state onboarding panel. Give each step a distinct title and description.
2. Use a project/screen variable for progress and an interaction-local variable for a per-invocation calculation. Add step transitions and advance/back actions.
3. Use rich text for descriptions: bold, italic, underline, strike, code, highlight, safe link, and list formatting. Confirm the editor toolbar and supported Markdown shortcuts, then inspect Preview and semantic export.
4. Trigger the same rule more than once. Confirm locals reset on every invocation, local values shadow screen/project variables only inside the rule, and the intended outer variables retain their values.
5. Create navigation between the steps, switch to Flow, run auto-layout, move a node, create/delete an edge, return to Design, and check that screen navigation actions and saved node positions agree.
6. Export Flow as SVG and PNG, reopen the project, and verify the onboarding flow and rich text are preserved.

**Expected evidence:** `.pflow` fixture, screenshots/video of the five steps, rich-text toolbar/shortcuts, Flow editing, both diagram exports, and a completed result record.

## Test 3 — Settings page and three revisions

1. Create a settings screen with a repeater of toggle rows and fields for setting name, enabled state, and description. Bind each row to its own record.
2. Use an expression/condition for a visible status or conditional style. Toggle and edit more than one row; verify changes remain associated with the right record.
3. Create a named manual version-history checkpoint `Settings v1`.
4. Change labels, toggle defaults, and conditional behavior; create `Settings v2`. Make another distinct change and create `Settings v3`.
5. Compare v1/v2 and v2/v3. Inspect changes to widget content, geometry/style, and interaction logic. Restore v2, confirm the editor shows the expected version, then undo the restore.
6. Close and reopen the project and confirm checkpoints persist. The app's current version-history cloud sync is not implemented, so this test does not claim cloud-history behavior.

**Expected evidence:** `.pflow` fixture, checkpoint timeline/diff/restore/undo screenshots or video, and a completed result record.

## Result record template

Copy one record per run; avoid private tester information and customer/project data.

| Field | Value |
|---|---|
| Workflow / run date | |
| ProtoFlow commit or version | |
| OS version/build | |
| Browser + version / native desktop build | |
| Display server and actual OS scaling (if applicable) | |
| Test steps completed / skipped | |
| Result and reproducible issue links | |
| Evidence artifact path (sanitized) | |
| Axure RP user confirmed? (yes/no; consent recorded separately) | |
| Tester quote (only with explicit permission) | |

Do not infer Axure RP experience or user satisfaction from analytics or repository tests. Keep tester identity and consent records in an approved private location, not in this repository.
