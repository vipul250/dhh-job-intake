import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
/* Both tabs must share one renderer, or they get separate, lazily-synced
   localStorage snapshots and the stub loses writes the real database would
   have rejected as a version conflict — a property of the harness, not of
   the app. */
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--renderer-process-limit=1', '--disable-site-isolation-trials'] });
const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
const DATE = '2026-09-12';
async function open(name) {
  const p = await ctx.newPage();
  p.on('pageerror', e=>console.log('PAGEERR', e.message));
  p.on('console', m=>{ const t=m.text(); if(/Could not save|too many|WARN|CASLOG/i.test(t)) console.log('['+name+'] '+t); });
  await p.goto('http://127.0.0.1:4173/');
  await p.evaluate(()=>localStorage.removeItem('dhh-me'));
  await p.reload(); await p.waitForTimeout(900);
  await p.locator('input[placeholder*="Ahmed"]').fill(name);
  await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(700);
  await p.locator('input[type=date]').first().fill(DATE); await p.waitForTimeout(1800);
  return p;
}
const a = await ctx.newPage();
await a.goto('http://127.0.0.1:4173/');
await a.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await a.close();

const p1 = await open('Haris');
const p2 = await open('Kaja');
// both coordinators type into the same day at the same time, no waiting
const add = (p, line) => p.locator('textarea').first().fill(line)
  .then(()=>p.locator('textarea').first().press('Enter'));
const toasts=[];
for (const [nm,pg] of [['Haris',p1],['Kaja',p2]]) {
  await pg.evaluate(()=>{ window.__toasts=[]; });
}
for (let i = 0; i < 6; i++) {
  await Promise.all([
    add(p1, `Haris Tower ${100+i} ac not cooling 1h Nizar occupied p2`),
    add(p2, `Kaja Tower ${200+i} plumbing leak 1h Imtiaz occupied p2`),
  ]);
  await p1.waitForTimeout(700);
}
await p1.waitForTimeout(4000);
for (const [nm,pg] of [['Haris',p1],['Kaja',p2]]) {
  const body = await pg.innerText('body');
  const m = body.match(/Could not save[^\n]*/g);
  console.log(nm, 'visible error:', m ? m.join(' | ') : 'none');
}
const stored = await p1.evaluate((d)=>{
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  const rows = JSON.parse(kv['schedule:'+d]||'[]').filter(r=>!r._tomb);
  return { n: rows.length, props: rows.map(r=>r.property+'/'+r.unit) };
}, DATE);
console.log('12 concurrent adds from two coordinators ->', JSON.stringify(stored));
console.log(stored.n === 12 ? 'NO LOST UPDATES' : 'LOST UPDATES');
await b.close();
