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
// give the Afnan jobs measured time so labour is real, not estimated
await p.evaluate(() => {
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  const now = Date.now(); let n=0;
  Object.keys(kv).filter(k=>k.startsWith('schedule:')).forEach(k=>{
    const rows = JSON.parse(kv[k]); let touched=false;
    rows.forEach(j=>{ if(/afnan/i.test(j.property||'') && n<3){ j.events=[{at:now-190*60000,kind:'started',by:'Adi'},{at:now,kind:'done',by:'Adi'}]; j.state='done'; n++; touched=true; } });
    if(touched) kv[k]=JSON.stringify(rows);
  });
  localStorage.setItem('__dhh_mock_kv__', JSON.stringify(kv));
});
await p.reload(); await p.waitForTimeout(1000);
await p.locator('input[placeholder*="Ahmed"]').fill('Ahmed');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
await p.getByRole('button', { name: 'Projects', exact: true }).click(); await p.waitForTimeout(2500);
await p.getByRole('button', { name: /New project/ }).click(); await p.waitForTimeout(500);
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.locator('input[type=text], input:not([type])').nth(0).fill('Afnan 5 603 onboarding');
await dlg.locator('input[type=text], input:not([type])').nth(1).fill('Afnan 5');
await dlg.locator('input[type=text], input:not([type])').nth(2).fill('603');
await dlg.locator('input[type=text], input:not([type])').nth(3).fill('PC-2026-08-23');
await dlg.locator('input[type=number]').first().fill('8500');
await dlg.getByRole('button', { name: 'Save project' }).click();
await p.waitForTimeout(1500);

await p.getByRole('button', { name: /^Linked jobs/ }).click(); await p.waitForTimeout(900);
const linkBtn = () => p.getByRole('button', { name: 'link', exact: true });
console.log('suggested jobs to link:', await linkBtn().count());
let n=0;
while (await linkBtn().count()) { await linkBtn().first().click(); await p.waitForTimeout(900); n++; if(n>8) break; }
console.log('linked:', n);
const st = () => p.evaluate(()=>{const pr=JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['projects']||'[]');return (pr[0]?.linkedJobIds||[]).length;});
console.log('persisted linkedJobIds:', await st());

await p.getByRole('button', { name: /^Material \(/ }).click(); await p.waitForTimeout(800);
async function addMat(item, qty, cost) {
  await p.locator('input[placeholder*="Honeywell"]').first().fill(item);
  await p.waitForTimeout(400);
  const nums = p.locator('input[type=number]');
  await nums.nth(0).fill(qty);
  if (cost !== null) await nums.nth(1).fill(cost);
  await p.getByRole('button', { name: 'Add', exact: true }).first().click();
  await p.waitForTimeout(1000);
}
await addMat('Paint 4 litres','4','55');
await addMat('Honeywell thermostat','2','210');
await addMat('Honeywell thermostat','1','200');
await addMat('Honeywell thermostat','1','215');
await p.locator('input[placeholder*="Honeywell"]').first().fill('Honeywell Ac thermostat 220v');
await p.waitForTimeout(900);
const tt = await p.innerText('body');
console.log('price memory:', (tt.match(/Filled from memory[^\n]*/)||tt.match(/Seen \d+ time[^\n]*/)||['(none)'])[0].slice(0,150));
console.log('auto-filled unit cost:', await p.locator('input[type=number]').nth(1).inputValue());
await p.screenshot({ path: `${SP}/F9-material.png` });

const t = await p.innerText('body');
console.log('\nPROJECT CARD:');
['LABOUR','MATERIAL','OUR COST','QUOTED','MARGIN'].forEach(k=>{
  const mm = t.match(new RegExp(k+'\\n([^\\n]*)\\n?([^\\n]*)\\n?([^\\n]*)'));
  if(mm) console.log('  ', k.padEnd(10), [mm[1],mm[2],mm[3]].filter(Boolean).join(' | '));
});
console.log('forecast caveat shown:', /rests mostly on estimated hours/.test(t)?'yes':'no');
await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(500);
await p.screenshot({ path: `${SP}/F10-project.png` });
console.log('errors:', errs.length?errs:'none');
await b.close();
