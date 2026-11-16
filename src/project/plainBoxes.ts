/**
 * Structural layout boxes. They are drawn as a plain box (fill and border only) on the
 * canvas, in Preview and in every export: no placeholder title or fake text lines.
 */
export const PLAIN_BOX_TYPES: ReadonlySet<string> = new Set(["container", "frame", "group", "section"]);
