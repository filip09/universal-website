// One build: source (Google or local) → model → static files.
import path from 'node:path';
import { buildModel } from './model.js';
import { renderSite } from './render.js';

export const now = () => new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });

export async function buildFromSource({ source, outDir, cacheDir, warnings }) {
  const warn = msg => { if (!warnings.includes(msg)) warnings.push(msg); };
  const model = buildModel(source.tabs, warn);
  if (!model.pages.length) throw new Error('Web nemá žádnou viditelnou stránku (list pages).');
  const buildId = Date.now().toString(36);
  const result = await renderSite({ model, media: source.media, outDir, cacheDir, warn, buildId });
  return { model, ...result };
}

export function summary(res) {
  const img = res.images.processed + res.images.cached;
  return `${res.pages} ${res.pages === 1 ? 'stránka' : res.pages < 5 ? 'stránky' : 'stránek'}, ${img} ${img === 1 ? 'soubor' : img < 5 && img > 0 ? 'soubory' : 'souborů'} médií (nově zpracováno ${res.images.processed}).`;
}

export const defaultCache = (client) => path.join('.cache', client);
