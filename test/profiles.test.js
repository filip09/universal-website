import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile, hexToHsl, PROFILE_NAMES } from '../src/profiles.js';

const pages = [{ hue: 10 }, { hue: 200 }, { hue: 300 }, { hue: 40 }, { hue: 120 }];

test('manual keeps the hue column', () => {
  const r = resolveProfile('manual', pages);
  assert.deepEqual(r.pages.map(p => p.h), [10, 200, 300, 40, 120]);
});

test('unknown profile falls back to manual with a warning', () => {
  const warns = [];
  const r = resolveProfile('neon', pages, { warn: w => warns.push(w) });
  assert.equal(r.key, 'manual');
  assert.equal(warns.length, 1);
});

test('names are forgiving about case and diacritics', () => {
  assert.equal(resolveProfile('Korál', pages).key, 'koral');
  assert.equal(resolveProfile(' ZEMĚ ', pages).key, 'zeme');
});

test('one-colour profile: same hue, different tab shades', () => {
  const r = resolveProfile('terakota', pages);
  assert.equal(new Set(r.pages.map(p => p.h)).size, 1);
  assert.ok(new Set(r.pages.map(p => p.tl)).size >= 4);
});

test('palette colours take turns page by page', () => {
  const r = resolveProfile('sever', pages);
  assert.equal(r.pages[0].h, r.pages[4].h);
  assert.notEqual(r.pages[0].h, r.pages[1].h);
});

test('every profile builds four background blobs per page', () => {
  for (const n of PROFILE_NAMES) {
    for (const p of resolveProfile(n, pages).pages) {
      assert.equal(p.field.blobs.length, 4);
      for (const v of [...p.field.base, ...p.field.blobs.flat()]) assert.ok(Number.isFinite(v), n);
    }
  }
});

test('hex to hsl', () => {
  assert.deepEqual(hexToHsl('#00FF41'), [135, 100, 50]);
  assert.equal(resolveProfile('seda', pages).pages[0].s, 0);
});
