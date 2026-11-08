# Importing code

Choose **Import Code** in the top bar to open the local HTML/CSS/JavaScript editor and live preview. The preview refreshes 300 ms after the last edit.

The preview runs in an iframe with `sandbox="allow-scripts"` and no same-origin permission. Its Content Security Policy blocks network connections, external scripts, embedded frames, and form submissions. Inline JavaScript is allowed inside the isolated preview; treat pasted code as untrusted and do not use it to display secrets.

**Render on Canvas** converts supported HTML text and controls into editable ProtoFlow widgets, using a simple vertical layout. The parser also produces a flat element AST with stable-in-result IDs, parent links, text, computed styles, and suggested Lucide icon names. The **Required Icons** row in the preview lists the icons inferred from semantic elements such as video, table, links, and date inputs.

Basic CSS selectors and inline styles can set text color, background color, font family, font size, weight, alignment, border radius, and spacing. A built-in utility dictionary recognizes common Tailwind classes (colors, text sizes/alignment, weights, spacing, and rounded corners) and Bootstrap classes (theme colors, button variants, font sizes/weights, alignment, and rounded corners). Values are normalized with `window.getComputedStyle` when available. This is a deliberately bounded subset, not a full Tailwind or Bootstrap engine. JavaScript runs only in the preview and is not imported as a canvas interaction. Unsupported markup, scripts, external assets, complex CSS layout, and media queries are not converted.

HTML input is limited to 200 KB, CSS to 100 KB, and canvas conversion to 200 widgets. The import action adds widgets to the active screen and selects them for editing.
