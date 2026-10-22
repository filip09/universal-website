// Deploys a built site to Cloudflare Pages (direct upload with wrangler) and
// connects the client's domain through the Cloudflare API.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const projectName = client =>
  ('uw-' + String(client).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 58);

function run(args) {
  return new Promise(resolve => {
    const bin = path.join(repoRoot, 'node_modules', '.bin', 'wrangler');
    const p = spawn(bin, args, { cwd: repoRoot, env: process.env });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
    p.on('error', err => resolve({ code: 1, out: String(err) }));
  });
}

function needEnv() {
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])
    if (!process.env[k]) throw new Error(`Chybí ${k} (přístup ke Cloudflare).`);
}

export async function deploy({ client, outDir }) {
  needEnv();
  const name = projectName(client);
  const created = await run(['pages', 'project', 'create', name, '--production-branch', 'main']);
  if (created.code !== 0 && !/already exists|8000002|A project with this name already exists/i.test(created.out)) {
    throw new Error('Projekt na Cloudflare se nepodařilo založit: ' + created.out.trim().split('\n').slice(-3).join(' '));
  }
  const res = await run(['pages', 'deploy', outDir, '--project-name', name, '--branch', 'main', '--commit-dirty=true']);
  if (res.code !== 0) throw new Error('Nahrání na Cloudflare selhalo: ' + res.out.trim().split('\n').slice(-3).join(' '));
  return { project: name, url: `https://${name}.pages.dev` };
}

/** Attaches a custom domain to the project. Safe to call on every publish. */
export async function ensureDomain({ client, domain }) {
  if (!domain) return null;
  needEnv();
  const name = projectName(client);
  const api = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${name}/domains`;
  const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };
  const list = await fetch(api, { headers }).then(r => r.json()).catch(() => null);
  let entry = list?.result?.find(d => d.name === domain);
  if (!entry) {
    const add = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ name: domain }) }).then(r => r.json()).catch(() => null);
    if (!add?.success) return { domain, status: 'error', message: add?.errors?.[0]?.message || 'neznámá chyba' };
    entry = add.result;
  }
  return { domain, status: entry.status }; // "active" once DNS points to the project
}
