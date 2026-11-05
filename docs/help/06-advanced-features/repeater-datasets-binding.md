# Repeater datasets and binding

Select the repeater and open its dataset in the inspector to add, edit, or remove rows and fields. CSV import/export is available for tabular data. Check that the first row and subsequent records use the same field names and compatible values.

Select a widget inside the repeater template and bind its text or other supported property to a dataset field. During Preview, the binding resolves against the current row. The expression context can also read the current record through `item`.

Use concise field names and test more than one row. A template that only looks correct with the first record may not accommodate longer values or missing optional data.
