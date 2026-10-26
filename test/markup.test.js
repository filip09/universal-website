import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCell, inline } from '../src/markup.js';
import { buildModel } from '../src/model.js';

test('parts on one line, Czech and English keywords', () => {
  const p = parseCell('text: blablabla citation: blabla text: blabla semititle:blabla');
  assert.deepEqual(p.map(x => x.kw), ['text', 'quote', 'text', 'subheading']);
});

test('style after a pipe, only known styles', () => {
  assert.deepEqual(parseCell('obrázek: hero.jpg | full')[0], { kw: 'image', value: 'hero.jpg', style: 'full' });
  assert.equal(parseCell('text: A | b')[0].value, 'A | b');
});

test('text before the first keyword is a paragraph', () => {
  assert.equal(parseCell('Jen tak text')[0].kw, 'text');
});

test('times and urls are not keywords', () => {
  const p = parseCell('text: v 10:30 začínáme\nvideo: https://youtu.be/aqz-KE-bpKQ');
  assert.equal(p.length, 2);
  assert.equal(p[1].value, 'https://youtu.be/aqz-KE-bpKQ');
});

test('inline formatting and safe links', () => {
  assert.equal(inline('**a** *b* 2*3*4'), '<strong>a</strong> <em>b</em> 2*3*4');
  assert.match(inline('[x](javascript:alert(1))'), /^x/);
  assert.match(inline('<script>'), /&lt;script&gt;/);
});

test('model: hidden pages, order, home fallback', () => {
  const warns = [];
  const m = buildModel({
    pages: [
      { id: 'b', order: 20, title: 'B', content: '' },
      { id: 'a', order: 10, title: 'A', content: '' },
      { id: 'c', order: 5, title: 'C', visible: 'no' },
    ],
    site: [{ setting: 'home_page', value: 'missing' }],
  }, w => warns.push(w));
  assert.deepEqual(m.pages.map(p => p.id), ['a', 'b']);
  assert.equal(m.site.home, 'a');
  assert.equal(warns.length, 1);
});

test('variables: year, site name, (c)', async () => {
  const { setVariables } = await import('../src/markup.js');
  setVariables({ year: '2031', site: 'Studio <X>' });
  assert.equal(inline('(c) {rok} {web}'), '© <span class="uw-year">2031</span> Studio &lt;X&gt;');
  assert.match(inline('{ year }'), /2031/);
});

test('form keyword in Czech and English', () => {
  assert.deepEqual(parseCell('formulář: kontakt')[0], { kw: 'form', value: 'kontakt', style: '' });
  assert.equal(parseCell('form: contact')[0].kw, 'form');
});
