#!/usr/bin/env node
// Command line:
//   node src/cli.js build --local sheet.xlsx --media folder --out dist/name
//       builds from local files (no accounts needed)
//   node src/cli.js publish --client <id>     publishes one client from the control sheet
//   node src/cli.js publish --all             publishes every active client
//   node src/cli.js publish --sheet <id>      publishes the client whose folder holds this spreadsheet
//   node src/cli.js check --client <id>       builds without uploading and reports problems
import path from 'node:path';
import { buildFromSource, summary, now, defaultCache } from './build.js';
import { localSource } from './sources/local.js';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined; };

async function buildLocal() {
  const xlsxPath = opt('local');
  if (!xlsxPath || xlsxPath === true) throw new Error('Použití: build --local tabulka.xlsx --media složka --out dist/jmeno');
  const name = path.basename(xlsxPath).replace(/\.xlsx$/i, '');
  const outDir = opt('out') || path.join('dist', name);
  const warnings = [];
  const source = await localSource({ xlsxPath, mediaDir: opt('media') || null, warn: m => warnings.push(m) });
  const res = await buildFromSource({ source, outDir, cacheDir: defaultCache(name), warnings });
  const status = { ok: true, when: now(), message: summary(res), warnings, outDir };
  await source.report(status);
  console.log(`✓ ${outDir}: ${status.message}`);
  if (warnings.length) console.log('\nUpozornění:\n' + warnings.map(w => '  • ' + w).join('\n'));
}

async function publish(deployIt) {
  const { googleAuth, googleSource, readClients, writeClientStatus } = await import('./sources/google.js');
  const { deploy, ensureDomain, projectName } = await import('./deploy.js');
  const controlId = process.env.CONTROL_SHEET_ID;
  if (!controlId) throw new Error('Chybí CONTROL_SHEET_ID (id řídicí tabulky).');
  const auth = googleAuth();
  const clients = await readClients(auth, controlId);

  let chosen;
  const wanted = opt('client'), bySheet = opt('sheet');
  if (opt('all') || wanted === 'all') chosen = clients.filter(c => !/^(no|ne)$/i.test(c.active || ''));
  else if (wanted) chosen = clients.filter(c => c.client.toLowerCase() === String(wanted).toLowerCase());
  else if (bySheet) chosen = await clientsBySheet(auth, clients, String(bySheet));
  else throw new Error('Napište --client <id>, --sheet <id tabulky> nebo --all.');
  if (!chosen.length) throw new Error('Žádný odpovídající klient v řídicí tabulce.');

  let failed = 0;
  for (const c of chosen) {
    const warnings = [];
    const warn = m => warnings.push(m);
    const outDir = path.join('dist', projectName(c.client));
    let source = null;
    try {
      console.log(`\n▸ ${c.client}`);
      await writeClientStatus(auth, controlId, c, { status: 'publikuji…' });
      source = await googleSource({ auth, folderLink: c.folder, warn });
      const res = await buildFromSource({ source, outDir, cacheDir: defaultCache(c.client), warnings });
      let url = '', domainNote = '';
      if (deployIt) {
        const d = await deploy({ client: c.client, outDir });
        url = d.url;
        const dom = await ensureDomain({ client: c.client, domain: c.domain || res.model.site.domain });
        if (dom) {
          if (dom.status === 'active') url = `https://${dom.domain}`;
          else if (dom.status === 'error') warnings.push(`Doménu ${dom.domain} se nepodařilo připojit: ${dom.message}`);
          else domainNote = ` Doména ${dom.domain} čeká na nastavení DNS.`;
        }
      }
      const message = (deployIt ? 'Web je online. ' : 'Kontrola proběhla, nic se nenahrálo. ') + summary(res) + domainNote;
      const when = now();
      await source.report({ ok: true, when, message, warnings, url });
      await writeClientStatus(auth, controlId, c, {
        status: warnings.length ? `online, ${warnings.length} upozornění` : 'online', when, url: url || undefined,
      });
      console.log('  ✓ ' + message + (url ? ' ' + url : ''));
      warnings.forEach(w => console.log('  • ' + w));
    } catch (e) {
      failed++;
      const when = now();
      console.error('  ✗ ' + e.message);
      if (source) await source.report({ ok: false, when, message: e.message, warnings }).catch(() => {});
      await writeClientStatus(auth, controlId, c, { status: 'chyba: ' + e.message.slice(0, 200), when }).catch(() => {});
    }
  }
  if (failed) process.exitCode = 1;
}

// Finds the client whose Drive folder contains the given spreadsheet.
async function clientsBySheet(auth, clients, sheetId) {
  const { google } = await import('googleapis');
  const { idFromLink } = await import('./sources/google.js');
  const drive = google.drive({ version: 'v3', auth });
  const f = await drive.files.get({ fileId: sheetId, fields: 'parents', supportsAllDrives: true });
  const parents = f.data.parents || [];
  return clients.filter(c => parents.includes(idFromLink(c.folder)));
}

const commands = { build: buildLocal, publish: () => publish(true), check: () => publish(false) };
if (!commands[cmd]) {
  console.log('Příkazy: build --local …, publish --client <id> | --sheet <id> | --all, check --client <id>');
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
