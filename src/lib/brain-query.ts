/**
 * The Brain routes accept one optional query parameter, `demo=1`, and nothing
 * else. Returns whether demo mode was asked for, or null when the query is not
 * exactly that, so the snapshot and stream routes agree on what they serve.
 */
export function parseDemoQuery(query: URLSearchParams): boolean | null {
  const keys = [...query.keys()];
  if (keys.some((k) => k !== 'demo')) return null;
  const values = query.getAll('demo');
  if (values.length === 0) return false;
  if (values.length > 1 || values[0] !== '1') return null;
  return true;
}
