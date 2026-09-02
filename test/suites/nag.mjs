import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1200 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1200);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(2500);

const today = await p.evaluate(()=>new Date().toISOString().slice(0,10));
console.log('today:', today, '| board opens on:', await p.locator('input[type=date]').first().inputValue(), '(tomorrow — right for the evening shift)');
let t = await p.innerText('body');
console.log('\nOn tomorrow, the banner reads:\n  ', (t.match(/Today \([^\n]*/)||['MISSING'])[0].slice(0,130));
console.log('  "Go to today" button:', await p.getByRole('button', { name: 'Go to today' }).count() ? 'present' : 'MISSING');
await p.screenshot({ path: `${SP}/N9-nag.png` });

await p.getByRole('button', { name: 'Go to today' }).click(); await p.waitForTimeout(2600);
console.log('\nafter clicking it, date box:', await p.locator('input[type=date]').first().inputValue());
t = await p.innerText('body');
console.log('  banner gone on today:', /Today \(20/.test(t) ? '*** still there ***' : 'yes');
console.log('  lock:', (t.match(/Today — the schedule[^\n]*/)||['—'])[0].slice(0,58));
console.log('  review button:', (t.match(/End-of-day review[^\n]*/)||['MISSING'])[0]);

await p.getByRole('button', { name: /End-of-day review/ }).click(); await p.waitForTimeout(1200);
const dlg = p.locator('div.fixed.inset-0');
const n = await dlg.getByRole('button', { name: 'Fixed', exact: true }).count();
console.log('\nclosing out all', n, 'jobs, one click each…');
for (let i=0;i<n;i++) {
  const btn = dlg.getByRole('button', { name: 'Fixed', exact: true }).first();
  if (!await btn.count()) break;
  await btn.click(); await p.waitForTimeout(300);
}
await p.waitForTimeout(1500);
t = await p.innerText('body');
console.log('  after review:', (t.match(/\d+ still without an outcome|Every job on this day has an outcome/)||['?'])[0]);
await dlg.getByRole('button', { name: /^(Done|Close for now)$/ }).click(); await p.waitForTimeout(1200);
await p.locator('input[type=date]').first().fill('2026-09-02'); await p.waitForTimeout(2600);
t = await p.innerText('body');
console.log('  back on tomorrow, banner:', /Today \(20/.test(t) ? '*** '+(t.match(/Today \([^\n]*/)||[''])[0].slice(0,70) : 'gone (nothing left open)');
console.log('\nerrors:', errs.length?errs:'none');
await b.close();
