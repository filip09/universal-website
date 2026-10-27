// Renders the site model into static files: one HTML file per page (each holds
// the whole stack, with its own page in front), shared CSS/JS, media, sitemap.
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCell, isToken, inline, paragraphs, escapeHtml as esc, safeUrl, STYLES, setVariables, spaceSize } from './markup.js';
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

// Several languages: renderSite runs once per language into the same outDir.
// The main language lives at the root (prefix ''), the others under 'en/' etc.
// Assets and media are always shared at the root. alts: Map of main-language
// page id -> { lang: path from the site root } for every language of the site.
const LANG_NAMES = { cs: 'Čeština', en: 'English', de: 'Deutsch', sk: 'Slovenčina', pl: 'Polski', fr: 'Français', es: 'Español', it: 'Italiano', uk: 'Українська', ru: 'Русский', zh: '中文' };

export async function renderSite({ model, media, outDir, cacheDir, warn, buildId, form = {}, prefix = '', clean = true, alts = null }) {
  if (clean) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const lang = model.site.language;
  const langs = model.site.languages || [lang];
  const multi = langs.length > 1 && alts;
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
        case 'space': html.push(`<div class="space space-${spaceSize(value)}" aria-hidden="true"></div>`); break;
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
        case 'form': html.push(renderForm(value, where)); break;
        case 'map': html.push(renderMap(value, style, where)); break;
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

  // ---------- forms ----------
  // A plain HTML form. The browser script (engine.js) sends it to the platform's
  // Apps Script, which looks up the recipient (site › form_email) by client id.
  // The recipient address is never part of the page.
  const FORM_TEXT = {
    cs: { name: 'Jméno', email: 'E-mail', phone: 'Telefon', optional: 'nepovinné', message: 'Zpráva', send: 'Odeslat',
      sending: 'Odesílám…', ok: 'Děkujeme, zpráva je na cestě. Ozveme se co nejdřív.',
      err: 'Zprávu se nepodařilo odeslat. Zkuste to prosím za chvíli znovu.',
      note: 'Zprávu dostane jen {web} a údaje použije jen k odpovědi.' },
    en: { name: 'Name', email: 'E-mail', phone: 'Phone', optional: 'optional', message: 'Message', send: 'Send',
      sending: 'Sending…', ok: 'Thank you, your message is on its way. We will get back to you soon.',
      err: 'The message could not be sent. Please try again in a moment.',
      note: 'Only {web} receives your message and uses your details just to reply.' },
  };
  const FORM_TYPES = { kontakt: 'kontakt', contact: 'kontakt' };
  let formCount = 0;
  function renderForm(value, where) {
    const raw = str(value).toLowerCase() || 'kontakt';
    let type = FORM_TYPES[raw];
    if (!type) {
      warnOnce('ft:' + raw, `${where}: formulář „${value}“ zatím neexistuje, zobrazí se kontaktní formulář.`);
      type = 'kontakt';
    }
    if (!model.site.formEmail) warnOnce('fe', `${where}: v listu site chybí form_email, zprávy z formuláře nebude kam poslat.`);
    if (!form.endpoint && form.strict) warnOnce('fu', `${where}: platforma nemá adresu pro příjem formulářů (FORM_ENDPOINT). Formulář se zobrazí, ale zprávy neodejdou.`);
    const t = FORM_TEXT[model.site.language] || FORM_TEXT.cs;
    const n = ++formCount, id = k => `f${n}-${k}`;
    const field = (k, label, input) => `<label class="f-field" for="${id(k)}"><span>${label}</span>${input}</label>`;
    return `<form class="uw-form" method="post" novalidate data-endpoint="${esc(form.endpoint || '')}" data-sending="${esc(t.sending)}" data-ok="${esc(t.ok)}" data-err="${esc(t.err)}">
<input type="hidden" name="client" value="${esc(form.client || '')}"><input type="hidden" name="type" value="${type}"><input type="hidden" name="t" value="">
<div class="f-trap" aria-hidden="true"><label>Web <input type="text" name="web" tabindex="-1" autocomplete="off"></label></div>
<div class="f-grid">
${field('name', t.name, `<input id="${id('name')}" name="name" type="text" required maxlength="120" autocomplete="name">`)}
${field('email', t.email, `<input id="${id('email')}" name="email" type="email" required maxlength="200" autocomplete="email" inputmode="email">`)}
${field('phone', `${t.phone} <em>(${t.optional})</em>`, `<input id="${id('phone')}" name="phone" type="tel" maxlength="40" autocomplete="tel">`)}
</div>
${field('message', t.message, `<textarea id="${id('message')}" name="message" required maxlength="5000" rows="5"></textarea>`)}
<div class="f-foot"><button class="btn" type="submit">${t.send}</button><p class="f-note">${inline(t.note)}</p></div>
<p class="f-status" role="status" aria-live="polite"></p>
</form>`;
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

  // A Google map of an address: `mapa:` uses site › address, `mapa: Some street 1`
  // shows another place. No API key needed. Nothing is loaded from Google until the
  // visitor clicks: the click is their consent to Google's cookies (engine.js).
  const MAP_TEXT = {
    cs: { open: 'Otevřít v Google Mapách', route: 'Naplánovat cestu', title: 'Mapa', show: 'Zobrazit mapu',
          consent: 'Mapu poskytuje Google, který při jejím zobrazení používá cookies. Kliknutím na Zobrazit mapu s tím souhlasíte.' },
    en: { open: 'Open in Google Maps', route: 'Get directions', title: 'Map', show: 'Show map',
          consent: 'The map is provided by Google, which uses cookies when it is shown. By clicking Show map you agree to this.' },
  };
  function renderMap(value, style, where) {
    const address = str(value) || model.site.address;
    if (!address) { warnOnce('map:' + where, `${where}: mapa nemá adresu. Vyplňte address v listu site, nebo napište adresu za mapa:.`); return ''; }
    const z = Math.min(21, Math.max(1, parseInt(model.site.mapZoom, 10) || 15));
    const q = encodeURIComponent(address);
    const lang = model.site.language === 'en' ? 'en' : 'cs';
    const t = MAP_TEXT[lang];
    const src = `https://www.google.com/maps?q=${q}&z=${z}&hl=${lang}&output=embed`;
    const open = `https://www.google.com/maps/search/?api=1&query=${q}`;
    const route = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
    return `<figure class="map map-${style || 'dark'}"><div class="map-frame"><button type="button" class="map-consent" data-map="${esc(src)}" data-title="${esc(t.title + ': ' + address)}"><span class="map-pin" aria-hidden="true"></span><span class="map-place">${esc(address)}</span><span class="btn">${t.show}</span><span class="map-note">${t.consent}</span></button></div>`
      + `<figcaption><span class="map-addr">${esc(address)}</span><span class="map-links"><a href="${esc(open)}" target="_blank" rel="noopener">${t.open}</a><a href="${esc(route)}" target="_blank" rel="noopener">${t.route} →</a></span></figcaption></figure>`;
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
  let footerHtml, pageFoot;
  const setFoot = () => { footerHtml = `<footer class="site-foot" id="site-foot">${footLine}</footer>`; pageFoot = `<footer class="page-foot">${footLine}</footer>`; };
  // colour profile: decides page colours, tab shades, text colours and the background
  const prof = resolveProfile(model.styles.color_profile, model.pages, { sat: num(model.styles.hue_saturation, 70), warn });
  const colorStyle = i => { const c = prof.pages[i]; return `--h:${c.h};--sat:${c.s}%;--ts:${c.ts}%;--tl:${c.tl}%;--gs:${c.gs ?? 85}%`; };
  // In another language, internal links written as /<id>/ (either the main-language
  // id or this language's id) lead to this language's version of that page.
  const slugOf = new Map();
  for (const p of model.pages) { slugOf.set(p.base || p.id, p.id); slugOf.set(p.id, p.id); }
  const localize = html => !prefix ? html : html.replace(/href="\/([a-z0-9-]*)\/?(#[^"]*)?"/g, (m, id, hash = '') => {
    if (id === '') return `href="/${prefix}${hash}"`;
    if (!slugOf.has(id)) return m;
    const s = slugOf.get(id);
    return `href="/${prefix}${s === model.site.home ? '' : s + '/'}${hash}"`;
  });
  if (prefix) footLine = localize(footLine);
  setFoot();
  const articles = [];
  for (const [i, p] of model.pages.entries()) {
    const body = localize(await renderContent(p.content, `pages › ${p.id}`));
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
    pages: model.pages.map((p, i) => ({ id: p.id, hue: prof.pages[i].h, title: p.title, field: prof.pages[i].field, alt: multi ? alts.get(p.base || p.id) : undefined })),
    lang,
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
    `<a class="mark" href="${ROOT}${prefix}${urlOf(p.id)}" data-id="${p.id}" style="${colorStyle(i)}">${esc(p.label)}</a>`).join('');
  // language switcher: links to the same page in the other languages
  const altOf = p => (multi && alts.get(p.base || p.id)) || {};
  const langNav = p => !multi ? '' : `<div class="langs" id="langs">${langs.map(l => {
    const to = altOf(p)[l];
    if (l === lang) return `<span class="lang is-current" lang="${l}" aria-current="true" title="${esc(LANG_NAMES[l] || l)}">${l.toUpperCase()}</span>`;
    return to === undefined ? '' : `<a class="lang" lang="${l}" hreflang="${l}" data-lang="${l}" href="${ROOT}${to}" title="${esc(LANG_NAMES[l] || l)}">${l.toUpperCase()}</a>`;
  }).join('')}</div>`;
  // First visit: a browser set to another of the site's languages goes there; a choice
  // made in the switcher is remembered and wins. Search-engine bots are left alone.
  const langScript = p => !multi ? '' : `<script>(function(){try{var A=${JSON.stringify(Object.fromEntries(Object.entries(altOf(p)).map(([l, to]) => [l, '%%ROOT%%' + to]))).replace(/</g, '\\u003c')},C=${JSON.stringify(lang)},M=${JSON.stringify(langs[0])};if(/bot|crawl|spider|slurp|lighthouse|headless|preview/i.test(navigator.userAgent))return;var s=null;try{s=localStorage.getItem('uw-lang')}catch(e){}if(s){if(s!==C&&A[s])location.replace(A[s]+location.hash);return}if(C!==M)return;var b=(navigator.languages||[navigator.language||'']);for(var i=0;i<b.length;i++){var l=String(b[i]).slice(0,2).toLowerCase();if(l===C)return;if(A[l]){location.replace(A[l]+location.hash);return}}}catch(e){}})();</script>`;

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
    const canonical = model.site.domain && !is404 ? `https://${model.site.domain}/${prefix}${urlOf(p.id)}` : '';
    const hreflang = multi && model.site.domain && !is404
      ? Object.entries(altOf(p)).map(([l, to]) => `<link rel="alternate" hreflang="${l}" href="https://${model.site.domain}/${to}">`).join('')
        + (altOf(p)[langs[0]] !== undefined ? `<link rel="alternate" hreflang="x-default" href="https://${model.site.domain}/${altOf(p)[langs[0]]}">` : '')
      : '';
    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      `<title>${esc(title)}</title>`,
      desc && `<meta name="description" content="${esc(desc)}">`,
      canonical && `<link rel="canonical" href="${canonical}">`,
      hreflang,
      !is404 && langScript(p),
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
<body${bodyCls} data-front="${p.id}" data-root="${ROOT}" data-pages="${ROOT}${prefix}" data-build="${buildId}">
<canvas id="field" aria-hidden="true"></canvas><div class="grain" aria-hidden="true"></div>
<main class="stage" id="stage"><div class="stack" id="stack">
${stack}
</div></main>
<nav class="marks" id="marks" aria-label="${lang === 'cs' ? 'Stránky' : 'Pages'}">${navHtml}${langNav(p)}</nav>
${footerHtml}
</body>
</html>`;
    const full = path.join(outDir, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, html.split(ROOT).join(root));
  }

  const up = '../'.repeat(prefix.split('/').filter(Boolean).length);
  for (const a of articles) {
    const isHome = a.page.id === model.site.home;
    await writePage(a, prefix + (isHome ? 'index.html' : `${a.page.id}/index.html`), up + (isHome ? './' : '../'));
  }
  const urls = model.pages.map(p => prefix + urlOf(p.id));
  if (prefix) return { pages: articles.length, images: pipe.stats, urls };
  const homeArticle = articles.find(a => a.page.id === model.site.home) || articles[0];
  if (homeArticle) await writePage(homeArticle, '404.html', '/', { is404: true });

  // caching rules (the sitemap is written by build.js, once for all languages)
  await writeFile(path.join(outDir, '_headers'), [
    '/assets/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/media/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin', '',
  ].join('\n'));
  return { pages: articles.length, images: pipe.stats, urls };
}

function mediaFile(model, media, ref) {
  const entry = model.media.get(ref);
  return media.find(entry ? entry.source : ref);
}

export { STYLES };
