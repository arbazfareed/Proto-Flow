# Cross-browser export QA compatibility matrix

Generated 2026-11-07T06:16:17.971Z by `npm run qa:exports:full`.

Playwright runs browser engines on the local Windows/CI runner. Mobile Safari and Chrome Android use WebKit/Chromium device emulation; they are not physical-device certification. Chrome and Edge rows use their branded Playwright channels in the full matrix.

| Browser target | Surface | Result | Load (ms) |
|---|---|---:|---:|
| chromium | responsive-html | passed | 82 |
| chromium | device-desktop-html | passed | 40 |
| chromium | device-tablet-html | passed | 30 |
| chromium | device-mobile-html | passed | 46 |
| chromium | published-preview | passed | 71 |
| chromium | react-export | passed | 333 |
| firefox | responsive-html | passed | 507 |
| firefox | device-desktop-html | passed | 100 |
| firefox | device-tablet-html | passed | 86 |
| firefox | device-mobile-html | passed | 109 |
| firefox | published-preview | passed | 90 |
| firefox | react-export | passed | 333 |
| webkit | responsive-html | passed | 179 |
| webkit | device-desktop-html | passed | 66 |
| webkit | device-tablet-html | passed | 49 |
| webkit | device-mobile-html | passed | 47 |
| webkit | published-preview | passed | 52 |
| webkit | react-export | passed | 169 |
| chrome | responsive-html | passed | 396 |
| chrome | device-desktop-html | passed | 67 |
| chrome | device-tablet-html | passed | 59 |
| chrome | device-mobile-html | passed | 51 |
| chrome | published-preview | passed | 51 |
| chrome | react-export | passed | 311 |
| edge | responsive-html | passed | 420 |
| edge | device-desktop-html | passed | 106 |
| edge | device-tablet-html | passed | 81 |
| edge | device-mobile-html | passed | 66 |
| edge | published-preview | passed | 58 |
| edge | react-export | passed | 288 |
| chromium-mobile | responsive-html | passed | 129 |
| chromium-mobile | device-desktop-html | passed | 58 |
| chromium-mobile | device-tablet-html | passed | 64 |
| chromium-mobile | device-mobile-html | passed | 37 |
| chromium-mobile | published-preview | passed | 53 |
| chromium-mobile | react-export | passed | 231 |
| webkit-mobile | responsive-html | passed | 135 |
| webkit-mobile | device-desktop-html | passed | 71 |
| webkit-mobile | device-tablet-html | passed | 70 |
| webkit-mobile | device-mobile-html | passed | 57 |
| webkit-mobile | published-preview | passed | 103 |
| webkit-mobile | react-export | passed | 107 |

Screenshots are compared with the checked-in per-browser baselines in `reports/cross-browser-qa/baselines/`; updated screenshots and the compatibility matrix are uploaded as CI artifacts. Performance gate: each measured HTML/React export page must load in under 2,000 ms.
