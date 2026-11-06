# Cross-browser export QA compatibility matrix

Generated 2026-11-06T07:58:57.242Z by `npm run qa:exports:full`.

Playwright runs browser engines on the local Windows/CI runner. Mobile Safari and Chrome Android use WebKit/Chromium device emulation; they are not physical-device certification. Chrome and Edge rows use their branded Playwright channels in the full matrix.

| Browser target | Surface | Result | Load (ms) |
|---|---|---:|---:|
| chromium | responsive-html | passed | 119 |
| chromium | device-desktop-html | passed | 33 |
| chromium | device-tablet-html | passed | 29 |
| chromium | device-mobile-html | passed | 23 |
| chromium | published-preview | passed | 45 |
| chromium | react-export | passed | 253 |
| firefox | responsive-html | passed | 1178 |
| firefox | device-desktop-html | passed | 663 |
| firefox | device-tablet-html | passed | 216 |
| firefox | device-mobile-html | passed | 112 |
| firefox | published-preview | passed | 91 |
| firefox | react-export | passed | 608 |
| webkit | responsive-html | passed | 124 |
| webkit | device-desktop-html | passed | 59 |
| webkit | device-tablet-html | passed | 51 |
| webkit | device-mobile-html | passed | 41 |
| webkit | published-preview | passed | 38 |
| webkit | react-export | passed | 121 |
| chrome | responsive-html | passed | 270 |
| chrome | device-desktop-html | passed | 157 |
| chrome | device-tablet-html | passed | 69 |
| chrome | device-mobile-html | passed | 64 |
| chrome | published-preview | passed | 56 |
| chrome | react-export | passed | 334 |
| edge | responsive-html | passed | 550 |
| edge | device-desktop-html | passed | 102 |
| edge | device-tablet-html | passed | 90 |
| edge | device-mobile-html | passed | 84 |
| edge | published-preview | passed | 73 |
| edge | react-export | passed | 543 |
| chromium-mobile | responsive-html | passed | 122 |
| chromium-mobile | device-desktop-html | passed | 47 |
| chromium-mobile | device-tablet-html | passed | 49 |
| chromium-mobile | device-mobile-html | passed | 94 |
| chromium-mobile | published-preview | passed | 72 |
| chromium-mobile | react-export | passed | 369 |
| webkit-mobile | responsive-html | passed | 63 |
| webkit-mobile | device-desktop-html | passed | 36 |
| webkit-mobile | device-tablet-html | passed | 35 |
| webkit-mobile | device-mobile-html | passed | 163 |
| webkit-mobile | published-preview | passed | 42 |
| webkit-mobile | react-export | passed | 172 |

Screenshots are compared with the checked-in per-browser baselines in `reports/cross-browser-qa/baselines/`; updated screenshots and the compatibility matrix are uploaded as CI artifacts. Performance gate: each measured HTML/React export page must load in under 2,000 ms.
