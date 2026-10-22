// Google source: reads the client's folder in Drive (spreadsheet + media folder)
// through a service account, and writes the result back into the sheets.
import { google } from 'googleapis';
import { rowsToObjects, indexMedia, TAB_NAMES } from './common.js';

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MEDIA_FOLDER_NAMES = ['media', 'média', 'obrazky', 'obrázky', 'images', 'foto', 'fotky'];
export const CONTROL_TAB = 'klienti';
export const STATUS_TAB = 'stav';

export function googleAuth() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT || '';
  if (!raw) throw new Error('Chybí GOOGLE_SERVICE_ACCOUNT (klíč účtu pro sestavení webu).');
  if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  const creds = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets'],
  });
}

export function idFromLink(link) {
  const s = String(link || '').trim();
  const m = s.match(/\/folders\/([\w-]+)/) || s.match(/\/d\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  if (m) return m[1];
  if (/^[\w-]{20,}$/.test(s)) return s;
  return '';
}

const q = s => `'${String(s).replace(/'/g, "\\'")}'`;

async function listChildren(drive, folderId) {
  const out = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `${q(folderId)} in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, md5Checksum)',
      pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    out.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

export async function googleSource({ auth, folderLink, warn }) {
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const folderId = idFromLink(folderLink);
  if (!folderId) throw new Error(`Odkaz na složku „${folderLink}“ není platný odkaz na Google Disk.`);

  let children;
  try { children = await listChildren(drive, folderId); }
  catch (e) { throw new Error('Ke složce klienta nemám přístup. Nasdílejte ji účtu pro sestavení webu jako Editor.'); }

  const sheetFiles = children.filter(f => f.mimeType === SHEET_MIME);
  if (!sheetFiles.length) throw new Error('Ve složce klienta není žádná tabulka Google Sheets.');
  if (sheetFiles.length > 1) warn(`Ve složce je víc tabulek, použita je „${sheetFiles[0].name}“. Ostatní přesuňte jinam.`);
  const spreadsheetId = sheetFiles[0].id;

  // tabs
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
  const titles = meta.data.sheets.map(s => s.properties.title);
  const wanted = titles.filter(t => TAB_NAMES.includes(t.trim().toLowerCase()));
  const tabs = {};
  if (wanted.length) {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: wanted.map(t => `'${t.replace(/'/g, "''")}'`), valueRenderOption: 'UNFORMATTED_VALUE',
    });
    res.data.valueRanges.forEach((vr, i) => { tabs[wanted[i].trim().toLowerCase()] = rowsToObjects(vr.values || []); });
  }
  for (const t of ['pages']) if (!tabs[t]) warn(`V tabulce chybí list „${t}“.`);

  // media: the folder called "media" (or similar), otherwise the client folder itself
  const mediaFolder = children.find(f => f.mimeType === FOLDER_MIME && MEDIA_FOLDER_NAMES.includes(f.name.trim().toLowerCase()));
  const files = [];
  async function walk(id, prefix) {
    for (const f of await listChildren(drive, id)) {
      if (f.mimeType === FOLDER_MIME) { await walk(f.id, prefix + f.name + '/'); continue; }
      if (f.mimeType.startsWith('application/vnd.google-apps')) continue; // Docs, Sheets…
      files.push({
        key: `gdrive:${f.id}:${f.md5Checksum || f.modifiedTime}`,
        name: f.name,
        path: prefix + f.name,
        size: Number(f.size || 0),
        fetch: async () => {
          const r = await drive.files.get({ fileId: f.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
          return Buffer.from(r.data);
        },
      });
    }
  }
  await walk(mediaFolder ? mediaFolder.id : folderId, '');

  return {
    tabs,
    media: indexMedia(files, warn),
    spreadsheetId,
    /** Writes the result into the client's own sheet, tab "stav". */
    async report(status) {
      try {
        if (!titles.some(t => t.trim().toLowerCase() === STATUS_TAB)) {
          await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: STATUS_TAB, index: titles.length } } }] } });
        }
        await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${STATUS_TAB}!A:B` });
        const rows = [
          ['Poslední publikování', status.when],
          ['Výsledek', status.ok ? 'Web je online' : 'Chyba, web se nezměnil'],
          ['Zpráva', status.message],
          ['Adresa', status.url || ''],
          [''],
          [status.warnings.length ? 'Upozornění' : 'Bez upozornění'],
          ...status.warnings.map(w => ['•', w]),
        ];
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${STATUS_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });
      } catch (e) {
        console.warn('Stav do tabulky klienta se nepodařilo zapsat:', e.message);
      }
    },
  };
}

// ---------- control sheet ----------

const CONTROL_COLS = ['client', 'folder', 'domain', 'active', 'status', 'last_publish', 'url', 'notes'];

export async function readClients(auth, controlId) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: controlId, range: `${CONTROL_TAB}!A:Z`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rows = res.data.values || [];
  const head = (rows[0] || []).map(h => String(h).trim().toLowerCase());
  for (const c of ['client', 'folder']) if (!head.includes(c)) throw new Error(`V řídicí tabulce chybí sloupec „${c}“ v listu „${CONTROL_TAB}“.`);
  return rows.slice(1).map((r, i) => {
    const o = Object.fromEntries(head.map((h, j) => [h, String(r[j] ?? '').trim()]));
    return { ...o, row: i + 2, head };
  }).filter(c => c.client);
}

export async function writeClientStatus(auth, controlId, client, { status, when, url }) {
  const sheets = google.sheets({ version: 'v4', auth });
  const data = [];
  const col = name => client.head.indexOf(name);
  const letter = i => String.fromCharCode(65 + i);
  for (const [name, value] of [['status', status], ['last_publish', when], ['url', url]]) {
    const i = col(name);
    if (i >= 0 && value !== undefined) data.push({ range: `${CONTROL_TAB}!${letter(i)}${client.row}`, values: [[value]] });
  }
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: controlId, requestBody: { valueInputOption: 'RAW', data } });
}

export { CONTROL_COLS };
