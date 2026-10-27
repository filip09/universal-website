import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCell, inline, spaceSize } from '../src/markup.js';
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

test('mezera: sizes and keyword', () => {
  const p = parseCell('nadpis: A\nmezera:\ntext: B\nmezera: velká\nspace: small');
  assert.deepEqual(p.map(x => x.kw), ['heading', 'space', 'text', 'space', 'space']);
  assert.deepEqual(p.filter(x => x.kw === 'space').map(x => spaceSize(x.value)), ['m', 'l', 's']);
});

test('mapa: keyword with and without address', () => {
  const p = parseCell('mapa:\nmap: Vinohradská 12, Praha | light');
  assert.deepEqual(p.map(x => [x.kw, x.value, x.style ?? null]), [['map', '', ''], ['map', 'Vinohradská 12, Praha', 'light']]);
});

test('languages: _en columns, id_en, fallback with warning', () => {
  const tabs = {
    site: [{ setting: 'languages', value: 'cs, en' }, { setting: 'home_page', value: 'uvod' }, { setting: 'site_name', value: 'Web' }, { setting: 'site_name_en', value: 'Site' }],
    pages: [
      { id: 'uvod', title: 'Úvod', title_en: 'Home', content: 'text: Ahoj', content_en: 'text: Hello' },
      { id: 'cena', id_en: 'pricing', title: 'Cena', content: 'text: Levně' },
      { id: 'jen-cesky', title: 'Jen česky', content: 'text: x', visible_en: 'no' },
    ],
  };
  const w = [];
  const cs = buildModel(tabs, m => w.push(m));
  const en = buildModel(tabs, m => w.push(m), { lang: 'en' });
  assert.deepEqual(cs.pages.map(p => p.id), ['uvod', 'cena', 'jen-cesky']);
  assert.deepEqual(en.pages.map(p => [p.id, p.base, p.title]), [['uvod', 'uvod', 'Home'], ['pricing', 'cena', 'Cena']]);
  assert.equal(en.site.name, 'Site');
  assert.equal(en.site.language, 'en');
  assert.equal(en.pages[1].content, 'text: Levně');
  assert.ok(w.some(m => m.includes('content_en')));
});
