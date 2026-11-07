# PF-T710 Device Frame and Responsive Tests

## Coverage

| Area | Verification |
|---|---|
| Device catalog | Unit tests require 20+ unique presets, all categories, valid viewport/safe-area metadata, and `.pflow` round-tripping. |
| Frame geometry | Unit tests cover bezel bounds, safe-area bounds, out-of-safe-area warnings, rotated widget bounds, overflow, and orientation round-trips. |
| Safe-area snapping | Canvas snap tests verify widget edges align to all safe-area boundaries. |
| Frame chrome | The browser fixture renders every catalog preset at each configured display scale, compares PNGs with checked-in baselines, and tests frame/safe-area toggles and orientation. |
| Device picker | Component tests cover search, category filters, recently used devices, custom dimensions/insets, and changing a screen device. |
| Breakpoints | Model tests cover Desktop/Tablet/Mobile defaults, custom dimensions, project persistence, override resolution, cascade modes, constraints, and overflow/missing-override warnings. Browser tests add, edit, select, and remove a custom breakpoint. |
| Native desktop | Windows WebView2 E2E checks the frame/safe-area toggles and orientation flow in the application. |

## Screenshot and baseline procedure

The full device run renders every preset at 100%, 125%, 150%, and 200% emulated device scale factors. It saves one screenshot per preset and scale, plus an iPhone landscape screenshot, under `reports/device-verification/screenshots/`. Checked-in PNG baselines are compared with a 1% changed-pixel limit (per-channel tolerance 12). The CI device-verification job uploads the generated screenshots.

To intentionally refresh baselines, inspect the generated screenshots and run the device verifier with `PF_DEVICE_FULL=1` and `PF_DEVICE_UPDATE_BASELINES=1`. Do not update baselines merely to silence a failed comparison.

## Tested matrix

| OS / environment | Browser/device | Scale factors | Result |
|---|---|---|---|
| Windows 11 Pro Education 10.0.26300, local | Chromium; native Tauri WebView2 desktop E2E | 100%, 125%, 150%, 200% emulated | Locally exercised; see branch run results below. |
| Ubuntu 24.04, GitHub Actions | Chromium device frames; Chromium, Firefox, and WebKit responsive exports | 100%, 125%, 150%, 200% emulated | CI coverage; headless browser, not native desktop certification. |
| Ubuntu 24.04, X11 and Wayland | Native desktop | — | Not separately exercised. |
| Kali, Debian 12, Fedora 40, Arch | Native desktop and browser | — | Not exercised; no distro-specific runner/VM is configured. |
| Physical displays at 100%, 125%, 150%, and 200% | Any | Physical DPI | Not certified; Playwright uses emulated device scale factors. |

The four emulated scale factors do not substitute for the requested 6-OS × Linux display-server × DPI matrix. Likewise, the CI browser job is not evidence that native desktop packaging works on Linux distributions.

## Branch results

On Windows 11 Pro Education 10.0.26300, the full device verifier rendered all 21 presets at all four emulated scale factors, compared 92 screenshots against the checked-in baselines, and passed responsive export checks in Chromium, Firefox, and WebKit. The full unit suite passed 467/467; the full component suite passed 34/34; the Chromium browser E2E suite passed 12/12; and native WebView2 desktop E2E passed 3/3, including the frame/safe-area controls and orientation flow.

The PF-T710 GitHub Actions run uploads the generated screenshot set. A platform or display combination not run is explicitly left unverified rather than marked as passing.
