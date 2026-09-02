import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const TASKS = [
 'Number\tTitle\tProperty\tSubcategory\tPriority\tStatus\tAssignees\tDuration',
 'TSK397540\tVacant - Pending work Need to replace kitchen sink bottle trap with pipe hose - Second bed room bed side lamp not working - kitchen area ceiling light flickering P1-29, P1-30\tBayz Tower 809\tOthers\tMedium\tTo do\tYousoufu\t2h',
 'TSK401961\tIMP - Guest Gave 1 star , Full thorough Inspection along with Maintenance work , Guest reported broken drawers\tDamac Hills 2 Victoria 61\tOthers\tMedium\tTo do\tJabbar\t3h',
 'TSK365811\tCheck in- General inspection P3-80\tDowntowns Views 1 2604\tGeneral Inspection\tHigh\tTo do\tYousoufu\t1h',
].join('\n');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1300);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
const D='2026-09-25';
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(2200);
await p.getByRole('button', { name: /Paste the day in/ }).click(); await p.waitForTimeout(600);
await p.locator('div.fixed.inset-0 textarea').first().fill(TASKS); await p.waitForTimeout(1300);
await p.locator('div.fixed.inset-0').getByRole('button', { name: /^Add 3 to/ }).click(); await p.waitForTimeout(3000);
const stored = await p.evaluate((d)=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:'+d]).filter(r=>!r._tomb).map(j=>({
  ref:j.pmsRef, occ:j.status, park:j.parking, imp:j.escalated, src:j.source, d:j.description })), D);
console.log('WHAT THE PASTE READ OUT OF THE THREE REAL TITLES:');
stored.forEach(x=>{
  console.log('  '+x.ref, '| occ', (x.occ||'—').padEnd(9), '| park', (x.park||'—').padEnd(14), '| IMP', x.imp?'Y':'n', '| src', (x.src||'—').padEnd(7));
  console.log('      ->', x.d.slice(0,86));
});
const t = await p.innerText('body');
console.log('\nIMP badge on the card:', /\bIMP\b/.test(t) ? 'shown' : '*** MISSING ***');
console.log('review badge:', /review/.test(t) ? 'shown' : '*** MISSING ***');
await p.screenshot({ path: `${SP}/../escalation.png`, fullPage: true });
await p.getByRole('button', { name: 'Close out' }).first().click(); await p.waitForTimeout(1400);
const t2 = await p.innerText('body');
console.log('\nclose-out on the Bayz Tower title:', (t2.match(/This is \d+ jobs in one[^\n]*/)||['*** no checklist ***'])[0]);
console.log('  tick boxes:', await p.locator('div.fixed.inset-0').locator('input[type=checkbox]').count());
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await b.close();
