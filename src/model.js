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

// Languages of the site: site › languages ("cs, en"), or the older single
// site › language. The first one is the main language.
export function siteLanguages(tabs) {
  const site = keyValue(tabs.site);
  const list = str(site.languages || site.language || 'cs').toLowerCase().split(/[\s,;]+/).filter(l => /^[a-z]{2}$/.test(l));
  return [...new Set(list.length ? list : ['cs'])];
}

// lang: the language to read. Other languages than the main one read the
// "<column>_<lang>" columns (title_en, content_en …) and fall back to the main
// column, with a warning, where a translation is missing.
export function buildModel(tabs, warn, { lang = null } = {}) {
  const langs = siteLanguages(tabs);
  const main = langs[0];
  if (!lang) lang = main;
  const tr = lang !== main;
  const sfx = '_' + lang;
  const missing = new Map(); // sheet -> count of untranslated cells
  // value of a translatable column in the current language
  const t = (r, col, sheet) => {
    if (!tr) return r[col];
    const v = r[col + sfx];
    if (str(v) !== '') return v;
    if (str(r[col]) !== '' && sheet) missing.set(sheet, (missing.get(sheet) || 0) + 1);
    return r[col];
  };
  const site = keyValue(tabs.site);
  // translated site settings: site_name_en, description_en, footer_en …
  if (tr) for (const k of Object.keys(site)) if (k.endsWith(sfx) && str(site[k]) !== '') site[k.slice(0, -sfx.length)] = site[k];
  const rawStyles = keyValue(tabs.styles);
  const styles = { ...STYLE_DEFAULTS };
  for (const [k, v] of Object.entries(rawStyles)) if (str(v) !== '') styles[k] = v;

  // pages (main pages and their subpages: parent_page = id of the main page)
  const seen = new Set();
  const pages = [];
  const allIds = new Map(); // every id in the sheet -> its parent_page (also hidden rows)
  for (const r of tabs.pages || []) { const id = str(r.id).toLowerCase(); if (id && !allIds.has(id)) allIds.set(id, str(r.parent_page).toLowerCase()); }
  for (const [i, r] of (tabs.pages || []).entries()) {
    const id = str(r.id).toLowerCase();
    if (!id) { if (str(r.content) || str(r.title)) warn(`pages, řádek ${i + 2}: chybí id stránky, řádek je přeskočen.`); continue; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) warn(`pages: id „${id}“ má obsahovat jen malá písmena bez diakritiky, číslice a pomlčky.`);
    if (seen.has(id)) { warn(`pages: id „${id}“ je tam dvakrát, druhý výskyt je přeskočen.`); continue; }
    seen.add(id);
    if (isNo(r.visible) || (tr && isNo(r['visible' + sfx]))) continue;
    const base = id.replace(/[^a-z0-9-]/g, '-');
    let slug = base;
    if (tr && str(r['id' + sfx])) {
      slug = str(r['id' + sfx]).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) warn(`pages: id${sfx} „${slug}“ má obsahovat jen malá písmena bez diakritiky, číslice a pomlčky.`);
      slug = slug.replace(/[^a-z0-9-]/g, '-');
    }
    pages.push({
      id: slug,
      base,
      parent: str(r.parent_page).toLowerCase(),
      untranslated: tr && str(r.content) !== '' && str(r['content' + sfx]) === '',
      order: num(r.order, 1000 + i),
      label: str(t(r, 'tab_label')) || str(t(r, 'title')) || slug,
      title: str(t(r, 'title')) || str(t(r, 'tab_label')) || slug,
      hue: ((num(r.hue, (i * 67 + 265) % 360) % 360) + 360) % 360,
      content: str(t(r, 'content')),
      description: str(t(r, 'description')),
      shareImage: str(t(r, 'share_image')),
    });
  }
  pages.sort((a, b) => a.order - b.order);
  // attach subpages to their main page; only one level
  const mains = pages.filter(p => !p.parent);
  for (const s of pages.filter(p => p.parent)) {
    const m = mains.find(p => p.base === s.parent);
    if (m) { (m.subs ||= []).push(s); continue; }
    if (tr) continue; // structure problems are reported once, in the main language
    if (!allIds.has(s.parent)) warn(`pages › ${s.base}: parent_page „${s.parent}“ neodpovídá žádné stránce, podstránka se nezobrazí.`);
    else if (allIds.get(s.parent)) warn(`pages › ${s.base}: parent_page „${s.parent}“ je sama podstránka. Podstránky mohou být jen o jednu úroveň, tahle se nezobrazí.`);
    // a hidden main page hides its subpages without a warning
  }
  pages.length = 0;
  pages.push(...mains);
  for (const m of pages) m.subs ||= [];
  for (const p of pages.flatMap(m => [m, ...m.subs])) if (p.untranslated) warn(`pages › ${p.base}: chybí překlad (content${sfx}), v jazyce ${lang} se zobrazí původní obsah.`);
  if (!pages.length) warn('pages: není tu žádná viditelná stránka.');
  if (tr) {
    const slugs = new Set();
    for (const p of pages) { if (slugs.has(p.id)) warn(`pages: id${sfx} „${p.id}“ je použité dvakrát.`); slugs.add(p.id); }
  }

  // libraries
  const texts = new Map();
  for (const r of tabs.texts || []) { const id = str(r.id); if (id) texts.set(id, str(t(r, 'content', 'texts'))); }

  const media = new Map();
  for (const r of tabs.media || []) {
    const id = str(r.id);
    if (!id) continue;
    media.set(id, {
      id,
      kind: str(r.kind).toLowerCase() || 'image',
      source: str(r.source),
      alt: str(t(r, 'alt', 'media')),
      caption: str(t(r, 'caption', 'media')),
      credit: str(t(r, 'credit')),
      focus: str(r.focus).toLowerCase() || 'center',
    });
  }

  const items = new Map();
  for (const [i, r] of (tabs.items || []).entries()) {
    const g = str(r.group);
    if (!g || isNo(r.visible) || (tr && isNo(r['visible' + sfx]))) continue;
    if (!items.has(g)) items.set(g, []);
    items.get(g).push({ order: num(r.order, i), title: str(t(r, 'title', 'items')), text: str(t(r, 'text', 'items')), image: str(t(r, 'image')), link: str(t(r, 'link')) });
  }
  for (const list of items.values()) list.sort((a, b) => a.order - b.order);

  const embeds = new Map();
  for (const r of tabs.embeds || []) { const id = str(r.id); if (id) embeds.set(id, { html: String(t(r, 'html', 'embeds') ?? ''), height: num(r.height, 0) }); }

  for (const [sheet, n] of missing) warn(`${sheet}: ${n} ${n === 1 ? 'buňka nemá' : n < 5 ? 'buňky nemají' : 'buněk nemá'} překlad do jazyka ${lang}, zobrazí se původní text.`);

  // site settings (home_page is always the main-language id)
  const homeBase = str(site.home_page).toLowerCase();
  let homePage = pages.find(p => p.base === homeBase);
  if (pages.length && !homePage) {
    if (homeBase && !tr && allIds.get(homeBase)) warn(`site: home_page „${homeBase}“ je podstránka, úvodní stránkou může být jen hlavní stránka. Použije se „${pages[0].id}“.`);
    else if (homeBase && !tr) warn(`site: home_page „${homeBase}“ neodpovídá žádné viditelné stránce, použije se „${pages[0].id}“.`);
    homePage = pages[0];
  }
  const home = homePage ? homePage.id : '';

  return {
    site: {
      name: str(site.site_name) || 'Web',
      language: lang,
      languages: langs,
      domain: str(site.domain).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
      home,
      description: str(site.description),
      shareImage: str(site.share_image),
      favicon: str(site.favicon),
      footer: str(site.footer),
      // Where contact-form messages go. Only the Apps Script reads it when a message
      // arrives; the address never appears in the published pages.
      formEmail: str(site.form_email),
      // Default address for `mapa:` blocks, and the map's zoom (1–21).
      address: str(site.address),
      mapZoom: str(site.map_zoom),
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
