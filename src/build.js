// One build: source (Google or local) → model → static files.
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildModel, siteLanguages } from './model.js';
import { renderSite } from './render.js';

export const now = () => new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });

export async function buildFromSource({ source, outDir, cacheDir, warnings, form }) {
  const warn = msg => { if (!warnings.includes(msg)) warnings.push(msg); };
  const langs = siteLanguages(source.tabs);
  const model = buildModel(source.tabs, warn);
  if (!model.pages.length) throw new Error('Web nemá žádnou viditelnou stránku (list pages).');
  // one model per language; the main language at the root, the others under /<lang>/
  const models = [{ lang: langs[0], prefix: '', model }];
  for (const lang of langs.slice(1)) {
    const m = buildModel(source.tabs, msg => warn(`[${lang}] ${msg}`), { lang });
    if (m.pages.length) models.push({ lang, prefix: lang + '/', model: m });
    else warn(`Jazyk ${lang}: žádná viditelná stránka, jazyková verze se nevytvoří.`);
  }
  // where each page lives in every language: main id -> { lang: path from the root }
  const alts = new Map();
  for (const { lang, prefix, model: m } of models) for (const p of m.pages) {
    if (!alts.has(p.base)) alts.set(p.base, {});
    alts.get(p.base)[lang] = prefix + (p.id === m.site.home ? '' : p.id + '/');
  }
  const buildId = Date.now().toString(36);
  let result = null;
  const urls = [];
  for (const [i, x] of models.entries()) {
    const r = await renderSite({ model: x.model, media: source.media, outDir, cacheDir, warn, buildId, form, prefix: x.prefix, clean: i === 0, alts });
    urls.push(...r.urls);
    result = result ? { ...result, pages: result.pages + r.pages } : r;
  }
  if (model.site.domain) {
    const loc = urls.map(u => `<url><loc>https://${model.site.domain}/${u}</loc></url>`).join('');
    await writeFile(path.join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${loc}</urlset>`);
    await writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://${model.site.domain}/sitemap.xml\n`);
  }
  return { model, ...result, languages: models.map(x => x.lang) };
}

export function summary(res) {
  const img = res.images.processed + res.images.cached;
  return `${res.pages} ${res.pages === 1 ? 'stránka' : res.pages < 5 ? 'stránky' : 'stránek'}, ${img} ${img === 1 ? 'soubor' : img < 5 && img > 0 ? 'soubory' : 'souborů'} médií (nově zpracováno ${res.images.processed}).`;
}

export const defaultCache = (client) => path.join('.cache', client);
