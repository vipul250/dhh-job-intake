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
await p.locator('input[type=date]').first().fill('2026-08-22'); await p.waitForTimeout(2500);

const day = async (d) => p.evaluate((dd) => {
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  const r = JSON.parse(kv['schedule:'+dd]||'[]');
  return { jobs: r.filter(x=>!x._tomb).length, tombs: r.filter(x=>x._tomb).length };
}, d);
console.log('BEFORE  08-22:', JSON.stringify(await day('2026-08-22')), ' 08-23:', JSON.stringify(await day('2026-08-23')));

await (await p.getByRole('button', { name: /Order of work/ }).all())[0].click();
await p.waitForTimeout(800);
await p.getByRole('button', { name: /Move these 3 to tomorrow/ }).click();
await p.waitForTimeout(2500);
console.log('AFTER   08-22:', JSON.stringify(await day('2026-08-22')), ' 08-23:', JSON.stringify(await day('2026-08-23')));
const t1 = await p.innerText('body');
console.log('left-this-day now lists them:', /Left this day \(3\)/.test(t1) ? 'YES' : (t1.match(/Left this day \(\d+\)/)||['no'])[0]);

// technician suggestion on an unassigned job
await p.locator('textarea').first().fill('Palm Villa E41 replace bathroom mixer 1h occupied p2');
await p.locator('textarea').first().press('Enter');
await p.waitForTimeout(1800);
const wand = p.locator('button[title="Suggest a technician using the scheduling rule"]');
console.log('suggest buttons (unassigned jobs):', await wand.count());
if (await wand.count()) {
  await wand.first().click();
  await p.waitForTimeout(700);
  const t2 = await p.innerText('body');
  const seg = t2.match(/By the rule[\s\S]{0,420}/)?.[0]||'';
  console.log(seg.split('\n').filter(Boolean).slice(0,8).join('\n'));
  await p.evaluate(()=>window.scrollTo(0,99999)); await p.waitForTimeout(400);
  await p.screenshot({ path: `${SP}/P2-suggest.png` });
}
console.log('errors:', errs.length?errs:'none');
await b.close();
