# PF-T705 performance benchmark

Generated: 2026-11-05T15:06:15.626Z
Browser: Chromium 156.0.8078.4
Scene interaction duration: 10000 ms per mode
Memory soak duration: 300000 ms
FPS regression floor: 54.0 FPS (10% below the 60 FPS baseline)

Results are measurements from this run, not guarantees for other hardware. Each scene is exercised in idle, pan, zoom, and drag modes. Feature timings use the application’s existing panel, repeater, expression, and flow-layout helpers.

| Scene | Widgets rendered / modeled | Idle FPS | Pan FPS | Zoom FPS | Drag FPS | P95 frame | P95 pan / zoom operation | Feature timing |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| A - Canvas medium (20 widgets) | 20 / 20 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 0.30 ms / 0.30 ms | — |
| B - Canvas large (500 widgets) | 500 / 500 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 1.90 ms / 1.00 ms | — |
| C - Canvas stress (1000 widgets) | 1000 / 1000 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 1.50 ms / 1.30 ms | — |
| D - Dynamic panels | 220 / 1020 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 0.40 ms / 0.50 ms | panel switch 0.21 ms |
| E - Repeater virtualization | 70 / 2500 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 0.30 ms / 0.20 ms | repeater 0.10 ms |
| F - Nested panels | 310 / 310 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 0.60 ms / 0.90 ms | — |
| G - Expressions | 200 / 200 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 0.40 ms / 0.40 ms | max expression 0.01 ms |
| I - Full Axure-parity mix | 510 / 12710 | 60.1 | 60.1 | 60.1 | 60.1 | 16.70 ms | 0.80 ms / 1.30 ms | repeater 0.10 ms; max expression 0.01 ms |
| H - Flow diagram | 100 / 100 | 60.1 | 60.1 | 60.1 | 60.1 | 16.80 ms | 0.60 ms / 0.50 ms | flow layout 85.00 ms |

## Memory soak

- Start: 18.06 MiB
- Midpoint: 18.10 MiB
- End: 18.10 MiB
- Growth: 0.04 MiB

## Targets and implementation notes

- Medium and large scenes: at least 55 FPS; 1,000-widget stress scenes: at least 45 FPS.
- Panel, repeater, expression, nested-panel, flow, and mixed scenes: at least 50 FPS.
- Pan and zoom operation P95: under 16 ms.
- Dynamic-panel state switch: under 50 ms.
- Virtualized repeater: under 200 ms to prepare visible rows from a 500-row dataset.
- Expression evaluation: under 1 ms per expression.
- Flow layout: under 500 ms for 100 screens and 300 transitions.
- Five-minute heap growth: less than 20 MiB.
- Store timings: add 100 widgets 8.90 ms, undo/redo 50 snapshots 5.40 ms, select 500 IDs 0.40 ms.
- Startup: cold 1801.02 ms, warm median 551.80 ms.
- Production bundle: 3.56 MiB total, 0.94 MiB JavaScript gzip.
- Repeater virtualization and compiled-expression/dependency caching already exist in the application; panel rendering selects active states only. Flow diagram nodes and edges are culled to the visible viewport.
- CI retains this report as a run artifact; update the checked-in baseline file when deliberately changing the performance budget.

## Scene definitions

- A/B/C: 20-widget medium, 500-widget large, and 1,000-widget stress canvas scenes.
- D: 20 panels × 5 states × 10 widgets (1,020 total including panel containers).
- E: one 500-row repeater × 5 widgets (2,500 modeled; viewport and overscan rows rendered).
- F: 10 panel trees nested 3 levels deep with content.
- G: 200 expression widgets using 20 variables.
- H: 100 screens and 300 transitions.
- I: 10 panels, five 500-row repeaters, 100 expression widgets, and 100 annotations.


## CI gate result

All regression gates passed.
