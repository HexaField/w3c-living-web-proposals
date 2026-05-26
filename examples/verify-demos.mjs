/**
 * Boot each demo's vite dev server on a unique port, load it in headless
 * Chromium, and exercise the create flow. Captures console errors,
 * uncaught page errors, and request failures. Exits non-zero on any error.
 *
 * Usage:  node verify-demos.mjs
 */

import { chromium } from '/Users/josh/workspaces/hexafield/w3c-living-web-proposals/examples/node_modules/.pnpm/playwright-core@1.59.1/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEMOS = [
  {
    name: 'community-chat',
    port: 5180,
    fields: { '#display-name': 'Alice', '#community-name': 'Devs' },
    createBtn: '#btn-create',
    readySelector: '.app-layout .sidebar-left',
  },
  {
    name: 'p2p-vcs',
    port: 5181,
    fields: { '#display-name': 'Alice', '#repo-name': 'my-repo' },
    createBtn: '#btn-create',
    readySelector: '.vcs-layout .top-bar .repo-name',
  },
  {
    name: 'collaborative-doc',
    port: 5182,
    fields: { '#display-name': 'Alice', '#doc-title': 'My Doc' },
    createBtn: '#btn-create',
    readySelector: '.doc-layout .top-bar .doc-title',
  },
  {
    name: 'collaborative-canvas',
    port: 5183,
    fields: { '#display-name': 'Alice', '#canvas-name': 'My Canvas' },
    createBtn: '#btn-create',
    readySelector: '.canvas-app .canvas-area',
  },
  {
    name: 'multiplayer-game',
    port: 5184,
    fields: { '#display-name': 'Alice', '#world-name': 'My World' },
    createBtn: '#btn-create',
    readySelector: '#app .hud',
  },
];

const ROOT = path.resolve(__dirname, 'demos');

async function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Server on ${port} not ready after ${timeoutMs}ms`);
}

async function exerciseDemo(demo) {
  const cwd = path.join(ROOT, demo.name);
  const server = spawn('pnpm', ['dev', '--port', String(demo.port), '--strictPort'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
    detached: true,
  });

  const serverLog = [];
  server.stdout.on('data', d => serverLog.push(d.toString()));
  server.stderr.on('data', d => serverLog.push(d.toString()));

  try {
    await waitForServer(demo.port);

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const requestFails = [];

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', e => pageErrors.push(`${e.name}: ${e.message}`));
    page.on('requestfailed', r => {
      requestFails.push(`${r.failure()?.errorText ?? 'failed'} ${r.url()}`);
    });

    await page.goto(`http://localhost:${demo.port}/`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('input#display-name', { timeout: 10000 });

    for (const [sel, val] of Object.entries(demo.fields)) {
      const exists = await page.locator(sel).count();
      if (exists > 0) await page.fill(sel, val);
    }

    const createBtn = await page.locator(demo.createBtn).count();
    let postCreateState = 'create-button-missing';
    if (createBtn > 0) {
      await page.click(demo.createBtn);
      try {
        await page.waitForSelector(demo.readySelector, { timeout: 15000 });
        postCreateState = 'ready';
      } catch {
        postCreateState = `ready-selector-timeout (waited for ${demo.readySelector})`;
      }
    }

    await sleep(1500);

    await browser.close();

    return {
      name: demo.name,
      port: demo.port,
      postCreateState,
      consoleErrors,
      pageErrors,
      requestFails,
    };
  } finally {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    await sleep(500);
    try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  }
}

const results = [];
for (const demo of DEMOS) {
  process.stdout.write(`▶ ${demo.name} (port ${demo.port}) … `);
  try {
    const r = await exerciseDemo(demo);
    results.push(r);
    const totalErrs = r.consoleErrors.length + r.pageErrors.length;
    process.stdout.write(
      totalErrs === 0
        ? `OK [${r.postCreateState}]\n`
        : `${totalErrs} error(s) [${r.postCreateState}]\n`,
    );
  } catch (e) {
    results.push({ name: demo.name, port: demo.port, fatal: e.message });
    process.stdout.write(`FATAL: ${e.message}\n`);
  }
}

console.log('\n--- Detail ---');
for (const r of results) {
  console.log(`\n▼ ${r.name}`);
  if (r.fatal) { console.log(`  FATAL: ${r.fatal}`); continue; }
  console.log(`  postCreate: ${r.postCreateState}`);
  if (r.consoleErrors.length) {
    console.log(`  console.error (${r.consoleErrors.length}):`);
    for (const e of r.consoleErrors) console.log(`    - ${e}`);
  }
  if (r.pageErrors.length) {
    console.log(`  pageerror (${r.pageErrors.length}):`);
    for (const e of r.pageErrors) console.log(`    - ${e}`);
  }
  if (r.requestFails.length) {
    console.log(`  request fails (${r.requestFails.length}):`);
    for (const e of r.requestFails) console.log(`    - ${e}`);
  }
}

const hasErrors = results.some(r =>
  r.fatal ||
  r.consoleErrors?.length ||
  r.pageErrors?.length ||
  r.requestFails?.length ||
  (r.postCreateState && r.postCreateState !== 'ready'),
);
process.exit(hasErrors ? 1 : 0);
