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
await p.reload(); await p.waitForTimeout(1200);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);

// ---- POST LOCK on a future day
await p.locator('input[type=date]').first().fill('2026-09-05'); await p.waitForTimeout(2200);
await p.locator('textarea').first().fill('Alpha Tower 101 pool cleaning 1h Resty vacant p3');
await p.locator('textarea').first().press('Enter'); await p.waitForTimeout(1800);
await p.locator('textarea').first().fill('Beta Tower 202 water leak from ceiling 1h Vitalis occupied p1');
await p.locator('textarea').first().press('Enter'); await p.waitForTimeout(1800);
let t = await p.innerText('body');
console.log('BEFORE POST:', /Not posted yet/.test(t) ? 'shows "Not posted yet"' : 'MISSING');
await p.getByRole('button', { name: /^Post 2026-09-05/ }).click(); await p.waitForTimeout(1800);
t = await p.innerText('body');
console.log('AFTER POST :', (t.match(/Posted [^\n]*/)||['MISSING'])[0].slice(0,80));

// editing a posted day must ask why
await p.getByRole('button', { name: /^(more|less)$/ }).first().click(); await p.waitForTimeout(600);
const est = p.locator('input[placeholder="1 hr"]').first();
await est.fill('2 hr'); await est.blur(); await p.waitForTimeout(900);
t = await p.innerText('body');
console.log('EDIT ON POSTED DAY asks why:', /Changing a posted schedule/.test(t) ? 'YES' : 'NO');
await p.screenshot({ path: `${SP}/J1-changereason.png` });
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.locator('select').selectOption('New guest complaint');
await dlg.getByRole('button', { name: 'Save the change' }).click(); await p.waitForTimeout(1800);

// ---- PAST DAY is locked too
await p.locator('input[type=date]').first().fill('2026-08-30'); await p.waitForTimeout(2500);
t = await p.innerText('body');
console.log('\nPAST DAY (30 Aug):', /already happened/.test(t) ? 'locked, warns' : 'NOT LOCKED');
console.log('  ', (t.match(/This day has already happened[^\n]*/)||[''])[0].slice(0,60));

// ---- DISPLACEMENT capture
await p.locator('input[type=date]').first().fill('2026-09-05'); await p.waitForTimeout(2200);
console.log('  move buttons on 09-05:', await p.locator('button[title="Move to another day"]').count());
console.log('  jobs line:', (await p.innerText('body')).match(/\d+ jobs/)?.[0]);
await p.locator('button[title="Move to another day"]').first().click(); await p.waitForTimeout(1500);
console.log('  modal open:', await p.locator('div.fixed.inset-0').count());
console.log('  modal text:', ((await p.innerText('body')).match(/Move [A-Z][\s\S]{0,180}/)||[''])[0].split('\n').filter(Boolean).slice(0,4).join(' | '));
const md = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await md.locator('select').first().selectOption('new-appointment');
await p.waitForTimeout(700);
t = await p.innerText('body');
console.log('\nMOVE — asks what took the slot:', /What took the slot\?/.test(t) ? 'YES' : 'NO');
const canMoveBefore = await md.getByRole('button', { name: /^Move to / }).isDisabled();
console.log('  blocked until answered:', canMoveBefore ? 'YES' : 'no');
const sels = md.locator('select');
const opts = await sels.nth(1).locator('option').allTextContents();
console.log('  can pick the job that took it:', opts.length > 1 ? `YES (${opts.length-1} options)` : 'no');
await sels.nth(1).selectOption({ index: 1 });
await p.waitForTimeout(700);
t = await p.innerText('body');
console.log('  priority warning:', /Worth a second look/.test(t) ? 'SHOWN' : 'not applicable');
await p.screenshot({ path: `${SP}/J2-displacement.png` });
await md.getByRole('button', { name: /^Move to / }).click(); await p.waitForTimeout(2500);
const stored = await p.evaluate(()=>{
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  const a = JSON.parse(kv['schedule:2026-09-05']||'[]');
  const bnext = JSON.parse(kv['schedule:2026-09-06']||'[]');
  return {
    tomb: a.filter(r=>r._tomb).map(t=>({reason:t.reason, madeWayFor:t.displacedBy?.label?.slice(0,40)})),
    winner: a.filter(r=>!r._tomb && (r.displaced||[]).length).map(j=>({j:j.property, took:j.displaced.length})),
    moved: bnext.map(j=>({j:j.property, bumpedBy:j.displacedBy?.label?.slice(0,40), by:j.displacedBy?.by})),
  };
});
console.log('  stored:', JSON.stringify(stored));
console.log('errors:', errs.length?errs:'none');
await b.close();
