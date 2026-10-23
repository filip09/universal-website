/* Universal Website — page-turning engine. No dependencies. */
(() => {
  'use strict';
  const cfg = JSON.parse(document.getElementById('uw-config').textContent);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const body = document.body;
  const root = new URL(body.dataset.root || './', location.href);
  const stack = document.getElementById('stack');
  const pages = [...stack.querySelectorAll('.page')];
  const N = pages.length;
  const marksEl = document.getElementById('marks');
  const marks = [...marksEl.querySelectorAll('.mark')];
  const idx = id => pages.findIndex(p => p.dataset.id === id);
  if (!N) return;

  // ---------- tuning from the styles tab ----------
  const SPEED = { slow: .62, normal: 1, quick: 1.5 }[cfg.turn.speed] || 1;
  const ANGLE = cfg.turn.angle;
  const DEPTH = Math.max(1, cfg.turn.depth);
  const K_TILT = 150 * SPEED, C_TILT = 19 * Math.sqrt(SPEED);
  const K_FOC = 75 * SPEED, C_FOC = 16 * Math.sqrt(SPEED);

  // ---------- urls ----------
  const urlOf = id => new URL(id === cfg.home ? '' : id + '/', root).href;
  function idFromLocation() {
    const rel = decodeURIComponent(location.pathname.slice(root.pathname.length)).replace(/\/(index\.html)?$/, '');
    if (!rel) return cfg.home;
    return idx(rel) >= 0 ? rel : null;
  }

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
  }
  pages.forEach(p => {
    if (!p.classList.contains('is-front')) return;
    hydrated.add(p);
    p.querySelectorAll('[srcset]').forEach(el => { el.srcset = absSet(el.getAttribute('srcset')); });
    p.querySelectorAll('img[src]').forEach(el => { el.src = abs(el.getAttribute('src')); });
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

  // ---------- state ----------
  let cur = Math.max(0, pages.findIndex(p => p.classList.contains('is-front')));
  const tilt = { x: 0, v: 0, t: 0 };
  const focus = { x: cur, v: 0, t: cur };
  let nav = null, scrub = null, running = false, last = 0, frontIdx = -1;

  const spring = (s, k, c, dt) => { const a = k * (s.t - s.x) - c * s.v; s.v += a * dt; s.x += s.v * dt; };

  function setMark(j) { marks.forEach((m, i) => i === j ? m.setAttribute('aria-current', 'page') : m.removeAttribute('aria-current')); }

  function pushUrl(j) {
    try { history.pushState({ id: pages[j].dataset.id }, '', urlOf(pages[j].dataset.id)); } catch (e) {}
  }

  function go(j, push = true) {
    j = Math.max(0, Math.min(N - 1, j));
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
        if (Math.abs(focus.x - nav.to) < .04 && Math.abs(focus.v) < .5) { cur = nav.to; nav = null; tilt.t = 0; }
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
      pages.forEach((p, k) => { p.inert = k !== front; p.classList.toggle('is-front', k === front); p.setAttribute('aria-hidden', String(k !== front)); });
      if (prev) deactivate(prev);
      activate(pages[front]);
      const pg = cfg.pages[front];
      document.title = pg.id === cfg.home ? cfg.siteName : `${pg.title} · ${cfg.siteName}`;
      if (cfg.bg.follow) field.targetHue = pg.hue;
    }
  }

  // ---------- input ----------
  marks.forEach((m, i) => {
    m.addEventListener('click', e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(i); });
    m.addEventListener('mouseenter', () => peek(i));
    m.addEventListener('mouseleave', () => peek(null));
  });
  // internal links between pages turn the page too
  stack.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith(root.pathname)) return;
    const rel = u.pathname.slice(root.pathname.length).replace(/\/(index\.html)?$/, '');
    const j = rel ? idx(rel) : idx(cfg.home);
    if (j >= 0 && !u.hash) { e.preventDefault(); go(j); }
  });

  const stage = document.getElementById('stage');
  const W = () => stack.getBoundingClientRect().width || innerWidth;
  function scrubStart() { scrub = { f0: focus.x, dx: 0 }; nav = null; kick(); }
  function scrubMove(dx) {
    scrub.dx = dx;
    focus.x = Math.max(-.35, Math.min(N - .65, scrub.f0 - dx / (W() * .55))); focus.v = 0;
    tilt.x = reduce || ANGLE === 0 ? 0 : Math.min(1, Math.abs(dx) / 140); tilt.v = 0;
  }
  function scrubEnd(vel = 0) {
    if (!scrub) return;
    let target = Math.round(focus.x - vel * .25);
    if (Math.abs(scrub.dx) > 40 && target === Math.round(scrub.f0)) target += scrub.dx < 0 ? 1 : -1;
    target = Math.max(0, Math.min(N - 1, target));
    scrub = null;
    if (target === cur) { focus.t = cur; tilt.t = 0; kick(); }
    else { nav = { to: target, lifted: true }; pushUrl(target); setMark(target); kick(); }
  }

  let pt = null;
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest('.gallery-row, iframe, video, input, textarea')) return;
    pt = { id: e.pointerId, x: e.clientX, y: e.clientY, lock: null, lx: e.clientX, lt: e.timeStamp, v: 0 };
  });
  stage.addEventListener('pointermove', e => {
    if (!pt || e.pointerId !== pt.id) return;
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    if (!pt.lock && Math.hypot(dx, dy) > 10) { pt.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'; if (pt.lock === 'x') scrubStart(); }
    if (pt.lock === 'x') {
      const dtm = Math.max(1, e.timeStamp - pt.lt);
      pt.v = (e.clientX - pt.lx) / dtm; pt.lx = e.clientX; pt.lt = e.timeStamp;
      scrubMove(dx);
    }
  });
  const endPt = e => { if (pt && e.pointerId === pt.id) { if (pt.lock === 'x') scrubEnd(-pt.v * 1.6); pt = null; } };
  stage.addEventListener('pointerup', endPt);
  stage.addEventListener('pointercancel', endPt);

  let wheelAcc = 0, wheelTimer = null;
  stage.addEventListener('wheel', e => {
    if (!scrub && (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5 || Math.abs(e.deltaX) < 1)) return;
    if (!scrub && e.target.closest('.gallery-row')) return;
    e.preventDefault();
    if (!scrub) { scrubStart(); wheelAcc = 0; }
    wheelAcc -= e.deltaX;
    scrubMove(wheelAcc);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => scrubEnd(0), 160);
  }, { passive: false });

  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable],iframe')) return;
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const at = nav ? nav.to : cur;
    if (e.key === 'ArrowRight') { go(at + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { go(at - 1); e.preventDefault(); }
  });
  addEventListener('popstate', () => { const id = idFromLocation(); go(id ? idx(id) : idx(cfg.home), false); });

  // phones: tabs on top wrap into rows; the page starts below them
  const footEl = document.getElementById('site-foot');
  const setMh = () => {
    document.documentElement.style.setProperty('--mh', marksEl.offsetHeight + 'px');
    if (footEl) document.documentElement.style.setProperty('--fh', footEl.offsetHeight + 'px');
  };
  setMh();
  try { const ro = new ResizeObserver(setMh); ro.observe(marksEl); if (footEl) ro.observe(footEl); } catch (e) { addEventListener('resize', setMh); }

  // ---------- background: a tiny canvas, scaled up ----------
  const cv = document.getElementById('field'), ctx = cv.getContext('2d');
  cv.width = 96; cv.height = 60;
  const startHue = cfg.pages[cur].hue;
  const field = { hue: startHue, targetHue: startHue };
  const blobs = [
    { ax: .30, ay: .35, fx: .021, fy: .017, r: .55, dh: 0, a: .55 },
    { ax: .72, ay: .62, fx: .015, fy: .023, r: .6, dh: 50, a: .45 },
    { ax: .55, ay: .20, fx: .019, fy: .012, r: .45, dh: -60, a: .35 },
    { ax: .18, ay: .80, fx: .011, fy: .019, r: .5, dh: 120, a: .3 },
  ];
  const mode = cfg.bg.mode;
  const animate = mode === 'drift' && !reduce;
  let fLast = 0; const t0 = performance.now();
  function draw(ts) {
    const dt = Math.min(.2, (ts - fLast) / 1000 || .03); fLast = ts;
    const dh = ((field.targetHue - field.hue + 540) % 360) - 180;
    field.hue = (field.hue + dh * Math.min(1, dt * .9) + 360) % 360;
    const s = animate ? (ts - t0) / 1000 * cfg.bg.speed : 0;
    const drift = animate ? Math.sin(s / 40) * 25 : 0;
    const Wc = cv.width, Hc = cv.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `hsl(${(field.hue + 10) % 360},35%,5%)`;
    ctx.fillRect(0, 0, Wc, Hc);
    if (mode !== 'solid') {
      ctx.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        const x = (b.ax + Math.sin(s * b.fx * 6.28 + i) * .18) * Wc;
        const y = (b.ay + Math.cos(s * b.fy * 6.28 + i * 2) * .16) * Hc;
        const r = b.r * Wc * (1 + Math.sin(s * .07 + i) * .12);
        const h = (field.hue + b.dh + drift + 360) % 360;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${h},70%,42%,${b.a})`);
        g.addColorStop(1, `hsla(${h},70%,30%,0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, Wc, Hc);
      });
    }
    return Math.abs(dh) > .5;
  }
  let fieldPrev = 0;
  function fieldLoop(ts) {
    if (document.hidden) { requestAnimationFrame(fieldLoop); return; }
    if (animate) { if (ts - fieldPrev >= 33) { fieldPrev = ts; draw(ts); } }
    else if (Math.abs(((field.targetHue - field.hue + 540) % 360) - 180) > .5) draw(ts);
    requestAnimationFrame(fieldLoop);
  }
  draw(performance.now());
  requestAnimationFrame(fieldLoop);

  // the year in footers stays current even if the site was built last year
  const year = String(new Date().getFullYear());
  document.querySelectorAll('.uw-year').forEach(el => { el.textContent = year; });

  // ---------- start ----------
  try { history.replaceState({ id: pages[cur].dataset.id }, ''); } catch (e) {}
  setMark(cur);
  render();
})();
