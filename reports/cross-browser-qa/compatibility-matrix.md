# Cross-browser export QA compatibility matrix

Generated 2026-11-06T12:52:56.371Z by `npm run qa:exports:full`.

Playwright runs browser engines on the local Windows/CI runner. Mobile Safari and Chrome Android use WebKit/Chromium device emulation; they are not physical-device certification. Chrome and Edge rows use their branded Playwright channels in the full matrix.

| Browser target | Surface | Result | Load (ms) |
|---|---|---:|---:|
| chromium | responsive-html | passed | 107 |
| chromium | device-desktop-html | passed | 52 |
| chromium | device-tablet-html | passed | 23 |
| chromium | device-mobile-html | passed | 37 |
| chromium | published-preview | passed | 44 |
| chromium | react-export | passed | 177 |
| firefox | responsive-html | passed | 553 |
| firefox | device-desktop-html | passed | 173 |
| firefox | device-tablet-html | passed | 73 |
| firefox | device-mobile-html | passed | 95 |
| firefox | published-preview | passed | 44 |
| firefox | react-export | passed | 139 |
| webkit | responsive-html | passed | 99 |
| webkit | device-desktop-html | passed | 71 |
| webkit | device-tablet-html | passed | 58 |
| webkit | device-mobile-html | passed | 39 |
| webkit | published-preview | passed | 74 |
| webkit | react-export | passed | 107 |
| chrome | responsive-html | passed | 220 |
| chrome | device-desktop-html | passed | 78 |
| chrome | device-tablet-html | passed | 53 |
| chrome | device-mobile-html | passed | 68 |
| chrome | published-preview | passed | 65 |
| chrome | react-export | passed | 277 |
| edge | responsive-html | passed | 277 |
| edge | device-desktop-html | passed | 96 |
| edge | device-tablet-html | passed | 109 |
| edge | device-mobile-html | passed | 185 |
| edge | published-preview | passed | 57 |
| edge | react-export | passed | 262 |
| chromium-mobile | responsive-html | passed | 126 |
| chromium-mobile | device-desktop-html | passed | 37 |
| chromium-mobile | device-tablet-html | passed | 61 |
| chromium-mobile | device-mobile-html | passed | 44 |
| chromium-mobile | published-preview | passed | 57 |
| chromium-mobile | react-export | passed | 231 |
| webkit-mobile | responsive-html | passed | 67 |
| webkit-mobile | device-desktop-html | passed | 52 |
| webkit-mobile | device-tablet-html | passed | 52 |
| webkit-mobile | device-mobile-html | passed | 50 |
| webkit-mobile | published-preview | passed | 52 |
| webkit-mobile | react-export | passed | 121 |

Screenshots are compared with the checked-in per-browser baselines in `reports/cross-browser-qa/baselines/`; updated screenshots and the compatibility matrix are uploaded as CI artifacts. Performance gate: each measured HTML/React export page must load in under 2,000 ms.
