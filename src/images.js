// Image pipeline: takes originals from the media folder, makes several sizes in
// AVIF and WebP, and remembers results in .cache so an unchanged image is never
// processed twice.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const WIDTHS = [480, 960, 1600, 2400];
const MAX_COPY_BYTES = 25 * 1024 * 1024; // Cloudflare Pages limit per file

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'img';

const exists = async p => { try { await stat(p); return true; } catch { return false; } };

export class ImagePipeline {
  constructor({ cacheDir, outDir, warn }) {
    this.cacheDir = path.join(cacheDir, 'media');
    this.outDir = outDir;
    this.warn = warn;
    this.done = new Map(); // cache key → promise of result
    this.stats = { processed: 0, cached: 0 };
  }

  async _cached(file, variant, make) {
    const hash = createHash('sha1').update(file.key + '|' + variant + '|v2').digest('hex').slice(0, 10);
    const dir = path.join(this.cacheDir, hash);
    const metaPath = path.join(dir, 'meta.json');
    let meta;
    if (await exists(metaPath)) {
      meta = JSON.parse(await readFile(metaPath, 'utf8'));
      this.stats.cached++;
    } else {
      await mkdir(dir, { recursive: true });
      const input = await file.fetch();
      meta = await make(input, dir, `${slug(file.name)}-${hash}`);
      await writeFile(metaPath, JSON.stringify(meta));
      this.stats.processed++;
    }
    const mediaOut = path.join(this.outDir, 'media');
    await mkdir(mediaOut, { recursive: true });
    for (const f of meta.files) await copyFile(path.join(dir, f), path.join(mediaOut, f));
    return meta;
  }

  /** Responsive image. Returns { width, height, avif:[{file,w}], webp:[{file,w}], src } or { file } for svg/gif. */
  image(file) {
    const k = 'img:' + file.key;
    if (!this.done.has(k)) this.done.set(k, this._image(file).catch(err => {
      this.warn(`Obrázek „${file.path}“ se nepodařilo zpracovat (${err.message.split('\n')[0]}). Uložte ho jako JPG nebo PNG.`);
      return null;
    }));
    return this.done.get(k);
  }

  async _image(file) {
    const ext = path.extname(file.name).toLowerCase();
    if (ext === '.svg' || ext === '.gif') {
      return this._cached(file, 'copy', async (input, dir, base) => {
        const name = base + ext;
        await writeFile(path.join(dir, name), input);
        let width = 0, height = 0;
        try { const m = await sharp(input).metadata(); width = m.width; height = m.height; } catch {}
        return { kind: 'plain', files: [name], src: name, width, height };
      });
    }
    return this._cached(file, 'responsive', async (input, dir, base) => {
      const img = sharp(input, { failOn: 'none' }).rotate();
      const meta = await img.metadata();
      const swap = (meta.orientation || 1) >= 5;
      const W = swap ? meta.height : meta.width;
      const H = swap ? meta.width : meta.height;
      let widths = WIDTHS.filter(w => w < W);
      if (!widths.length || W - widths[widths.length - 1] > 200) widths.push(Math.min(W, 2400));
      widths = [...new Set(widths)];
      const files = [], avif = [], webp = [];
      for (const w of widths) {
        const resized = sharp(input, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true });
        const a = `${base}-${w}.avif`, b = `${base}-${w}.webp`;
        await resized.clone().avif({ quality: 52, effort: 2 }).toFile(path.join(dir, a));
        await resized.clone().webp({ quality: 78 }).toFile(path.join(dir, b));
        files.push(a, b); avif.push({ file: a, w }); webp.push({ file: b, w });
      }
      const mid = webp.find(x => x.w >= 960) || webp[webp.length - 1];
      return { kind: 'responsive', files, width: W, height: H, avif, webp, src: mid.file };
    });
  }

  /** 1200 px JPG for link previews (Facebook, WhatsApp, LinkedIn). */
  share(file) {
    const k = 'og:' + file.key;
    if (!this.done.has(k)) this.done.set(k, this._cached(file, 'og', async (input, dir, base) => {
      const name = `${base}-og.jpg`;
      await sharp(input, { failOn: 'none' }).rotate().resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82 }).toFile(path.join(dir, name));
      return { files: [name], src: name };
    }).catch(() => null));
    return this.done.get(k);
  }

  /** Favicons: 32 px PNG and 180 px Apple touch icon. */
  icon(file) {
    const k = 'ico:' + file.key;
    if (!this.done.has(k)) this.done.set(k, this._cached(file, 'icon', async (input, dir, base) => {
      const a = `${base}-32.png`, b = `${base}-180.png`;
      await sharp(input).resize(32, 32, { fit: 'cover' }).png().toFile(path.join(dir, a));
      await sharp(input).resize(180, 180, { fit: 'cover' }).png().toFile(path.join(dir, b));
      return { files: [a, b], small: a, large: b };
    }).catch(() => null));
    return this.done.get(k);
  }

  /** Video or other file copied as it is (e.g. mp4). */
  copy(file) {
    const k = 'cp:' + file.key;
    if (!this.done.has(k)) this.done.set(k, (async () => {
      if (file.size && file.size > MAX_COPY_BYTES) {
        this.warn(`Soubor „${file.path}“ má víc než 25 MB, web ho nemůže nést. Nahrajte ho na YouTube nebo Vimeo a vložte odkaz.`);
        return null;
      }
      return this._cached(file, 'copy', async (input, dir, base) => {
        if (input.length > MAX_COPY_BYTES) throw new Error('too large');
        const name = base + path.extname(file.name).toLowerCase();
        await writeFile(path.join(dir, name), input);
        return { files: [name], src: name };
      });
    })().catch(() => { this.warn(`Soubor „${file.path}“ se nepodařilo zkopírovat.`); return null; }));
    return this.done.get(k);
  }
}

export async function listFilesRecursive(root) {
  const out = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p); else out.push(p);
    }
  }
  if (await exists(root)) await walk(root);
  return out;
}
