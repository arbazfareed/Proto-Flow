# Axure-parity performance verification

Generated: 2026-10-25T08:30:19.652Z
Browser: Chromium 156.0.8078.4
Scene interaction duration: 1000 ms per mode
Memory soak duration: 300000 ms
FPS regression floor: 54.0 FPS (10% below the 60 FPS baseline)

Results are measurements from this run, not guarantees for other hardware. Each scene is exercised in idle, pan, zoom, and drag modes. Feature timings use the application’s existing panel, repeater, expression, and flow-layout helpers.

| Scene | Widgets rendered / modeled | Idle FPS | Pan FPS | Zoom FPS | Drag FPS | P95 frame | P99 frame | Feature timing |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| A - Dynamic panels | 220 / 1020 | 59.0 | 61.0 | 61.0 | 60.0 | 16.80 ms | 16.80 ms | panel switch 0.54 ms |
| B - Repeater virtualization | 70 / 2500 | 60.0 | 60.0 | 60.0 | 60.0 | 16.70 ms | 16.80 ms | repeater 0.10 ms |
| C - Nested panels | 310 / 310 | 60.0 | 60.0 | 61.0 | 61.0 | 16.70 ms | 16.80 ms | — |
| D - Expressions | 200 / 200 | 60.0 | 61.0 | 61.0 | 60.0 | 16.80 ms | 16.80 ms | max expression 0.02 ms |
| E - Full Axure-parity mix | 510 / 12710 | 61.0 | 61.0 | 61.0 | 60.0 | 16.70 ms | 16.80 ms | repeater 0.10 ms; max expression 0.02 ms |
| F - Flow diagram | 100 / 100 | 58.0 | 60.0 | 61.0 | 60.0 | 16.80 ms | 16.80 ms | flow layout 148.00 ms |

## Memory soak

- Start: 7.61 MiB
- Midpoint: 7.67 MiB
- End: 7.64 MiB
- Growth: 0.03 MiB

## Targets and implementation notes

- Stress-scene FPS: at least 55 FPS in each interaction mode.
- Dynamic-panel state switch: under 50 ms.
- Virtualized repeater: under 200 ms to prepare visible rows from a 500-row dataset.
- Expression evaluation: under 1 ms per expression.
- Flow layout: under 500 ms for 100 screens and 300 transitions.
- Five-minute heap growth: less than 30 MiB.
- Repeater virtualization and compiled-expression/dependency caching already exist in the application; panel rendering selects active states only. Flow diagram nodes and edges are culled to the visible viewport.
- CI retains this report as a run artifact; update the checked-in baseline file when deliberately changing the performance budget.

## Scene definitions

- A: 20 panels × 5 states × 10 widgets (1,020 total including panel containers).
- B: one 500-row repeater × 5 widgets (2,500 modeled; viewport and overscan rows rendered).
- C: 10 panel trees nested 3 levels deep with content.
- D: 200 expression widgets using 20 variables.
- E: 10 panels, five 500-row repeaters, 100 expression widgets, and 100 annotations.
- F: 100 screens and 300 transitions.

