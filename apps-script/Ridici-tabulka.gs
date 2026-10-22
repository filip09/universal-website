/**
 * Universal Website — script for the CONTROL sheet (řídicí tabulka).
 * Paste into: Rozšíření → Apps Script, in the control sheet. Then:
 *   1. Weby → Nastavení (fill in once)
 *   2. Nasadit → Nové nasazení → Webová aplikace
 *        Spustit jako: Já · Kdo má přístup: Kdokoli
 *      and paste the web app address in Weby → Nastavení as the last item.
 */

const TAB = 'klienti';
const PROPS = PropertiesService.getScriptProperties();
const SETTINGS = [
  ['GITHUB_TOKEN', 'GitHub token (fine-grained, oprávnění Contents: Read and write k repozitáři webu)', true],
  ['GITHUB_REPO', 'GitHub repozitář ve tvaru jmeno/universal-website', false],
  ['ROBOT_EMAIL', 'E-mail účtu pro sestavení webu (…@….iam.gserviceaccount.com)', false],
  ['TEMPLATE_SHEET', 'Odkaz na šablonu tabulky klienta', false],
  ['PARENT_FOLDER', 'Odkaz na složku, ve které budou složky klientů', false],
  ['WEBAPP_URL', 'Adresa webové aplikace tohoto skriptu (po nasazení)', false],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Weby')
    .addItem('Publikovat označený řádek', 'publishSelected')
    .addItem('Publikovat všechny weby', 'publishAll')
    .addSeparator()
    .addItem('Založit nového klienta…', 'newClient')
    .addItem('Připravit označený řádek (sdílení a odkaz)', 'prepareSelected')
    .addSeparator()
    .addItem('Nastavení…', 'settings')
    .addToUi();
}

// ---------- menu actions ----------

function publishSelected() {
  const c = selectedClient_();
  if (!c) return;
  dispatch_({ client: c.client });
  setStatus_(c.row, 've frontě…');
  toast_('Publikuji ' + c.client + '. Stav se za chvíli objeví ve sloupci status.');
}

function publishAll() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Publikovat všechny aktivní weby?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  dispatch_({ client: 'all' });
  toast_('Publikuji všechny weby.');
}

function newClient() {
  const ui = SpreadsheetApp.getUi();
  need_(['TEMPLATE_SHEET', 'PARENT_FOLDER', 'ROBOT_EMAIL', 'WEBAPP_URL']);
  const id = ui.prompt('Nový klient', 'Krátké id (malá písmena, bez mezer, např. studio-x):', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const client = id.getResponseText().trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(client)) { ui.alert('Id může obsahovat jen malá písmena bez diakritiky, číslice a pomlčky.'); return; }
  if (rows_().some(r => r.client === client)) { ui.alert('Klient „' + client + '“ už v tabulce je.'); return; }
  const nm = ui.prompt('Nový klient', 'Název webu / klienta (např. Studio X):', ui.ButtonSet.OK_CANCEL);
  if (nm.getSelectedButton() !== ui.Button.OK) return;
  const name = nm.getResponseText().trim() || client;

  const parent = DriveApp.getFolderById(idFrom_(PROPS.getProperty('PARENT_FOLDER')));
  const folder = parent.createFolder(name);
  folder.createFolder('media');
  const copy = DriveApp.getFileById(idFrom_(PROPS.getProperty('TEMPLATE_SHEET'))).makeCopy(name + ' – web', folder);

  const sh = sheet_();
  const head = header_();
  const row = new Array(head.length).fill('');
  const put = (col, v) => { const i = head.indexOf(col); if (i >= 0) row[i] = v; };
  put('client', client); put('name', name); put('folder', folder.getUrl()); put('active', 'yes'); put('status', 'nový');
  sh.appendRow(row);
  prepare_(client, folder, copy.getId());
  ui.alert('Hotovo', 'Složka „' + name + '“ je založená, tabulka zkopírovaná a nasdílená robotovi.\n\n' + folder.getUrl(), ui.ButtonSet.OK);
}

function prepareSelected() {
  const c = selectedClient_();
  if (!c) return;
  need_(['ROBOT_EMAIL', 'WEBAPP_URL']);
  const folder = DriveApp.getFolderById(idFrom_(c.folder));
  const sheets = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  if (!sheets.hasNext()) { SpreadsheetApp.getUi().alert('Ve složce klienta není žádná tabulka.'); return; }
  prepare_(c.client, folder, sheets.next().getId());
  toast_('Složka je nasdílená robotovi a v tabulce klienta je odkaz Publikovat.');
}

