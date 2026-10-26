// Turns the raw tabs of a client's spreadsheet into one clean site model.
// Every problem found on the way is collected as a warning in Czech, so the
// client can read it in the "stav" tab of their own sheet.

export const STYLE_DEFAULTS = {
  color_profile: 'manual',
  background: 'drift',
  background_speed: 'slow',
  background_follows_page: 'yes',
  glass_opacity: 0.6,
  page_width: 860,
  page_radius: 22,
  font_display: 'Gloock',
  font_body: 'Figtree',
  font_utility: 'JetBrains Mono',
  text_size: 16,
  text_color: '#ECE9F4',
  muted_color: '#A29FB7',
  hue_saturation: 70,
  turn_speed: 'normal',
  turn_angle: 30,
  stack_depth: 5,
  tabs_desktop: 'right',
};

const str = v => (v === undefined || v === null ? '' : String(v)).trim();
const num = (v, fallback) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && str(v) !== '' ? n : fallback;
};
const isNo = v => ['no', 'ne', 'false', '0', 'n'].includes(str(v).toLowerCase());

// rows: array of objects keyed by (already lower-cased) column names
function keyValue(rows, keyCol = 'setting', valCol = 'value') {
  const out = {};
  for (const r of rows || []) {
    const k = str(r[keyCol]);
    if (k) out[k.toLowerCase()] = r[valCol] ?? '';
  }
  return out;
}

export function buildModel(tabs, warn) {
  const site = keyValue(tabs.site);
  const rawStyles = keyValue(tabs.styles);
  const styles = { ...STYLE_DEFAULTS };
  for (const [k, v] of Object.entries(rawStyles)) if (str(v) !== '') styles[k] = v;

  // pages
  const seen = new Set();
  const pages = [];
  for (const [i, r] of (tabs.pages || []).entries()) {
    const id = str(r.id).toLowerCase();
    if (!id) { if (str(r.content) || str(r.title)) warn(`pages, řádek ${i + 2}: chybí id stránky, řádek je přeskočen.`); continue; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) warn(`pages: id „${id}“ má obsahovat jen malá písmena bez diakritiky, číslice a pomlčky.`);
    if (seen.has(id)) { warn(`pages: id „${id}“ je tam dvakrát, druhý výskyt je přeskočen.`); continue; }
    seen.add(id);
    if (isNo(r.visible)) continue;
    pages.push({
      id: id.replace(/[^a-z0-9-]/g, '-'),
      order: num(r.order, 1000 + i),
      label: str(r.tab_label) || str(r.title) || id,
      title: str(r.title) || str(r.tab_label) || id,
      hue: ((num(r.hue, (i * 67 + 265) % 360) % 360) + 360) % 360,
      content: str(r.content),
      description: str(r.description),
      shareImage: str(r.share_image),
    });
  }
  pages.sort((a, b) => a.order - b.order);
  if (!pages.length) warn('pages: není tu žádná viditelná stránka.');

  // libraries
  const texts = new Map();
  for (const r of tabs.texts || []) { const id = str(r.id); if (id) texts.set(id, str(r.content)); }

  const media = new Map();
  for (const r of tabs.media || []) {
    const id = str(r.id);
    if (!id) continue;
    media.set(id, {
      id,
      kind: str(r.kind).toLowerCase() || 'image',
      source: str(r.source),
      alt: str(r.alt),
      caption: str(r.caption),
      credit: str(r.credit),
      focus: str(r.focus).toLowerCase() || 'center',
    });
  }

  const items = new Map();
  for (const [i, r] of (tabs.items || []).entries()) {
    const g = str(r.group);
    if (!g || isNo(r.visible)) continue;
    if (!items.has(g)) items.set(g, []);
    items.get(g).push({ order: num(r.order, i), title: str(r.title), text: str(r.text), image: str(r.image), link: str(r.link) });
  }
  for (const list of items.values()) list.sort((a, b) => a.order - b.order);

  const embeds = new Map();
  for (const r of tabs.embeds || []) { const id = str(r.id); if (id) embeds.set(id, { html: String(r.html ?? ''), height: num(r.height, 0) }); }

  // site settings
  let home = str(site.home_page).toLowerCase();
  if (pages.length && !pages.some(p => p.id === home)) {
    if (home) warn(`site: home_page „${home}“ neodpovídá žádné viditelné stránce, použije se „${pages[0].id}“.`);
    home = pages[0].id;
  }

  return {
    site: {
      name: str(site.site_name) || 'Web',
      language: str(site.language) || 'cs',
      domain: str(site.domain).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      home,
      description: str(site.description),
      shareImage: str(site.share_image),
      favicon: str(site.favicon),
      footer: str(site.footer),
      // Where contact-form messages go. Only the Apps Script reads it when a message
      // arrives; the address never appears in the published pages.
      formEmail: str(site.form_email),
    },
    styles,
    pages,
    texts,
    media,
    items,
    embeds,
  };
}

export { str, num, isNo };
