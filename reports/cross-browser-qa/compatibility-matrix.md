# Cross-browser export QA compatibility matrix

Generated 2026-11-06T05:09:51.769Z by `npm run qa:exports:full`.

Playwright runs browser engines on the local Windows/CI runner. Mobile Safari and Chrome Android use WebKit/Chromium device emulation; they are not physical-device certification. Chrome and Edge rows use their branded Playwright channels in the full matrix.

| Browser target | Surface | Result | Load (ms) |
|---|---|---:|---:|
| chromium | responsive-html | passed | 92 |
| chromium | device-desktop-html | passed | 41 |
| chromium | device-tablet-html | passed | 59 |
| chromium | device-mobile-html | passed | 57 |
| chromium | published-preview | passed | 89 |
| chromium | react-export | passed | 425 |
| firefox | responsive-html | passed | 837 |
| firefox | device-desktop-html | passed | 967 |
| firefox | device-tablet-html | passed | 169 |
| firefox | device-mobile-html | passed | 158 |
| firefox | published-preview | passed | 137 |
| firefox | react-export | passed | 333 |
| webkit | responsive-html | passed | 116 |
| webkit | device-desktop-html | passed | 38 |
| webkit | device-tablet-html | passed | 81 |
| webkit | device-mobile-html | passed | 74 |
| webkit | published-preview | passed | 140 |
| webkit | react-export | passed | 207 |
| chrome | responsive-html | passed | 320 |
| chrome | device-desktop-html | passed | 68 |
| chrome | device-tablet-html | passed | 100 |
| chrome | device-mobile-html | passed | 99 |
| chrome | published-preview | passed | 96 |
| chrome | react-export | passed | 449 |
| edge | responsive-html | passed | 181 |
| edge | device-desktop-html | passed | 81 |
| edge | device-tablet-html | passed | 102 |
| edge | device-mobile-html | passed | 146 |
| edge | published-preview | passed | 107 |
| edge | react-export | passed | 1117 |
| chromium-mobile | responsive-html | passed | 305 |
| chromium-mobile | device-desktop-html | passed | 62 |
| chromium-mobile | device-tablet-html | passed | 73 |
| chromium-mobile | device-mobile-html | passed | 119 |
| chromium-mobile | published-preview | passed | 83 |
| chromium-mobile | react-export | passed | 520 |
| webkit-mobile | responsive-html | passed | 94 |
| webkit-mobile | device-desktop-html | passed | 32 |
| webkit-mobile | device-tablet-html | passed | 47 |
| webkit-mobile | device-mobile-html | passed | 90 |
| webkit-mobile | published-preview | passed | 81 |
| webkit-mobile | react-export | passed | 191 |

Screenshots are compared with the checked-in per-browser baselines in `reports/cross-browser-qa/baselines/`; updated screenshots and the compatibility matrix are uploaded as CI artifacts. Performance gate: each measured HTML/React export page must load in under 2,000 ms.
