import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pickSubsets, fontHead } from '../src/fonts.js';

const CSS = `/* cyrillic */
@font-face { font-family: 'Figtree'; src: url(https://fonts.gstatic.com/s/figtree/v1/cyr.woff2) format('woff2'); unicode-range: U+0400-045F; }
/* latin-ext */
@font-face { font-family: 'Figtree'; src: url(https://fonts.gstatic.com/s/figtree/v1/ext.woff2) format('woff2'); unicode-range: U+0100-02BA; }
/* latin */
@font-face { font-family: 'Figtree'; src: url(https://fonts.gstatic.com/s/figtree/v1/lat.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;

test('keeps only latin and latin-ext', () => {
  assert.deepEqual(pickSubsets(CSS).map(x => x.subset), ['latin-ext', 'latin']);
});

test('downloads fonts and rewrites urls to the site', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'uwf-'));
  const real = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('googleapis')
    ? new Response(CSS) : new Response(new Uint8Array([1, 2, 3]));
  try {
    const head = await fontHead({ families: ['Figtree'], outDir: path.join(dir, 'out'), cacheDir: path.join(dir, 'c', 'x'), root: '../', warn: m => { throw new Error(m); } });
    assert.match(head, /href="\.\.\/assets\/fonts\.[a-f0-9]+\.css"/);
    assert.match(head, /rel="preload"/);
    const css = (await readdir(path.join(dir, 'out', 'assets'))).find(f => f.endsWith('.css'));
    const text = await readFile(path.join(dir, 'out', 'assets', css), 'utf8');
    assert.doesNotMatch(text, /gstatic/);
    assert.equal((await readdir(path.join(dir, 'out', 'assets', 'fonts'))).length, 2);
  } finally { globalThis.fetch = real; }
});

test('falls back to Google links when offline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'uwf-'));
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  const warns = [];
  try {
    const head = await fontHead({ families: ['Gloock', 'Figtree'], outDir: path.join(dir, 'out'), cacheDir: path.join(dir, 'c', 'x'), root: './', warn: m => warns.push(m) });
    assert.match(head, /fonts\.googleapis\.com/);
    assert.equal(warns.length, 1);
  } finally { globalThis.fetch = real; }
});
