// Colour profiles. "manual" keeps the per-page hue from the pages tab; every other
// profile sets page colours, tab shades, text colours and the living background.

export const PROFILES = {
  // one warm colour in several shades: base (background), mid, accent, light
  terakota: { kind: 'mono', base: '#1F0E09', mid: '#6E2E1C', accent: '#C8643B', light: '#F2B79B' },
  jantar:   { kind: 'mono', base: '#1E1306', mid: '#6B420F', accent: '#D9932E', light: '#F6D49A' },
  koral:    { kind: 'mono', base: '#200D0C', mid: '#742B26', accent: '#E8715A', light: '#F8BFB3' },
  broskev:  { kind: 'mono', base: '#1F120E', mid: '#70402F', accent: '#E89B7A', light: '#F9D6C6' },
  karamel:  { kind: 'mono', base: '#1C1109', mid: '#5E3A1D', accent: '#B9773F', light: '#E9C9A3' },
  ruze:     { kind: 'mono', base: '#1D0E12', mid: '#63323C', accent: '#C97B84', light: '#F0CDD1' },
  vinova:   { kind: 'mono', base: '#19080E', mid: '#521A2C', accent: '#9E3B5A', light: '#E3A9BC' },
  pisek:    { kind: 'mono', base: '#1A150D', mid: '#5C4C33', accent: '#C9A77A', light: '#F1E3CB' },
  seda:     { kind: 'mono', gray: true, base: '#0E0E0F', mid: '#3A3A3C', accent: '#9C9C9E', light: '#E8E8E8' },
  // themed: neon edges and glow, background in the same family
  tron:     { kind: 'tron', base: '#03060B', mid: '#0A2A3A', accent: '#00E5FF', light: '#B8F6FF', second: '#FF7A1A' },
  // four colours that take turns page by page
  soumrak:  { kind: 'palette', base: '#11121C', colors: ['#D98B6A', '#7C78C8', '#5BA8A0', '#D9B86C'] },
  zeme:     { kind: 'palette', base: '#12100D', colors: ['#8FBF6F', '#E9A23B', '#C9583E', '#4F86C6'] },
  pastel:   { kind: 'palette', base: '#141219', colors: ['#D9A3B8', '#9CCBCF', '#A3B4D9', '#DCD9A8'] },
  sever:    { kind: 'palette', base: '#1E222A', colors: ['#88C0D0', '#A3BE8C', '#EBCB8B', '#BF616A'] },
};

export const PROFILE_NAMES = ['manual', ...Object.keys(PROFILES)];

const slug = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

export function hexToHsl(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let hue = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  return [Math.round(hue), Math.round(s * 100), Math.round(l * 100)];
}
const hsl = ([h, s, l]) => `hsl(${h},${s}%,${l}%)`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = h => ((Math.round(h) % 360) + 360) % 360;

// One-colour profiles: tabs go from darkest to lightest, then start again.
const TAB_DARK = 22, TAB_LIGHT = 46, TAB_CYCLE = 6;
function tabShade(i, count) {
  const cycle = Math.max(2, Math.min(count, TAB_CYCLE));
  return Math.round(TAB_DARK + (i % cycle) * (TAB_LIGHT - TAB_DARK) / (cycle - 1));
}

/**
 * pages: [{hue}] in display order; sat: manual saturation (0–100).
 * Returns per-page colours, the background targets, root CSS variables and extras.
 */
