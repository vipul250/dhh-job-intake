import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1200 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1000);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(800);
await p.locator('input[type=date]').first().fill('2026-09-07'); await p.waitForTimeout(2000);
await p.locator('textarea').first().fill('Gamma Tower 303 ac not cooling 1h Nizar occupied p2');
await p.locator('textarea').first().press('Enter'); await p.waitForTimeout(1800);

// open the not-done path
await p.getByRole('button', { name: /^(more|less)$/ }).first().click(); await p.waitForTimeout(600);
const nd = p.getByRole('button', { name: 'Not done', exact: true }).first();
console.log('not-done button:', await nd.count());
await nd.click(); await p.waitForTimeout(1200);
let t = await p.innerText('body');
console.log('asks when instead:', /When does it happen instead\?/.test(t) ? 'YES' : 'NO');
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
const btn = dlg.getByRole('button', { name: 'Mark not done' });
console.log('blocked until answered:', await btn.isDisabled() ? 'YES' : 'no');
await p.screenshot({ path: `${SP}/N4-notdone.png` });
await dlg.locator('input[type=radio]').first().check(); await p.waitForTimeout(400);
console.log('unblocked after answering:', await btn.isDisabled() ? 'still blocked' : 'YES');
await btn.click(); await p.waitForTimeout(2500);
t = await p.innerText('body');
console.log('toast:', (t.match(/Booked again for [^\n]*/)||['MISSING'])[0]);
const stored = await p.evaluate(()=>{
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  const a = JSON.parse(kv['schedule:2026-09-07']||'[]');
  const nx = JSON.parse(kv['schedule:2026-09-08']||'[]');
  return {
    today: a.map(j=>({s:j.state, rebook:(j.events||[]).map(e=>e.rebook).filter(Boolean), child:!!j.followUpJobId})),
    tomorrow: nx.map(j=>({d:j.description, of:j.followUpOf?.outcome, src:j.source})),
  };
});
console.log('stored:', JSON.stringify(stored));

// and the "not rebooking" branch
await p.locator('textarea').first().fill('Delta Tower 404 door handle loose 30 mins Kofi vacant p4');
await p.locator('textarea').first().press('Enter'); await p.waitForTimeout(1800);
const cards = p.locator('button[title="Move to another day"]');
await p.getByRole('button', { name: /^(more|less)$/ }).last().click(); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Not done', exact: true }).last().click(); await p.waitForTimeout(1000);
const d2 = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await d2.locator('input[type=radio]').nth(2).check(); await p.waitForTimeout(400);
t = await p.innerText('body');
console.log('drop warning:', /recorded as a decision, not an oversight/.test(t) ? 'SHOWN' : 'MISSING');
await d2.getByRole('button', { name: 'Mark not done' }).click(); await p.waitForTimeout(2000);
const s2 = await p.evaluate(()=>{
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  return JSON.parse(kv['schedule:2026-09-07']||'[]').map(j=>({p:j.property,s:j.state,r:(j.events||[]).map(e=>e.rebook).filter(Boolean)}));
});
console.log('after drop:', JSON.stringify(s2));
console.log('errors:', errs.length?errs:'none');
await b.close();
