import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(900);
await p.locator('input[placeholder*="Ahmed"]').fill('Ahmed');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
await p.locator('input[type=date]').first().fill('2026-09-04'); await p.waitForTimeout(2200);
await p.locator('textarea').first().fill('Zed Tower 707 pool cleaning 1h Resty vacant');
await p.locator('textarea').first().press('Enter'); await p.waitForTimeout(2200);

// the row is the smallest element containing the job that also holds its buttons
// JobRow renders as a direct child of the group's .divide-y list
const rowText = () => p.evaluate(() => {
  const rows = [...document.querySelectorAll('.divide-y > div')]
    .filter(d => d.textContent.includes('Zed Tower 707'));
  return rows.length ? rows[0].innerText : '';
});
const expand = async () => {
  const btn = p.getByRole('button', { name: /^(more|less)$/ }).last();
  const label = await btn.innerText();
  if (label === 'more') { await btn.click(); await p.waitForTimeout(600); }
};

await expand();
let r = await rowText();
console.log('ROW TEXT BEFORE:', JSON.stringify(r).slice(0,600));
console.log('more/less buttons:', await p.getByRole('button', { name: /^(more|less)$/ }).count());
console.log('BEFORE close-out:');
console.log('   offers "Cancel this job":', /Cancel this job/.test(r) ? 'YES (correct)' : 'NO');

await p.locator('button[title^="Close out"]').last().click(); await p.waitForTimeout(800);
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.getByRole('button', { name: /^Fixed/ }).click(); await p.waitForTimeout(400);
await dlg.getByRole('button', { name: 'Close out', exact: true }).click(); await p.waitForTimeout(2200);
await expand();
r = await rowText();
console.log('AFTER close-out:');
console.log('   offers "Cancel this job":', /Cancel this job/.test(r) ? 'YES  <-- WRONG' : 'no (correct)');
console.log('   explains it stays on record:', /stays on the record/.test(r) ? 'YES' : 'no');
console.log('   card still visible:', /Zed Tower 707/.test(r) ? 'YES' : 'no');
console.log('   state chip:', (r.match(/^(Fixed|Scheduled|Made safe|Diagnosed)/m)||['?'])[0]);
const st = await p.evaluate(()=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-04']||'[]').filter(x=>!x._tomb).map(j=>j.state));
console.log('   stored:', JSON.stringify(st));
await p.screenshot({ path: `${SP}/K3-nodelete.png` });
console.log('errors:', errs.length?errs:'none');
await b.close();
