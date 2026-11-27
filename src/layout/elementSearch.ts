// Match every search word so users can combine a widget name, type, and descriptive terms.
export function matchesElementQuery(searchable: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = searchable.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
