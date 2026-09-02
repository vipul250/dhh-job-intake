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

// what actually repeats in the real data? Gemz by Danube 801 pool cleaning
await p.locator('input[type=date]').first().fill('2026-09-01'); await p.waitForTimeout(2500);
await p.locator('textarea').first().fill('Gemz by Danube 801 Pool Cleaning 1h Resty occupied');
await p.locator('textarea').first().press('Enter');
await p.waitForTimeout(4500);
let t = await p.innerText('body');
const prompted = /visited recently for similar work/.test(t);
console.log('1) return prompt on a genuine repeat:', prompted ? 'YES' : 'NO');
if (prompted) {
  console.log('   ', (t.match(/Last visited [^\n]*/)||[''])[0].slice(0,120));
  await p.evaluate(()=>window.scrollTo(0,120)); await p.waitForTimeout(400);
  await p.screenshot({ path: `${SP}/F5-return.png` });
  await p.getByRole('button', { name: 'Recurring service (PPM)' }).first().click();
  await p.waitForTimeout(1800);
  const saved = await p.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-01']).filter(j=>j.returnReason).map(j=>({unit:j.unit, reason:j.returnReason, of:j.returnOf?.date})));
  console.log('   saved:', JSON.stringify(saved));
}

// 4) measured duration — inject realistic Start/Done timestamps, then read the UI
await p.evaluate(() => {
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  const rows = JSON.parse(kv['schedule:2026-09-01']);
  const now = Date.now();
  let n = 0;
  rows.forEach((j) => {
    if (j._tomb || n >= 12) return;
    const mins = [35, 50, 70, 95, 120, 45, 60, 80, 25, 110, 55, 65][n];
    j.events = [...(j.events||[]), { at: now - mins*60000 - 3600000, kind:'started', by:'Vitalis' },
                                   { at: now - 3600000, kind:'done', by:'Vitalis' }];
    j.state = 'done';
    n++;
  });
  kv['schedule:2026-09-01'] = JSON.stringify(rows);
  localStorage.setItem('__dhh_mock_kv__', JSON.stringify(kv));
  const vs = JSON.parse(localStorage.getItem('__dhh_mock_v__')||'{}');
  vs['schedule:2026-09-01'] = new Date().toISOString()+Math.random();
  localStorage.setItem('__dhh_mock_v__', JSON.stringify(vs));
});
await p.reload(); await p.waitForTimeout(1200);
await p.locator('input[type=date]').first().fill('2026-09-01'); await p.waitForTimeout(2500);
t = await p.innerText('body');
const tooks = t.match(/took \d+[hm]/g) || [];
console.log('4) cards showing measured duration:', tooks.length, tooks.slice(0,5).join(', '));

// dashboard: tech times + why we go back
await p.getByRole('button', { name: 'Dashboard', exact: true }).click(); await p.waitForTimeout(600);
const ins = await p.$$('input[type=date]');
await ins[1].fill('2026-08-18'); await ins[2].fill('2026-09-01'); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Load range/ }).click();
await p.waitForFunction(()=>document.body.innerText.includes('The range:'), null, {timeout:60000});
await p.waitForTimeout(1500);
t = await p.innerText('body');
console.log('   "Why we keep going back" section:', /Why we keep going back/.test(t)?'present':'MISSING');
console.log('   "How long jobs actually take":', /How long jobs actually take/.test(t)?'present':'MISSING');
console.log('   ', (t.match(/Jobs with measured time\n[^\n]*\n[^\n]*/)||[''])[0].replace(/\n/g,' | '));
console.log('   ', (t.match(/Reason recorded\n[^\n]*\n[^\n]*/)||[''])[0].replace(/\n/g,' | '));
console.log('   daily-ops scope note:', /daily field operations only/.test(t)?'present':'MISSING');
await p.evaluate(()=>window.scrollTo(0,1700)); await p.waitForTimeout(600);
await p.screenshot({ path: `${SP}/F7-why.png` });
await p.evaluate(()=>window.scrollTo(0,2600)); await p.waitForTimeout(600);
await p.screenshot({ path: `${SP}/F8-times.png` });
console.log('errors:', errs.length?errs:'none');
await b.close();
