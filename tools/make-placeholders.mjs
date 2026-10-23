// Labeled placeholder images for an example sheet: reads the media tab and makes
// one image per row at the right shape, so the site can be built before photos exist.
// Usage: node tools/make-placeholders.mjs <sheet.xlsx> <media folder>
import sharp from 'sharp';
import XLSX from 'xlsx';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [xlsxPath, outDir] = process.argv.slice(2);
const wb = XLSX.read(await readFile(xlsxPath), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets.media, { defval: '' });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function shape(id, notes) {
  if (/512 × 512|Čtverec/.test(notes)) return [512, 512];
  if (/4:5/.test(notes)) return [1280, 1600];
  if (/16:9/.test(notes)) return [1600, 900];
  if (/2400/.test(notes)) return [2400, 1350];
  return [1800, 1200];
}

let n = 0;
for (const r of rows) {
  if (String(r.kind).toLowerCase() !== 'image' || !r.source) continue;
  const [w, h] = shape(r.id, r.notes);
  const hue = (n++ * 47 + 12) % 360;
  const fs = Math.round(Math.min(w, h) / 14);
  const words = String(r.alt).split(' ');
  const lines = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= 26) lines[lines.length - 1] = last + ' ' + word; else lines.push(word);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="a" cx=".25" cy=".3" r=".75"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${hue},55%,62%)" stop-opacity="0"/></radialGradient>
    <radialGradient id="b" cx=".8" cy=".85" r=".7"><stop offset="0" stop-color="hsl(${(hue + 60) % 360},55%,52%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},55%,52%)" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="hsl(${hue},30%,16%)"/><rect width="100%" height="100%" fill="url(#a)"/><rect width="100%" height="100%" fill="url(#b)"/>
  <rect x="${w * .04}" y="${h * .04}" width="${w * .92}" height="${h * .92}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="${Math.max(2, w / 600)}" stroke-dasharray="${w / 60} ${w / 90}" rx="${w / 60}"/>
  <text x="50%" y="${h / 2 - (lines.length - 1) * fs * .6}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${fs}" fill="#fff" opacity=".92">
    ${lines.slice(0, 4).map((l, i) => `<tspan x="50%" dy="${i ? fs * 1.2 : 0}">${esc(l)}</tspan>`).join('')}
  </text>
  <text x="50%" y="${h * .9}" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(fs * .45)}" fill="#fff" opacity=".7">${esc(r.source)} · ${w}×${h}</text>
</svg>`;
  const out = path.join(outDir, r.source);
  await mkdir(path.dirname(out), { recursive: true });
  const img = sharp(Buffer.from(svg));
  await (out.endsWith('.png') ? img.png() : img.jpeg({ quality: 85 })).toFile(out);
}
console.log(`${n} placeholder images in ${outDir}`);
