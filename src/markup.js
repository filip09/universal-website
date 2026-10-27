// The content language used in the sheet:
//   keyword: value | style
// Czech and English keywords mean the same thing. A part starts wherever a
// known keyword is followed by a colon, at the start of the cell or after
// whitespace, so parts can sit on separate lines or on one line.

export const KEYWORDS = {
  // blocks that can point to other tabs
  text: 'text',
  image: 'image', 'obrázek': 'image', obrazek: 'image', img: 'image',
  gallery: 'gallery', galerie: 'gallery',
  video: 'video',
  list: 'list', seznam: 'list',
  embed: 'embed', 'vložit': 'embed', vlozit: 'embed',
  form: 'form', 'formulář': 'form', formular: 'form',
  // text formatting
  lead: 'lead', 'úvod': 'lead', uvod: 'lead',
  heading: 'heading', nadpis: 'heading',
  subheading: 'subheading', mezititulek: 'subheading', semititle: 'subheading', podnadpis: 'subheading',
  quote: 'quote', citation: 'quote', citace: 'quote',
  author: 'author', autor: 'author',
  note: 'note', 'poznámka': 'note', poznamka: 'note',
  button: 'button', 'tlačítko': 'button', tlacitko: 'button',
  divider: 'divider', 'oddělovač': 'divider', oddelovac: 'divider',
  space: 'space', spacer: 'space', mezera: 'space',
  small: 'small', 'drobné': 'small', drobne: 'small',
};

export const STYLES = {
  text: ['normal', 'wide', 'centered', 'large'],
  image: ['inset', 'full'],
  gallery: ['grid', 'row'],
  video: ['normal', 'wide'],
  list: ['steps', 'cards', 'bullets', 'faq'],
  embed: ['normal', 'full'],
};

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KW_RE = new RegExp(
  '(?<=^|\\s)(' + Object.keys(KEYWORDS).sort((a, b) => b.length - a.length).map(escapeRe).join('|') + '):',
  'giu'
);
const STYLE_WORDS = new Set(Object.values(STYLES).flat());
const STYLE_RE = /\s*\|\s*([a-zA-Z-]+)\s*$/;

/** Split one cell into parts: [{ kw, value, style }] */
export function parseCell(cell) {
  const text = String(cell ?? '').replace(/\r\n?/g, '\n');
  const parts = [];
  const matches = [...text.matchAll(KW_RE)];
  const lead = (matches.length ? text.slice(0, matches[0].index) : text).trim();
  if (lead) parts.push({ kw: 'text', value: lead, style: '' });
  matches.forEach((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let value = text.slice(m.index + m[0].length, end).trim();
    let style = '';
    const sm = value.match(STYLE_RE);
    if (sm && STYLE_WORDS.has(sm[1].toLowerCase())) {
      style = sm[1].toLowerCase();
      value = value.slice(0, sm.index).trim();
    }
    parts.push({ kw: KEYWORDS[m[1].toLowerCase()], value, style });
  });
  return parts;
}

/** A value that is a single word without spaces, which may be an id. */
export const isToken = v => /^[^\s]+$/.test(v);

export const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function safeUrl(url) {
  const u = String(url || '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(u) || /^[/#.]/.test(u)) return u;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return 'https://' + u;
  return '';
}

// Variables usable in any text: {rok}/{year} → current year (kept current in the
// browser too), {web}/{site} → site name. Set once per build with setVariables().
const VARS = { year: String(new Date().getFullYear()), site: '' };
export function setVariables(v) { Object.assign(VARS, v); }

/** Inline formatting: **bold**, *italic*, [text](link); single newlines become <br>. */
export function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\{\s*(rok|year)\s*\}/gi, `<span class="uw-year">${VARS.year}</span>`)
       .replace(/\{\s*(web|site)\s*\}/gi, escapeHtml(VARS.site))
       .replace(/\(c\)/gi, '©');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const href = safeUrl(url.replace(/&amp;/g, '&'));
    if (!href) return label;
    const ext = /^https?:/i.test(href);
    return `<a href="${escapeHtml(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\p{L}\p{N}])\*([^*\s][^*]*?)\*(?![*\p{L}\p{N}])/gu, '$1<em>$2</em>');
  return s.replace(/\n/g, '<br>');
}

/** Text with blank lines between paragraphs → array of paragraph strings. */
export const paragraphs = text => String(text).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

/** Size of a `mezera:` / `space:` block: empty = normal, "velká"/"large" = l, "malá"/"small" = s. */
export function spaceSize(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (/^(velk[áa]|large|big|l)$/.test(v)) return 'l';
  if (/^(mal[áa]|small|s)$/.test(v)) return 's';
  return 'm';
}
