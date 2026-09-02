import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1200 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) errs.push('CONSOLE '+m.text()); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(900);
await p.locator('input[placeholder*="Ahmed"]').fill('Ahmed');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
await p.locator('input[type=date]').first().fill('2026-09-01'); await p.waitForTimeout(2500);

const day = (d) => p.evaluate((dd)=>{const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__'));const r=JSON.parse(kv['schedule:'+dd]||'[]');return r.filter(x=>!x._tomb);}, d);

// ---------- A. out-of-hours job logged against last night ----------
await p.getByRole('button', { name: /Log an out-of-hours job/ }).click(); await p.waitForTimeout(700);
let dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.locator('input[type=date]').fill('2026-08-31');
await dlg.locator('input[placeholder*="Marina Gate"]').fill('Marina Gate 2 3705 water leak from washroom ceiling 1h Anthony occupied');
await p.waitForTimeout(500);
const inputs = dlg.locator('input');
await dlg.locator('input[placeholder="night technician"]').fill('Anthony');
await dlg.locator('input[placeholder="support agent"]').fill('Tiyana');
await dlg.locator('input[placeholder="TSK401787"]').fill('TSK401999');
await p.screenshot({ path: `${SP}/N1-nightlog.png` });
await dlg.getByRole('button', { name: /Log it against/ }).click();
await p.waitForTimeout(2000);
const night = (await day('2026-08-31')).filter(j=>j.source==='emergency');
console.log('A) out-of-hours job logged:', night.length ? 'YES' : 'NO');
if (night[0]) console.log('   ', JSON.stringify({prop:night[0].property, unit:night[0].unit, tech:night[0].team, src:night[0].source, unplanned:night[0].unplanned, by:night[0].reportedBy, how:night[0].howReported, pms:night[0].pmsRef, pri:night[0].priority}));

// ---------- B. the valve case: close out as made safe -> follow-up ----------
await p.locator('input[type=date]').first().fill('2026-08-31'); await p.waitForTimeout(2500);
const closeBtns = await p.locator('button[title^="Close out"]').all();
console.log('B) close-out buttons on the board:', closeBtns.length);
await closeBtns[0].click(); await p.waitForTimeout(800);
dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.locator('textarea').fill(`Arrived @ 11:20pm
Finished @ 11:55pm
- guest reported water leak from washroom ceiling.
- closed the valve to stop the leak for now.
- water heater is damaged and needs replacement, ceiling needs paint after.`);
await p.waitForTimeout(900);
let t = await p.innerText('body');
console.log('   parsed banner:', (t.match(/On site[^\n]*/)||[''])[0].slice(0,120));
console.log('   suggestion:', /Reads like/.test(t) ? (t.match(/Reads like[\s\S]{0,80}/)||[''])[0].replace(/\n/g,' ') : 'none');
console.log('   follow-up block forced open:', /book the visit that finishes it/.test(t) ? 'YES':'NO');
await p.screenshot({ path: `${SP}/N2-closeout.png` });
const needField = dlg.locator('input[placeholder*="water heater"]');
console.log('   "still needed" prefilled:', JSON.stringify((await needField.inputValue()).slice(0,90)));
await dlg.getByRole('button', { name: /Close and book/ }).click();
await p.waitForTimeout(2500);

const d31 = await day('2026-08-31');
const parent = d31.find(j=>j.state==='made_safe');
console.log('   parent state:', parent?.state, '| stillNeeded:', JSON.stringify((parent?.stillNeeded||'').slice(0,70)), '| followUpJobId set:', !!parent?.followUpJobId, '| actualMinutes:', parent?.actualMinutes);
const d01 = await day('2026-09-01');
const child = d01.find(j=>j.followUpOf);
console.log('   follow-up created on 09-01:', child ? 'YES' : 'NO');
if (child) console.log('    ', JSON.stringify({prop:child.property, unit:child.unit, desc:(child.description||'').slice(0,60), pri:child.priority, src:child.source, mat:(child.materialDetails||'').slice(0,50), from:child.followUpOf.date}));
console.log('   chain intact:', parent?.followUpJobId === child?.id ? 'YES' : 'NO');

// ---------- C. dashboard picks it up ----------
await p.getByRole('button', { name: 'Dashboard', exact: true }).click(); await p.waitForTimeout(600);
const ins = await p.$$('input[type=date]');
await ins[1].fill('2026-08-18'); await ins[2].fill('2026-09-01'); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Load range/ }).click();
await p.waitForFunction(()=>document.body.innerText.includes('The range:'), null, {timeout:60000});
await p.waitForTimeout(1500);
t = await p.innerText('body');
console.log('\nC) dashboard');
console.log('   "Stopped, not finished":', /Stopped, not finished/.test(t)?'present':'MISSING');
console.log('   ', (t.match(/Open containments\n[^\n]*\n[^\n]*/)||[''])[0].replace(/\n/g,' | '));
console.log('   ', (t.match(/Follow-up booked\n[^\n]*\n[^\n]*/)||[''])[0].replace(/\n/g,' | '));
console.log('   "Where the work comes from":', /Where the work comes from/.test(t)?'present':'MISSING');
console.log('   ', (t.match(/Arrived, not planned\n[^\n]*\n[^\n]*/)||[''])[0].replace(/\n/g,' | '));
await p.evaluate(()=>window.scrollTo(0,1350)); await p.waitForTimeout(700);
await p.screenshot({ path: `${SP}/N3-containment.png` });
console.log('errors:', errs.length?errs:'none');
await b.close();
