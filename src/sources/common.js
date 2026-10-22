// Shared helpers for both sources (Google and local files).

export const TAB_NAMES = ['pages', 'texts', 'media', 'items', 'embeds', 'site', 'styles'];

/** Rows (array of arrays, first row = header) → array of objects with lower-case keys. */
export function rowsToObjects(rows) {
  if (!rows || !rows.length) return [];
  const head = rows[0].map(h => String(h ?? '').trim().toLowerCase());
  return rows.slice(1)
    .filter(r => r && r.some(c => String(c ?? '').trim() !== ''))
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']).filter(([h]) => h)));
}

/** Files → lookup by relative path and by bare file name (both lower case). */
export function indexMedia(files, warn) {
  const byPath = new Map(), byName = new Map(), dupes = new Set();
  for (const f of files) {
    byPath.set(f.path.toLowerCase(), f);
    const n = f.name.toLowerCase();
    if (byName.has(n)) dupes.add(n); else byName.set(n, f);
  }
  return {
    files,
    find(ref) {
      const r = String(ref || '').trim().replace(/^\/+/, '').toLowerCase();
      if (!r) return null;
      if (byPath.has(r)) return byPath.get(r);
      if (!r.includes('/') && byName.has(r)) {
        if (dupes.has(r)) warn(`Soubor „${ref}“ je v médiích víckrát (v různých složkách). Napište celou cestu, např. galerie/${ref}.`);
        return byName.get(r);
      }
      return null;
    },
  };
}
