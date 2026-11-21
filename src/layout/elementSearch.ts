// B14: the element search used to filter only the element groups, so searching "text" still listed
// all 5 screen presets, the Image URL import and the status legend. These helpers filter those too.
export function matchesElementQuery(searchable: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || searchable.toLowerCase().includes(needle);
}
