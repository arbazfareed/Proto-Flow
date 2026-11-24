// B49: the "Open link" action. Only web and mail links are allowed, so a rule can never run a
// javascript: or data: address. "www.example.com" is treated as https://www.example.com.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function safeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// The same function as plain JavaScript text for published prototypes. A test checks both agree.
export const LINK_RUNTIME_SOURCE = String.raw`
function safeLinkUrl(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text;
  try {
    const url = new URL(withScheme);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
`;
