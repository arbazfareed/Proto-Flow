/**
 * The letters an avatar shows: its own "Initials" when set, otherwise the first letters of the
 * person's name (B73: every avatar used to say "AM").
 */
export function avatarInitials(props: { initials?: unknown; label?: unknown }): string {
  const own = typeof props.initials === "string" ? props.initials.trim() : "";
  if (own) return own.slice(0, 3);
  const name = typeof props.label === "string" ? props.label : "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}
