// Generates placeholder artwork for the local demo (no real photos needed).
import sharp from 'sharp';
const art = (w, h, stops, bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>${stops.map((s, i) => `<radialGradient id="g${i}" cx="${s[1]}" cy="${s[2]}" r="${s[3]}"><stop offset="0" stop-color="${s[0]}"/><stop offset="1" stop-color="${s[0]}" stop-opacity="0"/></radialGradient>`).join('')}</defs>
<rect width="100%" height="100%" fill="${bg}"/>${stops.map((_, i) => `<rect width="100%" height="100%" fill="url(#g${i})"/>`).join('')}</svg>`);
const out = 'examples/media/';
await sharp(art(2400, 1350, [['#ff6fae', '.2', '.3', '.6'], ['#6b5bff', '.8', '.7', '.6'], ['#ffb36b', '.6', '.2', '.45']], '#1a1030')).jpeg({ quality: 90 }).toFile(out + 'hero.jpg');
await sharp(art(512, 512, [['#9b8cff', '.35', '.35', '.7'], ['#ff7ab8', '.75', '.75', '.6']], '#140c26')).png().toFile(out + 'ikona.png');
const sets = [
  [['#7af0d0', '.3', '.3', '.6'], ['#2b4cff', '.8', '.9', '.7'], '#0d1530'],
  [['#ffd36b', '.7', '.2', '.6'], ['#ff4f7b', '.2', '.9', '.8'], '#2a0f1c'],
  [['#b48cff', '.5', '.4', '.6'], ['#3fd5ff', '.9', '.9', '.6'], '#120c2a'],
  [['#ff9a5c', '.2', '.8', '.7'], ['#ffe9b0', '.8', '.2', '.6'], '#2b160c'],
  [['#5cffa8', '.6', '.6', '.7'], ['#1fa0ff', '.2', '.1', '.5'], '#06201a'],
  [['#ff7af0', '.4', '.3', '.6'], ['#6a4bff', '.7', '.9', '.7'], '#1d0b26'],
];
for (const [i, s] of sets.entries()) await sharp(art(1600, 2000, s.slice(0, 2), s[2])).jpeg({ quality: 88 }).toFile(`${out}galerie/vecer-0${i + 1}.jpg`);
console.log('example media ready');
