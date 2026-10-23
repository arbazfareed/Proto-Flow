# Widget notes and annotations

Widget notes are project metadata stored under each widget's optional `notes` property. Schema version 1.8.0 accepts older projects and migrates them automatically.

## Edit notes

Select a widget and open the **Notes** Inspector tab. The description accepts Markdown text; the toolbar inserts bold, italic, and bulleted-list syntax. Requirement ID, priority, status, comma-separated tags, and custom key/value fields are persisted with the widget and participate in undo, redo, autosave, and project export.

Widgets with annotation data show a small priority-colored marker on the Design canvas. Hovering a widget reveals a short description tooltip. Choose **Canvas view options → Notes overlay** to show larger pins for annotated widgets. Clicking a pin selects the widget and opens its Notes tab.

## Search, bulk edit, and export

Open the widget notes manager with the sticky-note button beside the Design/Flow controls. Search checks widget names, descriptions, requirement IDs, tags, and custom field names/values. Status and priority filters can be combined with text search. Select multiple results to add a common tag or set a shared status or priority.

Export the current project annotations as CSV or Markdown. CSV fields are quoted and spreadsheet-formula prefixes are neutralized. Flow SVG/PNG exports show a priority marker on annotated screen thumbnails; SVG markers include a tooltip with the note details.