export function resolveProfile(name, pages, { sat = 70, warn = () => {} } = {}) {
  let key = slug(name) || 'manual';
  if (key !== 'manual' && !PROFILES[key]) {
    warn(`styles › color_profile: profil „${name}“ neexistuje, použije se manual. Možnosti: ${PROFILE_NAMES.join(', ')}.`);
    key = 'manual';
  }
  const p = PROFILES[key];

  if (!p) {
    // manual: the hue column decides, background built around it
    return {
      key, kind: 'manual', rootVars: {}, bodyClass: '',
      pages: pages.map(pg => ({
        h: pg.hue, s: sat, ts: 58, tl: 38,
        field: {
          base: [wrap(pg.hue + 10), 35, 5],
          blobs: [[pg.hue, 70, 42], [pg.hue + 50, 70, 42], [pg.hue - 60, 70, 42], [pg.hue + 120, 70, 42]].map(b => [wrap(b[0]), b[1], b[2]]),
          drift: 25,
        },
      })),
    };
  }

  const base = hexToHsl(p.base);
  if (p.kind === 'mono') {
    const A = hexToHsl(p.accent), L = hexToHsl(p.light);
    const gray = !!p.gray;
    const comp = wrap(A[0] + 180);                    // the background lives in the complementary colour
    const sat = v => (gray ? 0 : v);
    return {
      key, kind: 'mono', bodyClass: 'profile-mono',
      rootVars: {
        '--text': hsl([A[0], sat(30), 93]), '--muted': hsl([A[0], sat(22), 70]),
        '--glass-rgb': hslToRgbStr([base[0], sat(base[1]), clamp(base[2] + 1, 4, 12)]),
        '--ink': p.base, '--title': p.light,
      },
      pages: pages.map((pg, i) => {
        const shift = ((i % 3) - 1) * 8;              // each page leans a little to one side of the complement
        return {
          h: A[0], s: sat(clamp(A[1], 30, 75)), ts: sat(clamp(A[1] - 10, 25, 65)), tl: tabShade(i, pages.length),
          gs: gray ? 0 : 85,
          field: {
            base: [comp, sat(30), 6],
            blobs: [
              [wrap(comp + shift), sat(45), gray ? 30 : 34],
              [wrap(comp + 22 + shift), sat(38), gray ? 22 : 28],
              [wrap(comp - 20 + shift), sat(42), gray ? 26 : 30],
              [A[0], sat(clamp(A[1] - 20, 25, 60)), gray ? 18 : 26],   // a faint touch of the main colour
            ],
            drift: gray ? 0 : 9,
          },
        };
      }),
    };
  }

  if (p.kind === 'palette') {
    const C = p.colors.map(hexToHsl);
    const text = hsl([base[0], 18, 93]);
    return {
      key, kind: 'palette', bodyClass: 'profile-palette',
      rootVars: {
        '--text': text, '--muted': hsl([base[0], 12, 70]),
        '--glass-rgb': hslToRgbStr([base[0], clamp(base[1], 0, 30), clamp(base[2] + 2, 6, 14)]),
        '--ink': p.base,
      },
      pages: pages.map((pg, i) => {
        const c = C[i % C.length];
        const order = [0, 1, 2, 3].map(k => C[(i + k) % C.length]);   // the page's own colour leads
        return {
          h: c[0], s: clamp(c[1], 30, 65), ts: clamp(c[1] - 15, 25, 55), tl: clamp(c[2] - 26, 28, 40),
          field: {
            base: [base[0], clamp(base[1], 10, 40), 6],
            blobs: order.map((o, k) => [o[0], clamp(o[1] - 15, 20, 65), k === 0 ? 40 : 32]),
            drift: 6,
          },
        };
      }),
    };
  }

  // tron
  const A = hexToHsl(p.accent), S = hexToHsl(p.second);
  return {
    key, kind: 'tron', bodyClass: 'profile-tron',
    displayFont: 'Orbitron',
    rootVars: {
      '--text': hsl([A[0], 55, 90]), '--muted': hsl([A[0], 30, 66]),
      '--glass-rgb': '4,10,16', '--ink': p.base,
      '--neon': p.accent, '--neon2': p.second,
    },
    pages: pages.map((pg, i) => ({
      h: A[0], s: 100, ts: 70, tl: 9, gs: 85,
      field: {
        base: [205, 60, 5],
        blobs: [
          [A[0], 100, i % 2 ? 26 : 32],               // cyan glow
          [210, 80, 22],                               // deep blue
          [S[0], 100, i % 2 ? 30 : 22],                // orange, stronger on every other page
          [175, 80, 20],                               // teal
        ],
        drift: 10,
      },
    })),
  };
}

function hslToRgbStr([h, s, l]) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255)).join(',');
}
