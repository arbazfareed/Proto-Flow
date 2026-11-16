// Generates src/theme-light.css: a light-theme counterpart for every hard-coded dark colour
// in the editor stylesheets, mapped by role (surface, border, shadow, text).
// Run after changing colours in those stylesheets:
//   node scripts/generate-light-theme.mjs
// Hand-tuned light-theme refinements belong in src/styles.css, which loads afterwards.
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const DEFAULT_OUTPUT = "src/theme-light.css";
const DEFAULT_INPUTS = [
  "src/App.css",
  "src/styles.css",
  "src/onboarding/OnboardingWizard.css",
  "src/tutorial/TutorialGuide.css",
  "src/help/HelpPanel.css",
];
const [out = DEFAULT_OUTPUT, ...givenInputs] = process.argv.slice(2);
const inputs = givenInputs.length ? givenInputs : DEFAULT_INPUTS;
const COLOUR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^)]*\)/g;
// User designs render inside these; their colours must not follow the editor theme.
const SKIP_SELECTOR = /preview-(screen|widget|control|layout|chart|repeater|table|rich|frame-stage|tabs-|carousel|accordion)|konva|thumbnail-canvas/;

function parse(text) {
  if (text.startsWith("#")) {
    let hex = text.slice(1);
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    const n = hex.match(/.{2}/g).map((p) => parseInt(p, 16));
    return { r: n[0], g: n[1], b: n[2], a: n.length === 4 ? n[3] / 255 : 1 };
  }
  const nums = text.match(/[\d.]+%?/g)?.map((v) => (v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v)));
  if (!nums || nums.length < 3) return null;
  return { r: nums[0], g: nums[1], b: nums[2], a: nums[3] ?? 1 };
}
const lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const chroma = ({ r, g, b }) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
function hue({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
}
const alpha = (hex, a) => (a >= 1 ? hex : `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${+a.toFixed(3)})`);

function mapBackground(c) {
  const L = lum(c), C = chroma(c);
  if (L >= 0.1) return null; // already light or a strong accent: keep
  if (c.a >= 0.45 && L < 0.006 && C < 0.08) return `rgba(26, 22, 44, ${Math.min(0.38, +(c.a * 0.5).toFixed(2))})`; // modal backdrop
  if (C < 0.1) {
    const hex = L < 0.0095 ? "#ffffff" : L < 0.0175 ? "#f8f8fb" : L < 0.028 ? "#f1f1f6" : L < 0.045 ? "#e9e9f0" : "#dfdfe7";
    return alpha(hex, c.a);
  }
  const h = Math.round(hue(c));
  return c.a < 1 ? `hsla(${h}, 70%, 94%, ${c.a})` : `hsl(${h}, ${L < 0.02 ? 60 : 55}%, ${L < 0.02 ? 96 : 92}%)`;
}
function mapBorder(c) {
  const L = lum(c), C = chroma(c);
  if (L >= 0.12) return null;
  if (C < 0.1) return alpha(L < 0.02 ? "#ececf2" : L < 0.035 ? "#e2e2ea" : "#d6d6e0", c.a);
  return c.a < 1 ? `hsla(${Math.round(hue(c))}, 45%, 80%, ${c.a})` : `hsl(${Math.round(hue(c))}, 45%, 85%)`;
}
function mapShadow(c) {
  if (lum(c) >= 0.05 || chroma(c) > 0.15) return null;
  return `rgba(28, 24, 48, ${+(Math.min(1, c.a) * 0.3).toFixed(3)})`;
}
function mapText(c, keepWhite) {
  const L = lum(c), C = chroma(c);
  if (L < 0.2) return null; // already dark enough on light surfaces
  if (C < 0.15) {
    if (L > 0.85 && keepWhite) return null;
    const hex = L > 0.7 ? "#1f1e27" : L > 0.45 ? "#34333d" : L > 0.25 ? "#585764" : "#666572";
    return alpha(hex, Math.max(c.a, 0.85));
  }
  const h = Math.round(hue(c));
  if (C < 0.3) return L > 0.45 ? "#34333d" : "#585764"; // tinted greys read as neutral text
  if (h >= 240 && h <= 290) return "#5f41c0"; // accent purple, readable on white
  return `hsl(${h}, ${Math.min(80, Math.round(C * 100) + 20)}%, 26%)`; // ≥ 4.5:1 on tinted badges
}

const BG = /^(background|background-color|background-image)$/;
const BORDER = /^(border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|column-rule|border-block.*|border-inline.*)$/;
const SHADOW = /^(box-shadow|text-shadow|filter)$/;
const TEXT = /^(color|fill|stroke|caret-color|text-decoration-color|-webkit-text-fill-color|accent-color)$/;
const KEEP_WHITE = /primary|accent|danger|success|warning|badge|avatar|toast|brand|logo|count|is-selected|is-active|selected|checked|tooltip|kbd-dark/;

const outRoot = postcss.root();
let rules = 0;
for (const file of inputs) {
  const root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
  outRoot.append(postcss.comment({ text: ` ${path.basename(file)} ` }));
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    if (rule.selector.includes('data-theme="light"')) return;
    const selectors = rule.selectors.filter((s) => !SKIP_SELECTOR.test(s) && !/^(html|:root|body|\*)/.test(s.trim()));
    if (!selectors.length) return;
    const ruleBgDark = rule.nodes.some((d) => d.type === "decl" && BG.test(d.prop) && (d.value.match(COLOUR_RE) || []).some((t) => { const c = parse(t); return c && lum(c) < 0.1 && c.a > 0.5; }));
    const ruleHasBg = rule.nodes.some((d) => d.type === "decl" && BG.test(d.prop));
    const keepWhite = !ruleBgDark && (ruleHasBg || KEEP_WHITE.test(rule.selector));
    const decls = [];
    for (const decl of rule.nodes) {
      if (decl.type !== "decl") continue;
      const prop = decl.prop.toLowerCase();
      const role = BG.test(prop) ? mapBackground : BORDER.test(prop) ? mapBorder : SHADOW.test(prop) ? mapShadow : TEXT.test(prop) ? (c) => mapText(c, keepWhite) : null;
      if (!role) continue;
      let changed = false;
      const value = decl.value.replace(COLOUR_RE, (token) => {
        const c = parse(token);
        if (!c) return token;
        const mapped = role(c);
        if (!mapped) return token;
        changed = true;
        return mapped;
      });
      if (changed) decls.push(postcss.decl({ prop: decl.prop, value, important: decl.important }));
    }
    if (!decls.length) return;
    const lightRule = postcss.rule({ selectors: selectors.map((s) => `html[data-theme="light"] ${s.trim()}`) });
    decls.forEach((d) => lightRule.append(d));
    let target = outRoot;
    if (rule.parent?.type === "atrule") {
      const at = postcss.atRule({ name: rule.parent.name, params: rule.parent.params });
      outRoot.append(at); target = at;
    }
    target.append(lightRule);
    rules++;
  });
}
const header = `/*
 * Light theme for the editor UI.
 * App.css and the panel stylesheets are written dark-first with fixed colours; every rule
 * below gives one of those colours a light counterpart by its role (surface, border, shadow,
 * text). It applies only when <html data-theme="light"> is set, so the dark theme is untouched.
 * Hand-tuned rules for the premium look live in styles.css, which loads after this file.
 * Generated by scripts/generate-light-theme.mjs; do not edit by hand, re-run the script.
 */
`;
fs.writeFileSync(out, header + outRoot.toString().replace(/\n{3,}/g, "\n\n") + "\n");
console.log(`wrote ${rules} rules to ${out}`);
