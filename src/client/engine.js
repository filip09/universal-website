/* Universal Website — page-turning engine. No dependencies. */
(() => {
  'use strict';
  const cfg = JSON.parse(document.getElementById('uw-config').textContent);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const body = document.body;
  const root = new URL(body.dataset.root || './', location.href);
  // pages of this language live under data-pages (the root, or e.g. en/); media under data-root
  const proot = new URL(body.dataset.pages || body.dataset.root || './', location.href);
  const stack = document.getElementById('stack');
  const pages = [...stack.querySelectorAll('.page')];
  const N = pages.length;
  const marksEl = document.getElementById('marks');
  const marks = [...marksEl.querySelectorAll('.mark')];
  const langLinks = [...document.querySelectorAll('a.lang-link')];
  const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const idx = id => pages.findIndex(p => p.dataset.id === id);
  if (!N) return;

  // ---------- tuning from the styles tab ----------
  const SPEED = { slow: .62, normal: 1, quick: 1.5 }[cfg.turn.speed] || 1;
  const ANGLE = cfg.turn.angle;
  const DEPTH = Math.max(1, cfg.turn.depth);
  const K_TILT = 150 * SPEED, C_TILT = 19 * Math.sqrt(SPEED);
  const K_FOC = 75 * SPEED, C_FOC = 16 * Math.sqrt(SPEED);

  // ---------- urls ----------
  const urlOf = id => new URL(id === cfg.home ? '' : id + '/', proot).href;
  function idFromLocation() { return routeOf(location.pathname).id; }
  // path -> { id: page id, sub: subpage id or '' } ; null id when the path is not ours
  const subRoutes = new Map();
  cfg.pages.forEach(p => (p.subs || []).forEach(s => {
    subRoutes.set(s.url.replace(/\/$/, ''), { id: p.id, sub: s.id });
    subRoutes.set(s.id, { id: p.id, sub: s.id });
  }));
  function routeOf(pathname) {
    const rel = decodeURIComponent(pathname.slice(proot.pathname.length)).replace(/\/(index\.html)?$/, '');
    if (!rel) return { id: cfg.home, sub: '' };
    if (subRoutes.has(rel)) return subRoutes.get(rel);
    return { id: idx(rel) >= 0 ? rel : null, sub: '' };
  }
  const subOf = (i, sid) => ((cfg.pages[i] && cfg.pages[i].subs) || []).find(s => s.id === sid) || null;
  const subUrlOf = (i, sid) => { const s = subOf(i, sid); return s ? new URL(s.url, proot).href : urlOf(cfg.pages[i].id); };

  // ---------- lazy media ----------
  // Relative media paths are resolved against the root captured at load, because
  // the address changes as pages turn and relative URLs would then point elsewhere.
  const abs = u => new URL(u, root).href;
  const absSet = s => s.split(',').map(part => { const [u, w] = part.trim().split(/\s+/); return abs(u) + (w ? ' ' + w : ''); }).join(', ');
  const hydrated = new Set();
  function hydrate(p) {
    if (hydrated.has(p)) return;
    hydrated.add(p);
    p.querySelectorAll('[data-srcset]').forEach(el => { el.srcset = absSet(el.dataset.srcset); el.removeAttribute('data-srcset'); });
    p.querySelectorAll('img[data-src]').forEach(el => { el.src = abs(el.dataset.src); el.removeAttribute('data-src'); });
    p.querySelectorAll('[data-bg]').forEach(el => { el.style.backgroundImage = `url("${abs(el.dataset.bg)}")`; el.removeAttribute('data-bg'); });
  }
  pages.forEach(p => {
    if (!p.classList.contains('is-front')) return;
    hydrated.add(p);
    p.querySelectorAll('[srcset]').forEach(el => { el.srcset = absSet(el.getAttribute('srcset')); });
    p.querySelectorAll('img[src]').forEach(el => { el.src = abs(el.getAttribute('src')); });
    p.querySelectorAll('[data-bg]').forEach(el => { el.style.backgroundImage = `url("${abs(el.dataset.bg)}")`; el.removeAttribute('data-bg'); });
  });
  marks.forEach(m => { m.href = urlOf(m.dataset.id); });

  function activate(p) {
    hydrate(p);
    p.querySelectorAll('.embed > template').forEach(t => {
      const box = t.parentElement;
      const frag = t.content.cloneNode(true);
      // scripts inserted from a template do not run; recreate them
      frag.querySelectorAll('script').forEach(old => {
        const s = document.createElement('script');
        for (const a of old.attributes) s.setAttribute(a.name, a.value);
        s.textContent = old.textContent;
        old.replaceWith(s);
      });
      t.remove();
      box.appendChild(frag);
    });
    p.querySelectorAll('video[data-src]').forEach(v => { v.src = abs(v.dataset.src); v.removeAttribute('data-src'); });
    requestAnimationFrame(() => checkWide(p));
  }
  function deactivate(p) {
    p.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} });
    p.querySelectorAll('.video iframe').forEach(f => {
      const btn = f._facade;
      if (btn) f.replaceWith(btn);
    });
  }

  // video facades: load the player only when clicked
  stack.addEventListener('click', e => {
    const btn = e.target.closest('.video-frame[data-embed]');
    if (!btn) return;
    const f = document.createElement('iframe');
    f.src = btn.dataset.embed;
    f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
    f.allowFullscreen = true;
    f.title = btn.getAttribute('aria-label') || 'Video';
    f._facade = btn;
    btn.replaceWith(f);
  });

  // map facades: Google loads (and may set cookies) only after the visitor agrees by clicking
  stack.addEventListener('click', e => {
    const btn = e.target.closest('.map-consent[data-map]');
    if (!btn) return;
    const f = document.createElement('iframe');
    f.src = btn.dataset.map;
    f.title = btn.dataset.title || 'Map';
    f.referrerPolicy = 'no-referrer-when-downgrade';
    f.allowFullscreen = true;
    btn.replaceWith(f);
  });

  // ---------- wide content ----------
  // On a computer, an embed that does not fit the page width (a wide table, a
  // widget) stays on the page as a preview fading out to the right, with a button.
  // A click opens it in full on a glass sheet above the book. The content itself
  // is moved, not copied, so forms and widgets keep what was typed. On phones
  // nothing changes: wide content scrolls sideways as before.
  const wideMQ = matchMedia('(min-width: 761px)');
  const WIDE_T = ({
    cs: { open: 'Zobrazit celé', close: 'Zavřít' }, sk: { open: 'Zobraziť celé', close: 'Zavrieť' },
    de: { open: 'Ganz anzeigen', close: 'Schließen' }, en: { open: 'View in full', close: 'Close' },
  })[cfg.lang] || { open: 'View in full', close: 'Close' };
  const EXPAND = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function overflows(box) {
    if (box.scrollWidth > box.clientWidth + 2) return true;
    for (const el of box.querySelectorAll('*')) {
      if (el.tagName === 'IFRAME' || el.closest('.wide-cover')) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible') return true;
    }
    return false;
  }
  function checkWide(p) {
    if (!p) return;
    p.querySelectorAll('.embed').forEach(box => {
      if (box._sheet || box.querySelector(':scope > template')) return;
      const wide = wideMQ.matches && overflows(box);
      box.classList.toggle('is-wide', wide);
      if (wide && !box._cover) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'wide-cover'; b.setAttribute('aria-label', WIDE_T.open);
        b.innerHTML = `<span class="wide-pill">${WIDE_T.open} ${EXPAND}</span>`;
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openWide(box); });
        box._cover = b;
      }
      if (wide && box._cover.parentNode !== box) box.appendChild(box._cover);
      if (!wide && box._cover) box._cover.remove();
    });
  }
  // The sheet grows out of the preview itself and folds back into it on close:
  // it starts exactly over the preview (same place, same size, no padding, no
  // glass), the content reflows wider as it grows, the fade on the right clears,
  // the glass fades in. On close the same path runs backwards into the spot on
  // the page, which has not moved: its scroll position is saved and restored.
  const OPEN_MS = 640, CLOSE_MS = 520, OPEN_EASE = 'cubic-bezier(.22,.9,.24,1)', CLOSE_EASE = 'cubic-bezier(.5,0,.2,1)';
  const rectOf = r => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  function openWide(box) {
    if (document.querySelector('.lightbox')) return;
    const page = box.closest('.page');
    const scroller = page && page.querySelector('.scroll');
    const savedTop = scroller ? scroller.scrollTop : 0;
    const keep = () => { if (scroller && scroller.scrollTop !== savedTop) scroller.scrollTop = savedTop; };
    const cover = box._cover;
    const r0 = box.getBoundingClientRect();
    const kids = [...box.childNodes].filter(n => n !== cover);
    box.style.minHeight = r0.height + 'px';
    box._sheet = true;

    const ov = document.createElement('div');
    ov.className = 'lightbox sheet-ov';
    ov.innerHTML = `<div class="lb-back"></div><div class="sheet" role="dialog" aria-modal="true" tabindex="-1"><div class="sheet-glass" aria-hidden="true"></div><button type="button" class="sheet-x" aria-label="${WIDE_T.close}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button><div class="sheet-body"></div></div>`;
    const sheet = ov.querySelector('.sheet'), back = ov.querySelector('.lb-back'), glass = ov.querySelector('.sheet-glass');
    const bodyEl = ov.querySelector('.sheet-body'), x = ov.querySelector('.sheet-x');
    if (page) sheet.setAttribute('style', page.getAttribute('style') || '');
    bodyEl.append(...kids);
    // lay the sheet out at its final size first, invisibly, to know where it lands
    sheet.style.visibility = 'hidden';
    document.body.appendChild(ov);
    const r1 = sheet.getBoundingClientRect();
    const cs1 = getComputedStyle(sheet);
    const look1 = { padding: cs1.padding, borderRadius: cs1.borderRadius, backgroundColor: cs1.backgroundColor, borderColor: cs1.borderTopColor, boxShadow: cs1.boxShadow, backdropFilter: cs1.backdropFilter || 'none' };
    const look0 = { padding: '0px', borderRadius: '12px', backgroundColor: 'rgba(0,0,0,0)', borderColor: 'rgba(255,255,255,0)', boxShadow: look1.boxShadow.replace(/rgba?\([^)]*\)/g, 'rgba(0,0,0,0)'), backdropFilter: look1.backdropFilter === 'none' ? 'none' : 'blur(0px) saturate(1)' };
    sheet.style.visibility = '';
    keep();

    let anims = [];
    const run = (el, frames, o) => { const a = el.animate(frames, o); anims.push(a); return a; };
    const settle = () => { anims.forEach(a => a.cancel()); anims = []; sheet.classList.remove('is-anim'); Object.assign(sheet.style, { position: '', left: '', top: '', width: '', height: '', padding: '' }); };

    if (reduce) {
      back.style.opacity = 1;
    } else {
      sheet.classList.add('is-anim');
      Object.assign(sheet.style, { position: 'fixed', margin: '0' });
      const o = { duration: OPEN_MS, easing: OPEN_EASE, fill: 'forwards' };
      run(sheet, [{ ...rectOf(r0), ...look0 }, { ...rectOf(r1), ...look1 }], o);
      run(glass, [{ opacity: 0 }, { opacity: 1 }], { ...o, easing: 'ease-out' });
      run(bodyEl, [{ filter: 'blur(6px) saturate(.9)', opacity: .55 }, { filter: 'blur(0px) saturate(1)', opacity: 1 }], { ...o, duration: OPEN_MS * .85 });
      run(back, [{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * .8, easing: 'ease-out', fill: 'forwards' });
      run(x, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(.6)', offset: .55 }, { opacity: 1, transform: 'none' }], o);
      if (cover) run(cover, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
      anims[0].onfinish = () => { settle(); sheet.style.margin = ''; if (cover) cover.remove(); };
    }
    if (reduce && cover) cover.remove();
    sheet.focus({ preventScroll: true });
    keep(); requestAnimationFrame(keep);

    let closing = false;
    function close() {
      if (closing) return; closing = true;
      removeEventListener('keydown', onKey); removeEventListener('popstate', close);
      keep();
      const done = () => {
        box.append(...bodyEl.childNodes);
        ov.remove();
        box.style.minHeight = ''; box._sheet = false;
        checkWide(page);
        if (box._cover) { box._cover.style.opacity = ''; box._cover.focus({ preventScroll: true }); }
        keep(); requestAnimationFrame(keep);
      };
      if (reduce) { done(); return; }
      // freeze where it is now (also mid-opening), then fold back into the page
      const rNow = sheet.getBoundingClientRect();
      const csNow = getComputedStyle(sheet);
      const lookNow = { padding: csNow.padding, borderRadius: csNow.borderRadius, backgroundColor: csNow.backgroundColor, borderColor: csNow.borderTopColor, boxShadow: csNow.boxShadow, backdropFilter: csNow.backdropFilter || 'none' };
      const glassNow = getComputedStyle(glass).opacity, backNow = getComputedStyle(back).opacity;
      const bodyNow = getComputedStyle(bodyEl);
      const focusNow = { filter: bodyNow.filter === 'none' ? 'blur(0px) saturate(1)' : bodyNow.filter, opacity: bodyNow.opacity };
      sheet.scrollTop = 0;
      settle();
      sheet.classList.add('is-anim');
      Object.assign(sheet.style, { position: 'fixed', margin: '0' });
      const rBox = box.getBoundingClientRect();
      const target = { left: rBox.left, top: rBox.top, width: rBox.width, height: rBox.height };
      const o = { duration: CLOSE_MS, easing: CLOSE_EASE, fill: 'forwards' };
      const a = run(sheet, [{ ...rectOf(rNow), ...lookNow }, { ...rectOf(target), ...look0 }], o);
      run(glass, [{ opacity: glassNow }, { opacity: 0 }], { ...o, easing: 'ease-in' });
      run(bodyEl, [focusNow, { filter: 'blur(6px) saturate(.9)', opacity: .55 }], o);
      run(back, [{ opacity: backNow }, { opacity: 0 }], { ...o, easing: 'ease-in' });
      run(x, [{ opacity: 1 }, { opacity: 0, offset: .3 }, { opacity: 0 }], o);
      a.onfinish = done;
    }
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    ov.addEventListener('click', e => { if (e.target === ov || e.target === back || e.target.closest('.sheet-x')) close(); });
    addEventListener('keydown', onKey);
    addEventListener('popstate', close);
  }
  let wideTimer = null;
  const recheck = () => { clearTimeout(wideTimer); wideTimer = setTimeout(() => checkWide(pages[frontIdx]), 120); };
  addEventListener('resize', recheck);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(recheck);

  // ---------- state ----------
  let cur = Math.max(0, pages.findIndex(p => p.classList.contains('is-front')));
  const tilt = { x: 0, v: 0, t: 0 };
  const focus = { x: cur, v: 0, t: cur };
  let nav = null, scrub = null, running = false, last = 0, frontIdx = -1;

  const spring = (s, k, c, dt) => { const a = k * (s.t - s.x) - c * s.v; s.v += a * dt; s.x += s.v * dt; };

  function setMark(j) { marks.forEach((m, i) => i === j ? m.setAttribute('aria-current', 'page') : m.removeAttribute('aria-current')); }

  function pushUrl(j) {
    const sub = pendingSub && pendingSub.j === j ? pendingSub.sub : '';
    try { history.pushState({ id: pages[j].dataset.id, sub }, '', sub ? subUrlOf(j, sub) : urlOf(pages[j].dataset.id)); } catch (e) {}
  }

  // ---------- subpages ----------
  // Subpages are sections of their main page's sheet. One menu after the main
  // content sticks to the top of the sheet; it highlights the section being read
  // and the address follows quietly, so every subpage has its own link.
  let pendingSub = null;           // { j, sub } to scroll to once a turn has finished
  let spySilent = 0;               // while > now, the spy does not touch history (programmatic scroll)
  let curSub = body.dataset.sub || '';
  const scrollerOf = p => phone.matches ? null : p.querySelector('.scroll');
  // On phones, positions come from the page layout (offsetTop), not from
  // getBoundingClientRect: inside the 3D stack Safari reports the latter wrongly,
  // which made the menu bar show up long before the menu reached the top.
  function docTop(el) { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; return y; }
  const phoneStick = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mh')) || 52) - 7;
  function navStaticTop(nav) {
    const prev = nav.previousElementSibling, cs = getComputedStyle(nav);
    const gap = parseFloat(getComputedStyle(nav.parentElement).rowGap) || 0, mt = parseFloat(cs.marginTop) || 0;
    return prev ? docTop(prev) + prev.offsetHeight + gap + mt : docTop(nav.parentElement) + mt;
  }
  function subTarget(p, sid) {
    const nav = p.querySelector('.subnav');
    if (!sid || !nav) return 0;
    const sec = p.querySelector('#s-' + sid);
    if (!sec) return 0;
    if (phone.matches) return Math.max(0, docTop(sec) - (phoneStick() + nav.offsetHeight + 46));
    const stick = parseFloat(getComputedStyle(nav).top) || 0;
    const gap = stick + nav.offsetHeight + 46; // the text has come back from the fade by here
    const sc = p.querySelector('.scroll');
    return Math.max(0, sec.offsetTop - gap - (parseFloat(getComputedStyle(sc).paddingTop) || 0));
  }
  // the reader's own scrolling always wins over a correction
  let touchedAt = 0;
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(t => addEventListener(t, () => { touchedAt = performance.now(); }, { passive: true, capture: true }));
  let fixTimer = null, goal = null;
  function scrollToSub(j, sid, smooth, tries = 2) {
    goal = { j, sid };
    const p = pages[j], top = subTarget(p, sid), sc = scrollerOf(p);
    const behavior = smooth && !reduce ? 'smooth' : 'instant';
    const t0 = performance.now();
    spySilent = t0 + (behavior === 'smooth' ? 900 : 60);
    if (sc) sc.scrollTo({ top, behavior }); else window.scrollTo({ top, behavior });
    setSub(j, sid);
    // content above may still grow (images, fonts, a sheet that just turned in):
    // once the glide is over, measure again and settle on the section
    clearTimeout(fixTimer);
    if (tries > 0) fixTimer = setTimeout(() => {
      if (touchedAt > t0 + 50 || !goal || goal.sid !== sid || cur !== j || nav) return;
      const now = sc ? sc.scrollTop : window.scrollY, want = subTarget(p, sid);
      const max = sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - innerHeight;
      if (Math.abs(now - Math.min(want, max)) > 3) scrollToSub(j, sid, smooth, tries - 1);
      else { goal = null; queueSpy(); }
    }, behavior === 'smooth' ? 850 : 120);
  }
  function setSub(j, sid, { history: h = false, force = false } = {}) {
    const p = pages[j];
    [...p.querySelectorAll('.subnav-a'), ...(subbarFor === j ? subbar.querySelectorAll('.subnav-a') : [])].forEach(a => {
      const on = a.dataset.sub === sid;
      a.classList.toggle('is-active', on);
      if (on) { a.setAttribute('aria-current', 'location'); const row = a.parentElement; if (row.scrollWidth > row.clientWidth) row.scrollTo({ left: a.offsetLeft - 24, behavior: reduce ? 'instant' : 'smooth' }); }
      else a.removeAttribute('aria-current');
    });
    if (sid === curSub && !h || force) return;
    curSub = sid;
    const pg = cfg.pages[j], s = subOf(j, sid);
    document.title = s ? `${s.title} · ${pg.title} · ${cfg.siteName}` : pg.id === cfg.home ? cfg.siteName : `${pg.title} · ${cfg.siteName}`;
    const alt = (s && s.alt) || pg.alt;
    if (alt) langLinks.forEach(a => { const to = alt[a.dataset.lang]; if (to !== undefined) a.href = new URL(to, root).href; });
    if (h) try { history.replaceState({ id: pg.id, sub: sid }, '', subUrlOf(j, sid)); } catch (e) {}
  }
  let spyQueued = false;
  function hideSubbar() { body.classList.remove('has-subbar'); }
  function spy() {
    spyQueued = false;
    try { spyNow(); } catch (e) { hideSubbar(); }
  }
  function spyNow() {
    if (nav || frontIdx < 0) { hideSubbar(); return; }
    const p = pages[frontIdx], navEl = p.querySelector('.subnav:not(.subnav-float)');
    if (!navEl) { hideSubbar(); return; }
    const stuck = isStuck(navEl);
    navEl.classList.toggle('is-stuck', stuck);
    if (stuck !== p.classList.contains('is-stuck') || (phone.matches && stuck !== body.classList.contains('has-subbar'))) showStuck(frontIdx, stuck);
    // a section is being read once the page is scrolled to (or past) the spot
    // a click in the menu would bring it to; before the first one, it is the main page
    const sc0 = scrollerOf(p), y = sc0 ? sc0.scrollTop : window.scrollY;
    let sid = '';
    p.querySelectorAll('.sub').forEach(sec => { if (subTarget(p, sec.dataset.sub) <= y + 6) sid = sec.dataset.sub; });
    // reaching the very end counts as the last section, even if it is short
    const sc = scrollerOf(p);
    const atEnd = sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 : window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    const secs = p.querySelectorAll('.sub');
    if (atEnd && secs.length && secs[secs.length - 1].getBoundingClientRect().top < innerHeight * .8) sid = secs[secs.length - 1].dataset.sub;
    if (goal && performance.now() < spySilent + 900) sid = goal.sid;
    if (sid !== curSub) setSub(frontIdx, sid, { history: performance.now() > spySilent });
  }
  const queueSpy = () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } };
  pages.forEach((p, j) => {
    if (!p.querySelector('.subnav')) return;
    p.querySelector('.scroll').addEventListener('scroll', queueSpy, { passive: true });
    // absolute links: the address changes while reading, relative ones would break
    p.querySelectorAll('.subnav-a').forEach(a => { a.href = a.dataset.sub ? subUrlOf(j, a.dataset.sub) : urlOf(p.dataset.id); });
  });
  // the floating copy of each menu (computer) and the phone's bar under the tabs
  const subbar = document.createElement('div');
  subbar.className = 'subbar'; subbar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(subbar);
  pages.forEach(p => {
    const nav = p.querySelector('.subnav');
    if (!nav) return;
    p.classList.add('has-subnav');
    const fl = nav.cloneNode(true);
    fl.classList.add('subnav-float'); fl.setAttribute('aria-hidden', 'true');
    fl.querySelectorAll('a').forEach(a => a.tabIndex = -1);
    p.appendChild(fl);
  });
  let subbarFor = -1;
  function showStuck(j, stuck) {
    const p = pages[j];
    p.classList.toggle('is-stuck', stuck);
    const fl = p.querySelector('.subnav-float');
    if (fl && stuck) p.style.setProperty('--float-h', fl.offsetHeight ? fl.offsetHeight + 'px' : '64px');
    if (phone.matches) {
      if (stuck && subbarFor !== j) { subbar.replaceChildren(p.querySelector('.subnav-in').cloneNode(true)); subbar.setAttribute('style', p.getAttribute('style') || ''); subbarFor = j; setSub(j, curSub, { force: true }); }
      body.classList.toggle('has-subbar', stuck && j === frontIdx);
    }
  }
  subbar.addEventListener('click', e => {
    const a = e.target.closest('a.subnav-a');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    goSub(frontIdx, a.dataset.sub);
  });
  function isStuck(navEl) {
    if (phone.matches) return window.scrollY > 0 && window.scrollY + phoneStick() >= navStaticTop(navEl) - 1;
    const sc = scrollerOf(navEl.closest('.page'));
    const st = getComputedStyle(navEl);
    const want = (parseFloat(st.top) || 0) + (sc ? sc.getBoundingClientRect().top + (parseFloat(getComputedStyle(sc).paddingTop) || 0) : 0);
    return navEl.getBoundingClientRect().top <= want + 1 && (sc ? sc.scrollTop > 0 : window.scrollY > 0);
  }
  addEventListener('scroll', queueSpy, { passive: true });
  // a page turned by tabs or swipe starts without a subpage selected
  function afterTurn(j) {
    if (pendingSub && pendingSub.j === j) { const s = pendingSub.sub; pendingSub = null; if (phone.matches) scrollToSub(j, s, true); else setSub(j, s); }
    else { curSub = ''; queueSpy(); }
  }

  // On phones the document scrolls. Before a turn, the page glides back to its top,
  // so the turn always happens where the reader can see it.
  const phone = matchMedia('(max-width: 760px)');
  const toTop = () => { if (phone.matches && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' }); };
  let glide = null;
  function glideToTopThen(fn) {
    const y0 = window.scrollY;
    if (!phone.matches || y0 <= 1 || reduce) { toTop(); fn(); return; }
    if (glide) { glide.fn = fn; return; }            // already gliding: just change where we go after
    const dur = Math.min(800, 320 + y0 * 0.2), t0 = performance.now();
    glide = { fn };
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      window.scrollTo(0, Math.round(y0 * (1 - e)));
      if (t < 1) requestAnimationFrame(step);
      else { const f = glide.fn; glide = null; f(); }
    };
    requestAnimationFrame(step);
  }

  function goSub(j, sid, push = true) {
    j = Math.max(0, Math.min(N - 1, j));
    if (j === cur && !nav) {
      if (push && sid !== curSub) try { history.pushState({ id: pages[j].dataset.id, sub: sid }, '', subUrlOf(j, sid)); } catch (e) {}
      scrollToSub(j, sid, true);
      return;
    }
    pendingSub = { j, sub: sid };
    if (!phone.matches) { const sc = scrollerOf(pages[j]); if (sc) sc.scrollTop = subTarget(pages[j], sid); }
    go(j, push);
  }
  function go(j, push = true) {
    j = Math.max(0, Math.min(N - 1, j));
    if (!pendingSub || pendingSub.j !== j) pendingSub = null;
    if (phone.matches && window.scrollY > 1 && (j !== cur || nav)) {
      setMark(j);                                    // the tab answers at once, the turn follows the glide
      glideToTopThen(() => turnTo(j, push));
      return;
    }
    turnTo(j, push);
  }

  function turnTo(j, push) {
    if (j !== cur || nav) { toTop(); hideSubbar(); }
    if (!nav && j === cur && Math.abs(focus.x - j) < .01) return;
    if (nav && nav.to === j) return;
    nav = { to: j, lifted: reduce || ANGLE === 0 || tilt.x > .55 || !!(nav && nav.lifted) };
    if (push) pushUrl(j);
    setMark(j);
    kick();
  }

  function peek(i) {
    if (nav || scrub || reduce || ANGLE === 0) return;
    if (i === null || i === cur) { tilt.t = 0; focus.t = cur; }
    else { tilt.t = .1; focus.t = cur + Math.sign(i - cur) * .07; }
    kick();
  }

  function kick() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } }

  function loop(ts) {
    const dt = Math.min(.034, (ts - last) / 1000); last = ts;
    const flat = reduce || ANGLE === 0;
    if (nav) {
      if (!nav.lifted) { tilt.t = 1; if (tilt.x > .55) nav.lifted = true; }
      if (nav.lifted) {
        focus.t = nav.to;
        tilt.t = flat ? 0 : 1;
        if (Math.abs(focus.x - nav.to) < .04 && Math.abs(focus.v) < .5) { cur = nav.to; nav = null; tilt.t = 0; afterTurn(cur); }
      }
    }
    if (!scrub) {
      const h = dt / 2;
      for (let n = 0; n < 2; n++) {
        if (reduce) { spring(focus, 260, 34, h); spring(tilt, 260, 34, h); }
        else { spring(tilt, K_TILT, C_TILT, h); spring(focus, K_FOC, C_FOC, h); }
      }
    }
    render();
    const settled = !nav && !scrub &&
      Math.abs(tilt.x - tilt.t) < .0008 && Math.abs(tilt.v) < .01 &&
      Math.abs(focus.x - focus.t) < .0008 && Math.abs(focus.v) < .01;
    if (settled) { tilt.x = tilt.t; focus.x = focus.t; tilt.v = focus.v = 0; render(); running = false; return; }
    requestAnimationFrame(loop);
  }

  const fallBack = 1 / DEPTH;
  function render() {
    const tr = tilt.x, t = Math.max(0, Math.min(1, tr)), f = focus.x;
    const a = ANGLE * tr;
    stack.style.transform = `translate3d(${-7 * tr * ANGLE / 30}%,0,0) rotateY(${-a}deg) rotateX(${4 * tr * ANGLE / 30}deg) scale(${1 - .2 * t})`;
    for (let k = 0; k < N; k++) {
      const p = pages[k], d = k - f;
      const w = Math.max(0, 1 - Math.abs(d));
      const fall = d >= 0 ? Math.max(0, 1 - d * fallBack) : Math.max(0, 1 + d * 1.3);
      const op = w * (1 - .45 * t) + (1 - w) * t * .6 * fall;
      p.style.opacity = op.toFixed(3);
      const vis = op >= .004;
      p.style.visibility = vis ? 'visible' : 'hidden';
      if (vis) hydrate(p);
      p.style.transform = `translate3d(${d * 46 * t}px,0,${-d * 200 * t}px)`;
    }
    const front = Math.max(0, Math.min(N - 1, Math.round(f)));
    if (front !== frontIdx) {
      const prev = pages[frontIdx];
      frontIdx = front;
      hideSubbar();
      pages.forEach((p, k) => { p.inert = k !== front; p.classList.toggle('is-front', k === front); p.setAttribute('aria-hidden', String(k !== front)); });
      if (prev) deactivate(prev);
      activate(pages[front]);
      const pg = cfg.pages[front];
      document.title = pg.id === cfg.home ? cfg.siteName : `${pg.title} · ${cfg.siteName}`;
      if (cfg.bg.follow) setFieldTarget(front);
      // language switcher follows the page in front
      if (pg.alt) langLinks.forEach(a => { const to = pg.alt[a.dataset.lang]; if (to !== undefined) a.href = new URL(to, root).href; });
    }
  }

  // ---------- languages ----------
  langLinks.forEach(a => a.addEventListener('click', () => { try { localStorage.setItem('uw-lang', a.dataset.lang); } catch (e) {} }));

  // ---------- input ----------
  marks.forEach((m, i) => {
    m.addEventListener('click', e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(i); });
    // Hover peek only for a real mouse. On phones a tap also fires mouseenter, and
    // because peek moves the stack, iOS treated the first tap as a hover and
    // swallowed the click, so the tab needed a second tap.
    if (canHover) {
      m.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') peek(i); });
      m.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') peek(null); });
    }
  });
  // internal links between pages turn the page too
  stack.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith(proot.pathname)) return;
    const r = routeOf(u.pathname);
    const j = r.id ? idx(r.id) : -1;
    if (j < 0 || u.hash) return;
    e.preventDefault();
    if (r.sub || a.classList.contains('subnav-a') || (j === cur && !nav && curSub)) goSub(j, r.sub);
    else go(j);
  });

  const stage = document.getElementById('stage');
  const W = () => stack.getBoundingClientRect().width || innerWidth;
  function scrubStart() { toTop(); scrub = { f0: focus.x, dx: 0 }; nav = null; kick(); }
  // Sideways turning only reacts to a clear, deliberate movement:
  // the first 24 px do nothing, and a turn needs a long drag or a quick flick.
  const DEAD = 24;
  function scrubMove(dx) {
    scrub.dx = dx;
    const eff = Math.sign(dx) * Math.max(0, Math.abs(dx) - DEAD);
    focus.x = Math.max(-.35, Math.min(N - .65, scrub.f0 - eff / (W() * .7))); focus.v = 0;
    tilt.x = reduce || ANGLE === 0 ? 0 : Math.min(1, Math.abs(eff) / 160); tilt.v = 0;
  }
  function scrubEnd(vel = 0) {
    if (!scrub) return;
    const far = Math.abs(scrub.dx) > Math.max(100, W() * .3);
    const flick = Math.abs(vel) > 1.2 && Math.abs(scrub.dx) > 90;
    let target = Math.round(scrub.f0) + (far || flick ? (scrub.dx < 0 ? 1 : -1) : 0);
    target = Math.max(0, Math.min(N - 1, target));
    scrub = null;
    if (target === cur) { focus.t = cur; tilt.t = 0; kick(); }
    else { nav = { to: target, lifted: true }; pushUrl(target); setMark(target); kick(); }
  }

  let pt = null;
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.gallery-row, iframe, video, input, textarea')) return;
    pt = { id: e.pointerId, x: e.clientX, y: e.clientY, lock: null, lx: e.clientX, lt: e.timeStamp, v: 0, dx: 0, dy: 0 };
  });
  stage.addEventListener('pointermove', e => {
    if (!pt || e.pointerId !== pt.id) return;
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    pt.dx = dx; pt.dy = dy;
    if (!pt.lock && Math.hypot(dx, dy) > 14) {
      // only a clearly horizontal start (within about 24° of level) counts as turning;
      // anything else is scrolling for the rest of the gesture
      pt.lock = Math.abs(dx) > Math.abs(dy) * 2.2 ? 'x' : 'y';
      if (pt.lock === 'x' && phone.matches && window.scrollY > 40) pt.lock = 'swipe';
      if (pt.lock === 'x') scrubStart();
    }
    if (pt.lock === 'swipe') return;
    if (pt.lock === 'x') {
      const dtm = Math.max(1, e.timeStamp - pt.lt);
      pt.v = (e.clientX - pt.lx) / dtm; pt.lx = e.clientX; pt.lt = e.timeStamp;
      scrubMove(dx);
    }
  });
  const endPt = e => {
    if (!pt || e.pointerId !== pt.id) return;
    if (pt.lock === 'x') scrubEnd(-pt.v * 1.6);
    if (pt.lock === 'swipe' && Math.abs(pt.dx) > 110 && Math.abs(pt.dx) > Math.abs(pt.dy) * 2.2) go((nav ? nav.to : cur) + (pt.dx < 0 ? 1 : -1));
    pt = null;
  };
  stage.addEventListener('pointerup', endPt);
  stage.addEventListener('pointercancel', endPt);

  // Trackpad: a sideways swipe must be clearly horizontal and travel a little before the page reacts.
  let wheelAcc = 0, wheelTimer = null, wheelHint = 0, hintTimer = null;
  stage.addEventListener('wheel', e => {
    if (!scrub) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 2.5 || Math.abs(e.deltaX) < 1) { wheelHint = 0; return; }
      if (e.target.closest('.gallery-row')) return;
      wheelHint += e.deltaX;
      clearTimeout(hintTimer); hintTimer = setTimeout(() => { wheelHint = 0; }, 200);
      if (Math.abs(wheelHint) < 40) return;
    }
    e.preventDefault();
    if (!scrub) { scrubStart(); wheelAcc = -wheelHint; wheelHint = 0; }
    wheelAcc -= e.deltaX;
    scrubMove(wheelAcc);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => scrubEnd(0), 160);
  }, { passive: false });

  addEventListener('keydown', e => {
    if (document.querySelector('.lightbox')) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable],iframe')) return;
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const at = nav ? nav.to : cur;
    if (e.key === 'ArrowRight') { go(at + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { go(at - 1); e.preventDefault(); }
  });
  addEventListener('popstate', () => {
    const r = routeOf(location.pathname), j = r.id ? idx(r.id) : idx(cfg.home);
    if (r.sub || (j === cur && !nav)) goSub(j, r.sub, false); else go(j, false);
  });

  // phones: tabs on top wrap into rows; the page starts below them
  const footEl = document.getElementById('site-foot');
  const setMh = () => {
    document.documentElement.style.setProperty('--mh', marksEl.offsetHeight + 'px');
    if (footEl) document.documentElement.style.setProperty('--fh', footEl.offsetHeight + 'px');
  };
  setMh();
  try { const ro = new ResizeObserver(setMh); ro.observe(marksEl); if (footEl) ro.observe(footEl); } catch (e) { addEventListener('resize', setMh); }

  // ---------- background: a tiny canvas, scaled up ----------
  // Each page has a target: a base colour and four soft light blobs. The background
  // drifts on its own and glides between targets as pages turn.
  const cv = document.getElementById('field'), ctx = cv.getContext('2d', { willReadFrequently: true });
  cv.width = 96; cv.height = 60;
  const clone = f => ({ base: f.base.slice(), blobs: f.blobs.map(b => b.slice()), drift: f.drift });
  const field = clone(cfg.pages[cur].field);
  let fieldTarget = clone(cfg.pages[cur].field);
  function setFieldTarget(i) { fieldTarget = clone(cfg.pages[i].field); }
  const blobs = [
    { ax: .30, ay: .35, fx: .021, fy: .017, r: .55, a: .55, dir: 1 },
    { ax: .72, ay: .62, fx: .015, fy: .023, r: .6, a: .45, dir: -1 },
    { ax: .55, ay: .20, fx: .019, fy: .012, r: .45, a: .35, dir: 1 },
    { ax: .18, ay: .80, fx: .011, fy: .019, r: .5, a: .3, dir: -1 },
  ];
  const mode = cfg.bg.mode;
  const animate = mode === 'drift' && !reduce;
  let fLast = 0, frame = 0; const t0 = performance.now();
  const hueStep = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };
  function blend(k) {
    let moving = 0;
    const mix = (c, t) => {
      const h = hueStep(c[0], t[0], k);
      moving += Math.abs(((t[0] - c[0] + 540) % 360) - 180) + Math.abs(t[1] - c[1]) + Math.abs(t[2] - c[2]);
      c[0] = h; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k;
    };
    mix(field.base, fieldTarget.base);
    field.blobs.forEach((b, i) => mix(b, fieldTarget.blobs[i]));
    field.drift += (fieldTarget.drift - field.drift) * k;
    return moving > .5;
  }
  // The page colour (seen during overscroll and while phone toolbars move) follows the background.
  const rootStyle = document.documentElement.style;
  function rowColor(y) {
    const d = ctx.getImageData(0, y, cv.width, 1).data;
    let r = 0, g = 0, b = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return [r / n, g / n, b / n];
  }
  function paintEdges() {
    try {
      const off = Math.round(cv.height * 12 / 124);   // the canvas overhangs the screen by 12vh at each end
      const top = rowColor(off + 1), bottom = rowColor(cv.height - off - 2);
      rootStyle.backgroundColor = `rgb(${top.map((v, i) => Math.round((v + bottom[i]) / 2)).join(',')})`;
    } catch (e) {}
  }
  let changing = true;
  function draw(ts) {
    const dt = Math.min(.2, (ts - fLast) / 1000 || .03); fLast = ts;
    changing = blend(Math.min(1, dt * 1.1));
    const s = animate ? (ts - t0) / 1000 * cfg.bg.speed : 0;
    const drift = animate ? Math.sin(s / 40) * field.drift : 0;
    const Wc = cv.width, Hc = cv.height, B = field.base;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `hsl(${B[0]},${B[1]}%,${B[2]}%)`;
    ctx.fillRect(0, 0, Wc, Hc);
    if (mode !== 'solid') {
      ctx.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        const c = field.blobs[i];
        const x = (b.ax + Math.sin(s * b.fx * 6.28 + i) * .18) * Wc;
        const y = (b.ay + Math.cos(s * b.fy * 6.28 + i * 2) * .16) * Hc;
        const r = b.r * Wc * (1 + Math.sin(s * .07 + i) * .12);
        const h = (c[0] + drift * b.dir + 360) % 360;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${h},${c[1]}%,${c[2]}%,${b.a})`);
        g.addColorStop(1, `hsla(${h},${c[1]}%,${Math.max(0, c[2] - 12)}%,0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, Wc, Hc);
      });
    }
    if (frame++ % 6 === 0) paintEdges();
  }
  let fieldPrev = 0;
  function fieldLoop(ts) {
    if (document.hidden) { requestAnimationFrame(fieldLoop); return; }
    // while a page turns, the background redraws less often so the turn keeps every frame
    if (animate) { if (ts - fieldPrev >= (running ? 80 : 33)) { fieldPrev = ts; draw(ts); } }
    else if (changing) draw(ts);
    requestAnimationFrame(fieldLoop);
  }
  draw(performance.now());
  requestAnimationFrame(fieldLoop);

  // the year in footers stays current even if the site was built last year
  const year = String(new Date().getFullYear());
  document.querySelectorAll('.uw-year').forEach(el => { el.textContent = year; });

  // ---------- photo zoom (galleries) ----------
  // A tapped photo grows from exactly where it sits to the middle of the screen,
  // and shrinks back to the same place when closed.
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  function bigSource(img) {
    const pic = img.closest('picture');
    const cur = img.currentSrc || img.src;
    const ext = (cur.match(/\.(avif|webp|jpe?g|png)(\?|$)/i) || [])[1];
    let best = null;
    if (pic) for (const src of pic.querySelectorAll('source')) {
      for (const part of (src.getAttribute('srcset') || '').split(',')) {
        const [u, w] = part.trim().split(/\s+/);
        if (!u || (ext && !u.toLowerCase().endsWith('.' + ext.toLowerCase()))) continue;
        const width = parseInt(w, 10) || 0;
        if (!best || width > best.w) best = { u: abs(u), w: width };
      }
    }
    return best ? best.u : cur;
  }
  function openZoom(tile) {
    const img = tile.querySelector('img');
    if (!img || !img.complete || document.querySelector('.lightbox')) return;
    const r0 = img.getBoundingClientRect();
    const ratio = (img.naturalWidth || r0.width) / (img.naturalHeight || r0.height);
    const vw = innerWidth, vh = window.visualViewport ? visualViewport.height : innerHeight;
    let w = Math.min(vw * .92, 1400), h = w / ratio;
    if (h > vh * .82) { h = vh * .82; w = h * ratio; }
    const cap = tile.querySelector('figcaption');
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = '<div class="lb-back"></div><div class="lb-frame"><img alt=""></div>' + (cap ? '<p class="lb-cap"></p>' : '');
    const frame = box.querySelector('.lb-frame'), big = frame.querySelector('img'), back = box.querySelector('.lb-back');
    big.src = img.currentSrc || img.src; big.alt = img.alt || '';
    if (cap) { const c = box.querySelector('.lb-cap'); c.textContent = cap.textContent; c.style.top = ((vh + h) / 2 + 12) + 'px'; }
    const radius = getComputedStyle(img).borderRadius;
    const from = { left: r0.left + 'px', top: r0.top + 'px', width: r0.width + 'px', height: r0.height + 'px', borderRadius: radius };
    const to = { left: (vw - w) / 2 + 'px', top: (vh - h) / 2 + 'px', width: w + 'px', height: h + 'px', borderRadius: '12px' };
    Object.assign(frame.style, to);
    document.body.appendChild(box);
    img.style.visibility = 'hidden';
    const dur = reduce ? 0 : 460;
    frame.animate([from, to], { duration: dur, easing: EASE });
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: 'ease-out' });
    // swap in the largest version once it has loaded
    const hi = bigSource(img);
    if (hi && hi !== big.src) { const pre = new Image(); pre.src = hi; (pre.decode ? pre.decode() : Promise.resolve()).then(() => { big.src = hi; }).catch(() => {}); }
    let closing = false;
    function close() {
      if (closing) return; closing = true;
      const r1 = img.getBoundingClientRect();
      const back0 = { left: r1.left + 'px', top: r1.top + 'px', width: r1.width + 'px', height: r1.height + 'px', borderRadius: radius };
      const d = reduce ? 0 : 380;
      const cs = box.querySelector('.lb-cap'); if (cs) cs.remove();
      back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d, easing: 'ease-in', fill: 'forwards' });
      const a = frame.animate([to, back0], { duration: d, easing: EASE, fill: 'forwards' });
      const done = () => { img.style.visibility = ''; box.remove(); removeEventListener('keydown', onKey); removeEventListener('scroll', close); };
      a.onfinish = done; if (!d) done();
    }
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } };
    box.addEventListener('click', close);
    addEventListener('keydown', onKey);
    addEventListener('scroll', close, { passive: true });
  }
  stack.addEventListener('click', e => {
    const tile = e.target.closest('.gallery .tile');
    if (!tile || tile.querySelector('a')) return;
    e.preventDefault();
    openZoom(tile);
  });
  stack.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.gallery .tile')) { e.preventDefault(); openZoom(e.target); }
  });
  stack.querySelectorAll('.gallery .tile').forEach(t => {
    if (t.querySelector('a')) return;
    t.tabIndex = 0; t.setAttribute('role', 'button'); t.setAttribute('aria-label', 'Zvětšit fotku');
  });

  // ---------- forms ----------
  // Sent with fetch as a simple form post (no custom headers, so no CORS preflight)
  // to the platform's Apps Script, which answers with JSON.
  const loadedAt = Date.now();
  stack.querySelectorAll('form.uw-form').forEach(f => { f.elements.t.value = String(loadedAt); });
  stack.addEventListener('submit', async e => {
    const f = e.target.closest('form.uw-form');
    if (!f) return;
    e.preventDefault();
    if (f.classList.contains('is-busy')) return;
    if (!f.checkValidity()) { f.classList.add('was-checked'); f.reportValidity(); return; }
    const status = f.querySelector('.f-status'), btn = f.querySelector('button[type="submit"]');
    const say = (text, kind) => { status.textContent = text; status.dataset.kind = kind || ''; };
    if (!f.dataset.endpoint) { say(f.dataset.err, 'err'); return; }
    const data = new URLSearchParams(new FormData(f));
    data.set('page', location.href);
    f.classList.add('is-busy'); btn.disabled = true; say(f.dataset.sending);
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(f.dataset.endpoint, { method: 'POST', body: data, signal: ctrl.signal });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.message || 'failed');
      f.classList.add('is-sent');
      say(f.dataset.ok, 'ok');
    } catch (err) {
      say(f.dataset.err, 'err');
    } finally {
      clearTimeout(timer); f.classList.remove('is-busy'); btn.disabled = false;
    }
  });

  // ---------- start ----------
  try { history.replaceState({ id: pages[cur].dataset.id, sub: curSub }, ''); } catch (e) {}
  setMark(cur);
  render();
  // opened at a subpage's address: start at that section
  if (curSub) {
    const s0 = curSub; curSub = '';
    const jump = () => scrollToSub(cur, s0, false);
    jump(); requestAnimationFrame(jump);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (curSub === s0) jump(); });
  }
})();
