// Self-hosted Google Fonts. At build time the font files are downloaded once
// (and cached in .cache/fonts), then served from the site itself, so visitors'
// browsers never contact Google. If Google can't be reached during the build,
// the site falls back to linking Google Fonts directly.
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Czech needs latin-ext; other scripts are skipped to keep the site small.
const SUBSETS = new Set(['latin', 'latin-ext']);
const exists = async p => { try { await stat(p); return true; } catch { return false; } };
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 10);

/** Keeps only @font-face blocks for the subsets we need. Google marks each block with a comment like /* latin-ext *\/. */
export function pickSubsets(css) {
  const out = [];
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
  let m, any = false;
  while ((m = re.exec(css))) { any = true; if (SUBSETS.has(m[1])) out.push({ subset: m[1], block: m[2] }); }
  if (!any) return [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map(x => ({ subset: 'latin', block: x[0] })); // no subset comments: keep all
  return out;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/**
 * families: [display, body, utility]. Returns the <head> markup:
 * a local stylesheet (self-hosted) or, if offline, Google links.
 */
export async function fontHead({ families, outDir, cacheDir, root, warn }) {
  const body = String(families[1] || '').trim();
  const names = [...new Set(families.map(f => String(f || '').trim()).filter(Boolean))];
  if (!names.length) return '';
  const urlFor = (name, weighted) => {
    const fam = encodeURIComponent(name).replace(/%20/g, '+');
    return `https://fonts.googleapis.com/css2?family=${fam}${weighted ? ':wght@400;600' : ''}&display=swap`;
  };
  const fontCache = path.join(cacheDir, '..', 'fonts');
  await mkdir(fontCache, { recursive: true });
  const fontOut = path.join(outDir, 'assets', 'fonts');
  const blocks = [];
  const preload = [];
  try {
    for (const name of names) {
      const cssKey = path.join(fontCache, hash(name + (name === body ? '|w' : '')) + '.css');
      let css;
      if (await exists(cssKey)) css = await readFile(cssKey, 'utf8');
      else {
        try { css = await fetchText(urlFor(name, name === body)); }
        catch (e) { if (name === body) css = await fetchText(urlFor(name, false)); else throw e; }
        await writeFile(cssKey, css);
      }
      for (const { subset, block } of pickSubsets(css)) {
        let b = block;
        for (const [, url] of block.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
          const ext = path.extname(new URL(url).pathname) || '.woff2';
          const file = hash(url) + ext;
          const cached = path.join(fontCache, file);
          if (!(await exists(cached))) {
            const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            await writeFile(cached, Buffer.from(await r.arrayBuffer()));
          }
          await mkdir(fontOut, { recursive: true });
          await copyFile(cached, path.join(fontOut, file));
          b = b.split(url).join(`fonts/${file}`);
          // preload the display font's basic Latin file: headings appear without a font swap
          if (name === names[0] && subset === 'latin' && !preload.length) preload.push(`fonts/${file}`);
        }
        blocks.push(b);
      }
    }
    const css = blocks.join('\n');
    const cssName = `fonts.${hash(css)}.css`;
    await mkdir(path.join(outDir, 'assets'), { recursive: true });
    await writeFile(path.join(outDir, 'assets', cssName), css);
    const pre = preload.map(f => `<link rel="preload" href="${root}assets/${f}" as="font" type="font/woff2" crossorigin>`).join('');
    return `${pre}<link rel="stylesheet" href="${root}assets/${cssName}">`;
  } catch (e) {
    warn(`Písma se nepodařilo stáhnout (${e.message}). Web je zatím načítá přímo z Google Fonts.`);
    const links = names.map(n => `<link rel="stylesheet" href="${urlFor(n, n === body)}">`).join('\n');
    return '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' + links;
  }
}
