/**
 * Universal Website — script for the CONTROL sheet (řídicí tabulka).
 * Paste into: Rozšíření → Apps Script, in the control sheet. Then:
 *   1. Weby → Nastavení (fill in once)
 *   2. Nasadit → Nové nasazení → Webová aplikace
 *        Spustit jako: Já · Kdo má přístup: Kdokoli
 *      and paste the web app address in Weby → Nastavení as the last item.
 * The same web app also receives the contact forms of all published sites
 * (doPost). After changing this script: Nasadit → Spravovat nasazení → upravit
 * (tužka) → Verze: Nová verze → Nasadit. The address stays the same.
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
    .addItem('Vyzkoušet formulář označeného řádku', 'testFormSelected')
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
  const sheetId = sheetIn_(folder);
  if (!sheetId) { SpreadsheetApp.getUi().alert('Ve složce klienta není žádná tabulka.'); return; }
  prepare_(c.client, folder, sheetId);
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

// ---------- web app: contact forms on the published sites ----------
// The page sends: client, type, name, email, phone, message, page, t (when the page
// loaded) and web (a hidden field only bots fill in). The recipient is never taken
// from the request: it is read from the client's own sheet (site › form_email).

const FORM_LIMIT_PER_HOUR = 30; // per site; protects the daily e-mail quota
const FORM_LOG_TAB = 'formulare';

function doPost(e) {
  const p = (e && e.parameter) || {};
  const client = String(p.client || '').trim().toLowerCase();
  const type = String(p.type || 'kontakt').trim().toLowerCase();
  try {
    // bots: the hidden field is filled in, or the form was sent faster than a person types.
    // They get a normal "sent" answer so they do not learn anything.
    if (String(p.web || '').trim()) { formLog_(client, type, 'zahozeno: robot'); return json_({ ok: true }); }
    const t = Number(p.t || 0);
    if (t && Date.now() - t < 3000) { formLog_(client, type, 'zahozeno: příliš rychle'); return json_({ ok: true }); }

    if (type !== 'kontakt') throw new Error('Tento formulář zatím neexistuje.');
    const name = oneLine_(p.name, 120), email = oneLine_(p.email, 200), phone = oneLine_(p.phone, 40);
    const message = String(p.message || '').replace(/\r\n?/g, '\n').trim().slice(0, 5000);
    if (!name || !message) throw new Error('Vyplňte prosím jméno a zprávu.');
    if (!isEmail_(email)) throw new Error('Zkontrolujte prosím e-mail.');

    const c = rows_().find(r => r.client === client);
    if (!c || /^(no|ne)$/i.test(c.active || '')) throw new Error('Tento formulář není aktivní.');
    if (!formRate_(client)) throw new Error('Formulář je teď přetížený. Zkuste to prosím za hodinu.');
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Dnes už formulář nemůže odeslat další zprávu. Zkuste to prosím zítra.');

    const site = formSite_(c);
    const page = /^https:\/\//.test(String(p.page || '')) ? String(p.page).slice(0, 300) : '';
    MailApp.sendEmail({
      to: site.to,
      replyTo: email,
      name: site.name,
      subject: 'Zpráva z webu ' + site.name + ': ' + name,
      body: [
        'Jméno: ' + name,
        'E-mail: ' + email,
        phone ? 'Telefon: ' + phone : null,
        '',
        message,
        '',
        '—',
        'Odpovězte přímo na tento e-mail, odpověď půjde odesílateli.',
        page ? 'Odesláno ze stránky ' + page : null,
      ].filter(l => l !== null).join('\n'),
    });
    formLog_(client, type, 'odesláno');
    return json_({ ok: true });
  } catch (err) {
    const msg = String(err.message || err);
    formLog_(client, type, 'chyba: ' + msg);
    return json_({ ok: false, message: msg });
  }
}

/** Menu: sends a test message through the form of the selected client. The first run also asks for the permission to send e-mail. */
function testFormSelected() {
  const c = selectedClient_();
  if (!c) return;
  CacheService.getScriptCache().remove('form_site_' + c.client);
  const site = formSite_(c);
  MailApp.sendEmail({
    to: site.to,
    name: site.name,
    subject: 'Zkouška formuláře: ' + site.name,
    body: 'Formulář na webu ' + site.name + ' je propojený. Zprávy od návštěvníků budou chodit na ' + site.to + '.',
  });
  formLog_(c.client, 'kontakt', 'zkouška odeslána');
  SpreadsheetApp.getUi().alert('Zkušební zpráva odešla na ' + site.to + '.\nDnes lze ještě odeslat ' + MailApp.getRemainingDailyQuota() + ' e-mailů.');
}

/** Recipient and site name from the client's sheet (tab site), cached for 10 minutes. */
function formSite_(c) {
  const cache = CacheService.getScriptCache(), key = 'form_site_' + c.client;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const sheetId = sheetIn_(DriveApp.getFolderById(idFrom_(c.folder)));
  if (!sheetId) throw new Error('Ve složce webu není tabulka.');
  const tab = SpreadsheetApp.openById(sheetId).getSheetByName('site');
  if (!tab) throw new Error('V tabulce webu chybí list site.');
  const set = {};
  tab.getRange(1, 1, Math.max(tab.getLastRow(), 1), 2).getValues().forEach(r => { set[String(r[0]).trim().toLowerCase()] = String(r[1]).trim(); });
  const to = (set.form_email || '').split(/[,;\s]+/).filter(Boolean);
  if (!to.length || !to.every(isEmail_)) throw new Error('Web nemá v listu site platnou adresu form_email.');
  const site = { to: to.join(','), name: (set.site_name || c.name || c.client).slice(0, 80) };
  cache.put(key, JSON.stringify(site), 600);
  return site;
}

function formRate_(client) {
  const cache = CacheService.getScriptCache(), key = 'form_rate_' + client + '_' + Math.floor(Date.now() / 3600000);
  const n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 3700);
  return n <= FORM_LIMIT_PER_HOUR;
}

/** One row per message: when, which site, result. No personal data. */
function formLog_(client, type, result) {
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(FORM_LOG_TAB);
    if (!sh) { sh = ss.insertSheet(FORM_LOG_TAB); sh.appendRow(['kdy', 'web', 'formulář', 'výsledek']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), client || '?', type || '', String(result).slice(0, 200)]);
  } catch (e) { /* the log must never stop a message */ }
}

const oneLine_ = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const isEmail_ = v => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/.test(String(v || ''));
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

// ---------- helpers ----------

function dispatch_(payload) {
  need_(['GITHUB_TOKEN', 'GITHUB_REPO']);
  // the published pages send their contact forms to this script's web app
  if (PROPS.getProperty('WEBAPP_URL')) payload = Object.assign({ form: PROPS.getProperty('WEBAPP_URL') }, payload);
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
    // a rich-text link works in every spreadsheet locale (formulas differ between , and ;)
    site.getRange(row, 2).clearContent().setRichTextValue(SpreadsheetApp.newRichTextValue().setText('▶ Publikovat web').setLinkUrl(url).build());
    site.getRange(row, 3).setValue('Klikněte, až budete hotovi s úpravami. Web je pak za minutu online.');
  }
}

/** The client's spreadsheet in its folder. Skips files in the trash, which Drive still lists in the folder. */
function sheetIn_(folder) {
  const it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f.getId(); }
  return null;
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
