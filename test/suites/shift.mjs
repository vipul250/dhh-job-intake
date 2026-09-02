import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const TASKS = [
 'Number\tTitle\tProperty\tSubcategory\tPriority\tStatus\tAssignees\tDuration',
 'TSK401330\tvacant - Laundry room door is broken L2-44\tLIV Marina 2604\tCarpentry Works\tMedium\tTo do\tVitalis\t1h 30m',
 'TSK401531\tWC - Water leak from our unit to below\tImperial Avenue 3408\tPlumbing Works\tHigh\tTo do\tYousoufu\t2h',
 'TSK401999\tGC 2-4pm - Clogged Sink GR B\tGrande 2702\tPlumbing Works\tMedium\tTo do\tYousoufu\t30m',
 'TSK402010\tB2B- Paint touch up (P1-16)\tDamac Heights 7702\tCarpentry Works\tHigh\tTo do\tBright\t1h',
].join('\n');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1500 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,150)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1100);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(800);

await p.locator('input[type=date]').first().fill('2026-09-02'); await p.waitForTimeout(2200);
console.log('=== EVENING (building 2026-09-02) ===');
await p.getByRole('button', { name: /Paste the day in/ }).click(); await p.waitForTimeout(700);
await p.locator('div.fixed.inset-0 textarea').first().fill(TASKS); await p.waitForTimeout(1200);
let t = await p.innerText('body');
console.log('preview:', (t.match(/\d+ task\(s\) read[\s\S]{0,140}/)||[''])[0].split('\n').filter(Boolean).slice(0,4).join(' | '));
await p.screenshot({ path: `${SP}/S1-paste.png` });
await p.getByRole('button', { name: /^Add 4 to 2026-09-02/ }).click(); await p.waitForTimeout(2500);
const stored = await p.evaluate(()=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  return JSON.parse(kv['schedule:2026-09-02']||'[]').filter(r=>!r._tomb).map(j=>({p:j.property+' '+j.unit,occ:j.status,t:j.timeOfVisit,gc:j.guestConfirmed,tech:j.team,est:j.estimatedTime,ref:j.pmsRef}));
});
console.log('stored:'); stored.forEach(x=>console.log('  ', JSON.stringify(x)));

await p.getByRole('button', { name: /Paste the day in/ }).click(); await p.waitForTimeout(600);
await p.locator('div.fixed.inset-0 textarea').first().fill(TASKS); await p.waitForTimeout(1000);
await p.getByRole('button', { name: /^Add 4 to 2026-09-02/ }).click(); await p.waitForTimeout(2000);
const n2 = await p.evaluate(()=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-02']||'[]').filter(r=>!r._tomb).length);
console.log('pasted the same list twice ->', n2, 'jobs', n2===4?'(no duplicates)':'*** DUPLICATED ***');

console.log('\n=== MORNING (2026-09-01, today) ===');
await p.locator('input[type=date]').first().fill('2026-09-01'); await p.waitForTimeout(2500);
t = await p.innerText('body');
console.log('auto-locked:', /schedule closed when the date changed|Posted /.test(t) ? 'YES' : 'NO');
console.log('  ', (t.match(/Today — the schedule[^\n]*/)||[''])[0].slice(0,72));
const btn = p.getByRole('button', { name: /End-of-day review/ });
console.log('review button:', await btn.count() ? (await btn.first().innerText()).replace(/\n/g,' ') : 'MISSING');
await btn.first().click(); await p.waitForTimeout(1200);
t = await p.innerText('body');
console.log('dialog:', (t.match(/How did 2026-09-01 actually go\?[\s\S]{0,220}/)||[''])[0].split('\n').filter(Boolean).slice(0,4).join(' | '));
await p.screenshot({ path: `${SP}/S2-review.png` });
const before = await p.evaluate(()=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-01']).filter(r=>!r._tomb&&r.state==='fixed').length);
await p.locator('div.fixed.inset-0').getByRole('button', { name: 'Fixed', exact: true }).first().click(); await p.waitForTimeout(2000);
const after = await p.evaluate(()=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-01']).filter(r=>!r._tomb&&r.state==='fixed').length);
console.log('one-click Fixed:', before, '->', after, after===before+1?'OK':'FAILED');
const asked = await p.evaluate(()=>{
  const j=JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-01']).filter(r=>!r._tomb&&r.state==='fixed');
  return (j[j.length-1].events||[]).some(e=>e.lock);
});
console.log('recording an outcome demanded a reason:', asked ? '*** YES (wrong) ***' : 'no (correct)');
console.log('\nerrors:', errs.length?errs:'none');
await b.close();
