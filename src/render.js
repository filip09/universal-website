// Renders the site model into static files: one HTML file per page (each holds
// the whole stack, with its own page in front), shared CSS/JS, media, sitemap.
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCell, isToken, inline, paragraphs, escapeHtml as esc, safeUrl, STYLES, setVariables } from './markup.js';
import { ImagePipeline } from './images.js';
import { fontHead } from './fonts.js';
import { resolveProfile } from './profiles.js';
import { mkdir as mkdirp, readFile as readF, writeFile as writeF, stat as statF } from 'node:fs/promises';
import { str, num, isNo } from './model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = '%%ROOT%%'; // replaced per output file with the relative path to the site root
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|svg|heic|heif|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const FOCUS = { center: '50% 50%', top: '50% 15%', bottom: '50% 85%', left: '15% 50%', right: '85% 50%' };

function youtubeId(u) {
  const m = u.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  return m ? m[1] : '';
}
function vimeoId(u) { const m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/); return m ? m[1] : ''; }

export async function renderSite({ model, media, outDir, cacheDir, warn, buildId }) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const pipe = new ImagePipeline({ cacheDir, outDir, warn });
  setVariables({ year: String(new Date().getFullYear()), site: model.site.name });
  const warnedIds = new Set();
  const warnOnce = (key, msg) => { if (!warnedIds.has(key)) { warnedIds.add(key); warn(msg); } };

  // ---------- media resolution ----------
  // ref may be: media id, file name / path in the media folder, or a URL
  async function resolveImage(ref, where) {
    const r = str(ref);
    if (!r) return null;
    const entry = model.media.get(r);
    const source = entry ? entry.source : r;
    const meta = { alt: entry?.alt || '', caption: entry?.caption || '', credit: entry?.credit || '', focus: FOCUS[entry?.focus] || FOCUS.center };
    if (/^https?:\/\//i.test(source)) {
      if (/drive\.google\.com|docs\.google\.com/.test(source)) {
        warnOnce('drv:' + r, `${where}: „${r}“ odkazuje na Google Disk. Stačí napsat jen název souboru ze složky media.`);
        return null;
      }
      return { ...meta, external: source };
    }
    const file = media.find(source);
    if (!file) {
      if (entry) warnOnce('nf:' + r, `${where}: soubor „${source}“ (id ${r}) není ve složce media.`);
      else warnOnce('nf:' + r, `${where}: „${r}“ není id v listu media ani soubor ve složce media.`);
      return null;
    }
    if (!IMAGE_EXT.test(file.name)) { warnOnce('ni:' + r, `${where}: „${file.name}“ není obrázek.`); return null; }
    const img = await pipe.image(file);
    return img ? { ...meta, img, file } : null;
  }

  function pictureHtml(res, { sizes = '(max-width: 760px) 100vw, 860px', cls = '' } = {}) {
    const alt = esc(res.alt);
    const style = res.focus !== FOCUS.center ? ` style="object-position:${res.focus}"` : '';
    if (res.external) return `<img class="${cls}" data-src="${esc(res.external)}" alt="${alt}" loading="lazy" decoding="async"${style}>`;
    const { img } = res;
    const dims = img.width ? ` width="${img.width}" height="${img.height}"` : '';
    if (img.kind !== 'responsive') return `<img class="${cls}" data-src="${ROOT}media/${img.src}" alt="${alt}"${dims} loading="lazy" decoding="async"${style}>`;
    const set = list => list.map(x => `${ROOT}media/${x.file} ${x.w}w`).join(', ');
    return `<picture><source type="image/avif" data-srcset="${set(img.avif)}" sizes="${sizes}"><source type="image/webp" data-srcset="${set(img.webp)}" sizes="${sizes}"><img class="${cls}" data-src="${ROOT}media/${img.src}" alt="${alt}"${dims} loading="lazy" decoding="async"${style}></picture>`;
  }

  const captionHtml = res => {
    const parts = [res.caption && inline(res.caption), res.credit && `<span class="credit">${inline(res.credit)}</span>`].filter(Boolean);
    return parts.length ? `<figcaption>${parts.join(' ')}</figcaption>` : '';
  };

  // ---------- blocks ----------
  async function renderContent(cell, where, depth = 0) {
    const parts = parseCell(cell);
    const html = [];
    for (let i = 0; i < parts.length; i++) {
      const { kw, value, style } = parts[i];
      switch (kw) {
        case 'text': {
          if (isToken(value) && model.texts.has(value)) {
            if (depth > 3) { warn(`${where}: text „${value}“ odkazuje sám na sebe.`); break; }
            const inner = await renderContent(model.texts.get(value), `texts › ${value}`, depth + 1);
            html.push(style && style !== 'normal' ? `<div class="t t-${style}">${inner}</div>` : inner);
          } else {
            if (isToken(value) && /^[a-z]+-[a-z0-9-]+$/.test(value)) warnOnce('tx:' + value, `${where}: „${value}“ vypadá jako id, ale v listu texts není. Zobrazí se jako text.`);
            const ps = paragraphs(value).map(p => `<p>${inline(p)}</p>`).join('');
            html.push(style && style !== 'normal' ? `<div class="t t-${style}">${ps}</div>` : ps);
          }
          break;
        }
        case 'lead': html.push(`<p class="lead">${inline(value)}</p>`); break;
        case 'heading': html.push(`<h2>${inline(value)}</h2>`); break;
        case 'subheading': html.push(`<h3>${inline(value)}</h3>`); break;
        case 'quote': {
          const next = parts[i + 1];
          const author = next && next.kw === 'author' ? next.value : '';
          if (author) i++;
          html.push(`<figure class="quote"><blockquote><p>${inline(value)}</p></blockquote>${author ? `<figcaption>${inline(author)}</figcaption>` : ''}</figure>`);
          break;
        }
        case 'author': html.push(`<p class="author">${inline(value)}</p>`); break;
        case 'note': html.push(`<aside class="note">${paragraphs(value).map(p => `<p>${inline(p)}</p>`).join('')}</aside>`); break;
        case 'small': html.push(`<p class="small">${inline(value)}</p>`); break;
        case 'divider': html.push('<hr>'); break;
        case 'button': {
          const [label, url] = value.includes('->') ? value.split('->').map(s => s.trim()) : [value, value];
          const href = safeUrl(url);
          if (!href) { warn(`${where}: tlačítko „${label}“ nemá platný odkaz (zápis: popis -> https://…).`); break; }
          const ext = /^https?:/i.test(href);
          html.push(`<p class="btn-row"><a class="btn" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inline(label)}</a></p>`);
          break;
        }
        case 'image': {
          const res = await resolveImage(value, where);
          if (!res) break;
          const s = style || 'inset';
          html.push(`<figure class="img img-${s}">${pictureHtml(res, { sizes: s === 'full' ? '(max-width: 760px) 100vw, 1000px' : undefined })}${captionHtml(res)}</figure>`);
          break;
        }
        case 'gallery': {
          const group = model.items.get(value);
          if (!group) { warn(`${where}: galerie „${value}“ není v listu items (sloupec group).`); break; }
          const s = style || 'grid';
          const tiles = [];
          for (const it of group) {
            const res = await resolveImage(it.image, `items › ${value}`);
            if (!res) continue;
            if (!res.alt && it.title) res.alt = it.title;
            const cap = it.title || it.text ? `<figcaption>${it.title ? `<b>${inline(it.title)}</b> ` : ''}${inline(it.text)}</figcaption>` : '';
            const pic = pictureHtml(res, { sizes: s === 'row' ? '(max-width: 760px) 70vw, 340px' : '(max-width: 760px) 50vw, 300px' });
            const href = safeUrl(it.link);
            tiles.push(`<figure class="tile">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${pic}</a>` : pic}${cap}</figure>`);
          }
          if (tiles.length) html.push(`<div class="gallery gallery-${s}">${tiles.join('')}</div>`);
          break;
        }
        case 'video': html.push(await renderVideo(value, style, where)); break;
        case 'list': {
          const group = isToken(value) ? model.items.get(value) : null;
          if (group) {
            const s = style || 'steps';
            if (s === 'faq') {
              const qs = group.map(it => `<details class="faq-item"><summary><span>${inline(it.title)}</span><i aria-hidden="true"></i></summary><div class="faq-a">${paragraphs(it.text).map(p => `<p>${inline(p)}</p>`).join('')}${safeUrl(it.link) ? `<p><a href="${esc(safeUrl(it.link))}">Více →</a></p>` : ''}</div></details>`);
              html.push(`<div class="faq">${qs.join('')}</div>`);
              break;
            }
            if (s === 'bullets') {
              html.push(`<ul class="bullets">${group.map(it => `<li>${it.title ? `<b>${inline(it.title)}</b> ` : ''}${inline(it.text)}</li>`).join('')}</ul>`);
              break;
            }
            const cards = [];
            for (const [n, it] of group.entries()) {
              const res = it.image ? await resolveImage(it.image, `items › ${value}`) : null;
              const href = safeUrl(it.link);
              const body = `${res ? pictureHtml(res, { sizes: '(max-width: 760px) 100vw, 640px', cls: 'card-img' }) : ''}${s === 'steps' ? `<span class="num">${String(n + 1).padStart(2, '0')}</span>` : ''}<div class="card-body">${it.title ? `<h3>${inline(it.title)}</h3>` : ''}${it.text ? paragraphs(it.text).map(p => `<p>${inline(p)}</p>`).join('') : ''}${href ? `<a class="more" href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : ''}>→</a>` : ''}</div>`;
              cards.push(`<li class="card">${body}</li>`);
            }
            html.push(`<ol class="cards cards-${s}">${cards.join('')}</ol>`);
          } else {
            if (isToken(value) && /^[a-z]+-[a-z0-9-]+$/.test(value)) warnOnce('ls:' + value, `${where}: seznam „${value}“ není skupina v listu items. Zobrazí se jako odrážka.`);
            const itemsList = value.includes('\n') && /^\s*-/m.test(value)
              ? value.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
              : value.split(/;|\n/).map(s => s.trim()).filter(Boolean);
            html.push(`<ul class="bullets">${itemsList.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`);
          }
          break;
        }
        case 'embed': {
          const e = model.embeds.get(value);
          if (!e) { warn(`${where}: vložený prvek „${value}“ není v listu embeds.`); break; }
          const h = e.height ? ` style="min-height:${e.height}px"` : '';
          html.push(`<div class="embed embed-${style || 'normal'}"${h}><template>${e.html}</template></div>`);
          break;
        }
      }
    }
    return html.join('\n');
  }

  // YouTube preview image, downloaded at build time so the page never contacts Google before a click.
  async function youtubePoster(id) {
    const dir = path.join(cacheDir, 'youtube');
    const file = path.join(dir, id + '.jpg');
    let ok = false;
    try { await statF(file); ok = true; } catch {}
    if (!ok) {
      for (const size of ['maxresdefault', 'hqdefault']) {
        try {
          const r = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) continue;
          await mkdirp(dir, { recursive: true });
          await writeF(file, Buffer.from(await r.arrayBuffer()));
          ok = true; break;
        } catch {}
      }
    }
    if (!ok) return null;
    return pipe.image({ key: 'yt:' + id, name: `youtube-${id}.jpg`, path: `YouTube ${id}`, fetch: () => readF(file) });
  }

  async function renderVideo(value, style, where) {
    const s = style || 'normal';
    const entry = model.media.get(value);
    const src = entry ? entry.source : value;
    const cap = entry ? captionHtml({ caption: entry.caption, credit: entry.credit }) : '';
    const yt = youtubeId(src), vm = vimeoId(src);
    if (yt || vm) {
      const embed = yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0` : `https://player.vimeo.com/video/${vm}?autoplay=1&dnt=1`;
      const poster = yt ? await youtubePoster(yt) : null;
      const thumb = poster ? ` data-bg="${ROOT}media/${poster.src}"` : '';
      const label = esc(entry?.alt || 'Přehrát video');
      return `<figure class="video video-${s}"><button class="video-frame" data-embed="${esc(embed)}" aria-label="${label}"${thumb}><span class="play"></span></button>${cap}</figure>`;
    }
    const file = media.find(src);
    if (file && VIDEO_EXT.test(file.name)) {
      const out = await pipe.copy(file);
      if (!out) return '';
      return `<figure class="video video-${s}"><video controls preload="none" playsinline data-src="${ROOT}media/${out.src}"></video>${cap}</figure>`;
    }
    warn(`${where}: video „${value}“ není odkaz na YouTube/Vimeo ani soubor ve složce media.`);
    return '';
  }

  // ---------- pages ----------
  // Footer: the client's text (default: © year + site name) and the platform credit, always.
  const footerText = model.site.footer || 'drobné: © {rok} {web}';
  const credit = `<a class="platform-credit" href="https://filipmracek.com" target="_blank" rel="noopener">platform by filipmracek.com</a>`;
  let footLine = (await renderContent(footerText, 'site › footer')).trim();
  footLine = /<\/p>$/.test(footLine) ? footLine.replace(/<\/p>$/, ` · ${credit}</p>`) : `${footLine}<p>${credit}</p>`;
  const footerHtml = `<footer class="site-foot" id="site-foot">${footLine}</footer>`;
  const pageFoot = `<footer class="page-foot">${footLine}</footer>`;
  // colour profile: decides page colours, tab shades, text colours and the background
  const prof = resolveProfile(model.styles.color_profile, model.pages, { sat: num(model.styles.hue_saturation, 70), warn });
  const colorStyle = i => { const c = prof.pages[i]; return `--h:${c.h};--sat:${c.s}%;--ts:${c.ts}%;--tl:${c.tl}%;--gs:${c.gs ?? 85}%`; };
  const articles = [];
  for (const [i, p] of model.pages.entries()) {
    const body = await renderContent(p.content, `pages › ${p.id}`);
    articles.push({
      page: p,
      html: `<article class="page" id="p-${p.id}" data-id="${p.id}" style="${colorStyle(i)}" aria-labelledby="t-${p.id}"><div class="scroll"><div class="inner"><h1 id="t-${p.id}">${inline(p.title)}</h1>\n${body}\n${pageFoot}</div></div></article>`,
    });
  }

  // ---------- shared assets ----------
  const css = await readFile(path.join(here, 'client', 'site.css'), 'utf8');
  const js = await readFile(path.join(here, 'client', 'engine.js'), 'utf8');
  const h = s => createHash('sha1').update(s).digest('hex').slice(0, 8);
  const cssName = `site.${h(css)}.css`, jsName = `engine.${h(js)}.js`;
  await mkdir(path.join(outDir, 'assets'), { recursive: true });
  await writeFile(path.join(outDir, 'assets', cssName), css);
  await writeFile(path.join(outDir, 'assets', jsName), js);

  const st = model.styles;
  const hex = (v, d) => /^#?[0-9a-f]{3,8}$/i.test(str(v)) ? '#' + str(v).replace('#', '') : d;
  const clamp = (v, a, b, d) => Math.min(b, Math.max(a, num(v, d)));
  const displayFont = prof.displayFont || st.font_display;
  const vars = [
    `--glass:${clamp(st.glass_opacity, 0.2, 0.98, 0.6)}`,
    `--pw-max:${clamp(st.page_width, 560, 1400, 860)}px`,
    `--radius:${clamp(st.page_radius, 0, 48, 22)}px`,
    `--fs:${clamp(st.text_size, 13, 22, 16)}px`,
    `--text:${hex(st.text_color, '#ECE9F4')}`,
    `--muted:${hex(st.muted_color, '#A29FB7')}`,
    `--sat:${clamp(st.hue_saturation, 0, 100, 70)}%`,
    `--f-display:"${str(displayFont).replace(/"/g, '')}", ${prof.kind === 'tron' ? 'ui-sans-serif, system-ui, sans-serif' : '"Iowan Old Style", Georgia, serif'}`,
    `--f-body:"${str(st.font_body).replace(/"/g, '')}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
    `--f-mono:"${str(st.font_utility).replace(/"/g, '')}", ui-monospace, "SF Mono", Menlo, monospace`,
    ...Object.entries(prof.rootVars).map(([k, v]) => `${k}:${v}`),
  ].join(';');
  const fonts = await fontHead({ families: [displayFont, st.font_body, st.font_utility], outDir, cacheDir, root: ROOT, warn });

  const config = {
    home: model.site.home,
    pages: model.pages.map((p, i) => ({ id: p.id, hue: prof.pages[i].h, title: p.title, field: prof.pages[i].field })),
    profile: prof.kind,
    siteName: model.site.name,
    turn: {
      speed: ['slow', 'quick'].includes(str(st.turn_speed).toLowerCase()) ? str(st.turn_speed).toLowerCase() : 'normal',
      angle: clamp(st.turn_angle, 0, 45, 30),
      depth: clamp(st.stack_depth, 1, 8, 5),
    },
    bg: {
      mode: ['still', 'solid'].includes(str(st.background).toLowerCase()) ? str(st.background).toLowerCase() : 'drift',
      speed: str(st.background_speed).toLowerCase() === 'normal' ? 1 : 0.55,
      follow: !isNo(st.background_follows_page),
    },
  };

  // favicon + share image
  let iconTags = '';
  if (model.site.favicon) {
    const f = mediaFile(model, media, model.site.favicon);
    const ico = f && await pipe.icon(f);
    if (ico) iconTags = `<link rel="icon" type="image/png" sizes="32x32" href="${ROOT}media/${ico.small}"><link rel="apple-touch-icon" href="${ROOT}media/${ico.large}">`;
    else warn(`site › favicon: „${model.site.favicon}“ se nenašel ve složce media.`);
  }
  async function shareUrl(ref) {
    if (!ref) return '';
    const f = mediaFile(model, media, ref);
    const og = f && await pipe.share(f);
    if (!og) return '';
    return model.site.domain ? `https://${model.site.domain}/media/${og.src}` : `${ROOT}media/${og.src}`;
  }
  const defaultShare = await shareUrl(model.site.shareImage);

  const urlOf = id => (id === model.site.home ? '' : `${id}/`);
  const navHtml = model.pages.map((p, i) =>
    `<a class="mark" href="${ROOT}${urlOf(p.id)}" data-id="${p.id}" style="${colorStyle(i)}">${esc(p.label)}</a>`).join('');

  async function writePage(front, file, root, { is404 = false } = {}) {
    const p = front.page;
    const stack = articles.map(a => {
      let s = a.html;
      if (a === front) s = s.replace('class="page"', 'class="page is-front"').replace(/ data-srcset=/g, ' srcset=').replace(/ data-src=/g, ' src=');
      return s;
    }).join('\n');
    const title = p.id === model.site.home ? model.site.name : `${p.title} · ${model.site.name}`;
    const desc = p.description || model.site.description;
    const share = (await shareUrl(p.shareImage)) || defaultShare;
    const canonical = model.site.domain && !is404 ? `https://${model.site.domain}/${urlOf(p.id)}` : '';
    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      `<title>${esc(title)}</title>`,
      desc && `<meta name="description" content="${esc(desc)}">`,
      canonical && `<link rel="canonical" href="${canonical}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      desc && `<meta property="og:description" content="${esc(desc)}">`,
      share && `<meta property="og:image" content="${share}"><meta name="twitter:card" content="summary_large_image">`,
      canonical && `<meta property="og:url" content="${canonical}">`,
      is404 && '<meta name="robots" content="noindex">',
      iconTags,
      fonts,
      `<link rel="stylesheet" href="${ROOT}assets/${cssName}">`,
      `<style>:root{${vars}}</style>`,
      `<script type="application/json" id="uw-config">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`,
      `<script src="${ROOT}assets/${jsName}" defer></script>`,
    ].filter(Boolean).join('\n');
    const classes = [str(st.tabs_desktop).toLowerCase() === 'left' ? 'tabs-left' : '', prof.bodyClass].filter(Boolean).join(' ');
    const bodyCls = classes ? ` class="${classes}"` : '';
    const html = `<!doctype html>
<html lang="${esc(model.site.language)}">
<head>
${head}
</head>
<body${bodyCls} data-front="${p.id}" data-root="${ROOT}" data-build="${buildId}">
<canvas id="field" aria-hidden="true"></canvas><div class="grain" aria-hidden="true"></div>
<main class="stage" id="stage"><div class="stack" id="stack">
${stack}
</div></main>
<nav class="marks" id="marks" aria-label="Stránky">${navHtml}</nav>
${footerHtml}
</body>
</html>`;
    const full = path.join(outDir, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, html.split(ROOT).join(root));
  }

  for (const a of articles) {
    const isHome = a.page.id === model.site.home;
    await writePage(a, isHome ? 'index.html' : `${a.page.id}/index.html`, isHome ? './' : '../');
  }
  const homeArticle = articles.find(a => a.page.id === model.site.home) || articles[0];
  if (homeArticle) await writePage(homeArticle, '404.html', '/', { is404: true });

  // caching rules and sitemap
  await writeFile(path.join(outDir, '_headers'), [
    '/assets/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/media/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin', '',
  ].join('\n'));
  if (model.site.domain) {
    const urls = model.pages.map(p => `<url><loc>https://${model.site.domain}/${urlOf(p.id)}</loc></url>`).join('');
    await writeFile(path.join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
    await writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://${model.site.domain}/sitemap.xml\n`);
  }
  return { pages: articles.length, images: pipe.stats };
}

function mediaFile(model, media, ref) {
  const entry = model.media.get(ref);
  return media.find(entry ? entry.source : ref);
}

export { STYLES };