function settings() {
  const ui = SpreadsheetApp.getUi();
  for (const [key, label, secret] of SETTINGS) {
    const cur = PROPS.getProperty(key);
    const shown = cur ? (secret ? '••••' + cur.slice(-4) : cur) : 'nevyplněno';
    const r = ui.prompt('Nastavení (' + key + ')', label + '\n\nTeď: ' + shown + '\nNechte prázdné, pokud nechcete měnit.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    const v = r.getResponseText().trim();
    if (v) PROPS.setProperty(key, v);
  }
  toast_('Nastavení uloženo.');
}

// ---------- web app: the "Publikovat" link in each client sheet ----------

function doGet(e) {
  const sheetId = (e && e.parameter && e.parameter.sheet) || '';
  let title = 'Publikování odesláno', text = 'Web bude za minutu až dvě online. Výsledek uvidíte v listu „stav“ ve vaší tabulce.', ok = true;
  try {
    const c = clientForSheet_(sheetId);
    if (!c) throw new Error('Tato tabulka není zapsaná v řídicí tabulce.');
    if (/^(no|ne)$/i.test(c.active || '')) throw new Error('Tento web je vypnutý (active = no).');
    const lockKey = 'last_' + c.client;
    const last = Number(PROPS.getProperty(lockKey) || 0);
    if (Date.now() - last < 60 * 1000) {
      title = 'Už se publikuje';
      text = 'Publikování tohoto webu bylo spuštěné před chvílí. Počkejte prosím minutu.';
    } else {
      PROPS.setProperty(lockKey, String(Date.now()));
      dispatch_({ client: c.client });
      setStatus_(c.row, 've frontě…');
    }
  } catch (err) {
    ok = false; title = 'Nepodařilo se'; text = String(err.message || err);
  }
  return HtmlService.createHtmlOutput(page_(title, text, ok)).setTitle(title);
}

// ---------- helpers ----------

function dispatch_(payload) {
  need_(['GITHUB_TOKEN', 'GITHUB_REPO']);
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + PROPS.getProperty('GITHUB_REPO') + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ event_type: 'publish', client_payload: payload }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('GitHub odmítl požadavek (' + res.getResponseCode() + '). Zkontrolujte token a repozitář v Nastavení.');
}

function prepare_(client, folder, sheetId) {
  const robot = PROPS.getProperty('ROBOT_EMAIL');
  const already = folder.getEditors().some(u => u.getEmail() === robot);
  if (!already) folder.addEditor(robot);
  // Put the publish link into the client's sheet (tab "site", row "publikovat")
  const ss = SpreadsheetApp.openById(sheetId);
  const site = ss.getSheetByName('site');
  if (site) {
    const url = PROPS.getProperty('WEBAPP_URL') + '?sheet=' + sheetId;
    const values = site.getRange(1, 1, Math.max(site.getLastRow(), 1), 1).getValues().map(r => String(r[0]).trim());
    let row = values.indexOf('publikovat') + 1;
    if (!row) { row = site.getLastRow() + 1; site.getRange(row, 1).setValue('publikovat'); }
    site.getRange(row, 2).setFormula('=HYPERLINK("' + url + '", "▶ Publikovat web")');
    site.getRange(row, 3).setValue('Klikněte, až budete hotovi s úpravami. Web je pak za minutu online.');
  }
}

function clientForSheet_(sheetId) {
  if (!/^[\w-]{20,}$/.test(sheetId)) return null;
  const parents = DriveApp.getFileById(sheetId).getParents();
  const ids = [];
  while (parents.hasNext()) ids.push(parents.next().getId());
  return rows_().find(r => ids.indexOf(idFrom_(r.folder)) >= 0) || null;
}

function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  if (!sh) throw new Error('V řídicí tabulce chybí list „' + TAB + '“.');
  return sh;
}
function header_() { return sheet_().getRange(1, 1, 1, sheet_().getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase()); }
function rows_() {
  const sh = sheet_(), head = header_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().map((r, i) => {
    const o = { row: i + 2 };
    head.forEach((h, j) => { o[h] = String(r[j]).trim(); });
    return o;
  }).filter(o => o.client);
}
function selectedClient_() {
  const sh = SpreadsheetApp.getActiveSheet();
  const row = sh.getActiveRange().getRow();
  if (sh.getName() !== TAB || row < 2) { SpreadsheetApp.getUi().alert('Klikněte nejdřív na řádek klienta v listu „' + TAB + '“.'); return null; }
  return rows_().find(r => r.row === row) || null;
}
function setStatus_(row, text) {
  const i = header_().indexOf('status');
  if (i >= 0) sheet_().getRange(row, i + 1).setValue(text);
}
function idFrom_(link) {
  const s = String(link || '');
  const m = s.match(/\/folders\/([\w-]+)/) || s.match(/\/d\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : s.trim();
}
function need_(keys) {
  const missing = keys.filter(k => !PROPS.getProperty(k));
  if (missing.length) throw new Error('Nejdřív vyplňte Weby → Nastavení: ' + missing.join(', '));
}
function toast_(msg) { SpreadsheetApp.getActive().toast(msg, 'Weby', 6); }

function page_(title, text, ok) {
  const color = ok ? '#9b8cff' : '#ff7a8a';
  return '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(60% 60% at 30% 30%,#3b1d5c,transparent),#08080f;color:#ece9f4;font:17px/1.6 system-ui,sans-serif;padding:24px}' +
    'main{max-width:420px;padding:32px;border-radius:20px;background:rgba(20,20,34,.7);border:1px solid rgba(255,255,255,.12)}' +
    'h1{font:400 30px/1.15 Georgia,serif;margin:0 0 12px}i{display:block;width:44px;height:4px;border-radius:2px;background:' + color + ';margin-bottom:20px}p{margin:0;color:#cfcbe0}</style></head>' +
    '<body><main><i></i><h1>' + title + '</h1><p>' + text + '</p></main></body></html>';
}
