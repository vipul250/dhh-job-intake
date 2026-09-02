import { chromium } from 'playwright';
import fs from 'fs';
import { installKvStub } from '../harness/live-kv-stub.mjs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`, 'utf8'));
const tsv = fs.readFileSync(`${SP}/pms-issues.tsv`, 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1600 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 150)); });
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, r =>
  /rest\/v1\/kv_store/.test(r.request().url()) ? r.continue() : r.abort());
await installKvStub(p, seed);
await p.goto('http://127.0.0.1:4180/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(2000);

const check = async (tab, waitMs, probe) => {
  await p.getByRole('button', { name: tab }).first().click();
  await p.waitForTimeout(waitMs);
  const t = await p.innerText('body');
  const before = errs.length;
  console.log(`\n--- ${tab} --- ${t.length} chars`);
  probe(t);
  if (errs.length > before) console.log('   *** errors:', errs.slice(before));
  return t;
};

await check('Queue', 2500, t => {
  console.log('   empty state:', /Nothing in the queue yet/.test(t) ? 'shown' : (t.match(/\d+ task/) || ['?'])[0]);
  console.log('   rule panel button:', /The rule, in full/.test(t) ? 'present' : 'MISSING');
});
// paste the real PMS issues
await p.getByRole('button', { name: 'Paste the PMS queue' }).first().click(); await p.waitForTimeout(600);
await p.locator('div.fixed.inset-0 textarea').first().fill(tsv);
await p.getByRole('button', { name: 'Add to the queue' }).click(); await p.waitForTimeout(3000);
let t = await p.innerText('body');
console.log('   after pasting 15 real issues:',
  (t.match(/Waiting\n\d+/) || ['?'])[0].replace('\n', ' = '),
  '| past due', (t.match(/Past due\n(\d+)/) || ['', '?'])[1],
  '| blocked', (t.match(/Blocked on a guest\n(\d+)/) || ['', '?'])[1],
  '| empty now', (t.match(/Empty right now\n(\d+)/) || ['', '?'])[1]);
console.log('   a recommendation:', (t.match(/2026-\d\d-\d\d — (The guest checks out that day|Already past due[^\n]*|Earliest[^\n]*)/) || ['—'])[0].slice(0, 78));
console.log('   dismiss is a reason, not a delete:', /take it off the queue/.test(t) ? 'yes' : 'MISSING');

await check('Roster', 2500, t => {
  console.log('   team list:', /Team|Access|roster/i.test(t) ? 'renders' : 'MISSING');
  console.log('   sign-in panel:', /Signing in/.test(t) ? 'present (off by default)' : 'MISSING');
});

await check('Projects', 4000, t => {
  console.log('   discovered:', (t.match(/(\d+) projects? found in the schedule/) || ['none found'])[0]);
  console.log('   Delete button:', /\bDelete\b/.test(t) ? '*** present ***' : 'none');
});

await p.getByRole('button', { name: 'Dashboard' }).first().click(); await p.waitForTimeout(1500);
const dd = p.locator('input[type=date]');
await dd.nth(1).fill('2026-08-18'); await dd.nth(2).fill('2026-09-01');
await p.getByRole('button', { name: 'Load range' }).click(); await p.waitForTimeout(7000);
t = await p.innerText('body');
console.log('\n--- Dashboard (18 Aug – 1 Sep, real data) ---');
console.log('   range:', (t.match(/The range:[^\n]*/) || ['MISSING'])[0]);
const h2 = await p.locator('h2').allTextContents();
console.log('   sections:', h2.length, '→', h2.slice(0, 14).join(' · '));
console.log('   who did what:', /Who did what/.test(t) ? 'present' : 'MISSING');
console.log('   buildings:', (t.match(/(\d+)\s*\n?\s*distinct buildings|distinct buildings/) || ['—'])[0]);
await p.screenshot({ path: `${SP}/LIVE-dash.png`, fullPage: true });

await check('Insights (today)', 2000, t => {
  console.log('   renders:', t.length > 400 ? 'yes' : 'thin');
});
await check('Fault Codes', 1500, t => console.log('   renders:', t.length > 400 ? 'yes' : 'thin'));
await check('Properties', 1500, t => console.log('   renders:', t.length > 400 ? 'yes' : 'thin'));

console.log('\n=== TOTAL CONSOLE/PAGE ERRORS:', errs.length ? errs : 'none', '===');
await b.close();
