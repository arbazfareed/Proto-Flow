# Choosing between responsive and per-device export

Choose the export that matches how the prototype will be reviewed:

| Export | Best for | Output | Credits |
|---|---|---|---:|
| Responsive HTML | One link or file that adapts to viewport breakpoints | Offline HTML ZIP | 0 |
| Per-device HTML variants | Deliberately different desktop, tablet, and mobile compositions | ZIP with separate HTML pages | 0 |
| Per-device images | Static review or sharing at multiple pixel densities | PNGs at 1×, 2×, and 3× | 0 |
| Responsive React project | A runnable, editable React prototype | React, TypeScript, Vite, and Tailwind project ZIP | 3 |
| Single-file JSX | A quick code handoff for one screen or the current project | TSX file | 0 |

## Responsive HTML

Use one responsive bundle when the same screen should adapt to its configured breakpoints. The export includes the shared runtime, styles, and local font. Open the HTML at representative widths such as 320, 768, 1024, 1440, and 3840 pixels; check navigation, interactions, and any horizontal scrolling at narrow widths.

See [responsive HTML export](help:responsive-html-export) for the export controls.

## Per-device HTML variants

Choose variants when device-specific screens or layouts should stay separate. The ZIP includes a launcher plus desktop, tablet, and mobile pages. Open each page at its intended breakpoint and test its interactions independently.

See [per-device variants](help:per-device-variants) for the generated file list.

## Images and React

Per-device image exports contain desktop, tablet, and mobile PNGs at 1×, 2×, and 3× pixel ratios. They are generated locally and do not use credits.

The responsive React ZIP includes a runnable app; extract it, run `npm install`, then `npm run dev`. The ZIP export costs 3 credits. The separate single-file JSX download is free but is not a complete runnable project.

See [React and Tailwind export](help:react-tailwind-export) for its options and limitations.
