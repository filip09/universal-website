// Local source: reads an .xlsx export of the client sheet and a folder of images.
// Used for testing and previews without any Google account.
import XLSX from 'xlsx';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listFilesRecursive } from '../images.js';
import { rowsToObjects, indexMedia, TAB_NAMES } from './common.js';

export async function localSource({ xlsxPath, mediaDir, warn }) {
  const wb = XLSX.read(await readFile(xlsxPath), { type: 'buffer' });
  const tabs = {};
  for (const name of wb.SheetNames) {
    const key = name.trim().toLowerCase();
    if (!TAB_NAMES.includes(key)) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    tabs[key] = rowsToObjects(rows);
  }

  const files = [];
  for (const abs of mediaDir ? await listFilesRecursive(mediaDir) : []) {
    const st = await stat(abs);
    const rel = path.relative(mediaDir, abs).split(path.sep).join('/');
    files.push({
      key: `local:${rel}:${st.size}:${st.mtimeMs}`,
      name: path.basename(abs),
      path: rel,
      size: st.size,
      fetch: () => readFile(abs),
    });
  }

  return {
    tabs,
    media: indexMedia(files, warn),
    async report(status) {
      // Locally the status goes next to the output so it can be read.
      if (status.outDir) {
        await mkdir(status.outDir, { recursive: true });
        await writeFile(path.join(status.outDir, '..', `${path.basename(status.outDir)}-stav.txt`),
          [`${status.ok ? 'Hotovo' : 'Chyba'} · ${status.when}`, status.message, '', ...status.warnings].join('\n'));
      }
    },
  };
}
