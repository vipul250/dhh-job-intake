import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const SHEET = [
 'Date\tShift\tTeam / Technician\tProperty\tUnit / Villa No.\tStatus\tParking No.\tTime of Visit\tGuest Confirmed\tTask Description (Scope of Work)\tMaterial Needed? (Y/N)\tMaterial Details (what + qty)\tEstimated Time\tPending? (Y/N)\tPending Details\tPriority\tNotes\tIn PMS? (Y/N)\tPMS Ticket / Task Ref',
 '2026-09-03\t09:00-18:00\tVitalis\tLIV Marina\t2604\tVacant\tP3-97\t\tN\tLaundry room door is broken\tY\tHinges\t1 hr 30 mins\tN\t\tP3-Medium\t\tY\tTSK401330',
 '2026-09-03\t12:00-21:00\tYousoufu\tGrande\t2702\tOccupied - GC\t\t2-4pm\tY\tClogged sink in guest bathroom\tN\t\t30 Mins\tN\t\tP2-High\t\tY\tTSK401999',
 '2026-09-03\t09:00-18:00\tBright\tDamac Heights\t7702\tB2B\t\t\tN\tPaint touch up\tY\tPaint, putty\t1 hr\tN\t\tP3-Medium\t\tN\t',
].join('\n');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,150)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1100);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(800);

// on 09-01, paste a sheet dated 09-03
await p.locator('input[type=date]').first().fill('2026-09-01'); await p.waitForTimeout(2200);
await p.getByRole('button', { name: /Paste the day in/ }).click(); await p.waitForTimeout(600);
await p.locator('div.fixed.inset-0 textarea').first().fill(SHEET); await p.waitForTimeout(1300);
let t = await p.innerText('body');
console.log('format badge:', /daily sheet/.test(t) ? 'daily sheet' : /PMS task list/.test(t) ? 'PMS task list' : 'MISSING');
console.log('summary:', (t.match(/\d+ task\(s\) read[\s\S]{0,120}/)||[''])[0].split('\n').filter(Boolean).slice(0,4).join(' | '));
console.log('date warning:', /carry their own dates/.test(t) ? 'SHOWN' : 'MISSING');
console.log('  ', (t.match(/These rows carry their own dates[^\n]*/)||[''])[0].slice(0,95));
const btn = p.locator('div.fixed.inset-0').getByRole('button', { name: /^Add 3 to/ });
console.log('button:', await btn.innerText());
await p.screenshot({ path: `${SP}/S3-sheetpaste.png` });
await btn.click(); await p.waitForTimeout(2800);
const stored = await p.evaluate(()=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  return {
    on0903: JSON.parse(kv['schedule:2026-09-03']||'[]').filter(r=>!r._tomb).map(j=>({p:j.property+' '+j.unit,occ:j.status,t:j.timeOfVisit,tech:j.team,est:j.estimatedTime,ref:j.pmsRef,pri:j.priority,mat:j.materialDetails})),
    on0901: JSON.parse(kv['schedule:2026-09-01']||'[]').filter(r=>!r._tomb&&(r.source==='sheet'||['TSK401330','TSK401999'].includes(r.pmsRef))).length,
  };
});
console.log('\nlanded on 2026-09-03:'); stored.on0903.forEach(x=>console.log('  ', JSON.stringify(x)));
console.log('leaked onto 2026-09-01:', stored.on0901, stored.on0901===0?'(none — correct)':'*** WRONG DAY ***');
console.log('board switched to:', await p.locator('input[type=date]').first().inputValue());

// paste again -> no duplicates
await p.getByRole('button', { name: /Paste the day in/ }).click(); await p.waitForTimeout(600);
await p.locator('div.fixed.inset-0 textarea').first().fill(SHEET); await p.waitForTimeout(1200);
await p.locator('div.fixed.inset-0').getByRole('button', { name: /^Add 3 to/ }).click(); await p.waitForTimeout(2500);
const n = await p.evaluate(()=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-03']||'[]').filter(r=>!r._tomb).length);
console.log('after second identical paste:', n, 'jobs', n===3?'(all 3 skipped — no duplicates)':'*** DUPLICATED ***');
console.log('\nerrors:', errs.length?errs:'none');
await b.close();
