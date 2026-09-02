import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const paste = fs.readFileSync(`${SP}/paste.tsv`,'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('http://127.0.0.1:4173/');
await p.evaluate(() => localStorage.removeItem('__dhh_mock_kv__'));
await p.reload(); await p.waitForTimeout(1200);

await p.getByRole('button', { name: 'Import Sheet', exact: true }).click(); await p.waitForTimeout(500);
await p.locator('textarea').fill(paste);
await p.getByRole('button', { name: /Read the paste/ }).click();
await p.waitForTimeout(1500);
const t1 = await p.innerText('body');
console.log('SUMMARY:', t1.match(/\d+ job\(s\) read across \d+ date\(s\)[^\n]*/)?.[0]);
console.log('PREVIEW:', (t1.match(/Time estimates readable[\s\S]{0,200}/)?.[0]||'').replace(/\n+/g,' | '));
await p.screenshot({ path: `${SP}/11-import.png` });

await p.getByRole('button', { name: /Add \d+ job\(s\) to the board/ }).click();
await p.waitForFunction(()=>document.body.innerText.includes('Imported'), null, {timeout:60000});
await p.waitForTimeout(1000);
console.log('RESULT:', (await p.innerText('body')).match(/Imported [^\n]*\n[^\n]*/)?.[0].replace(/\n/g,' | '));

const kv = await p.evaluate(() => JSON.parse(localStorage.getItem('__dhh_mock_kv__')));
const dates = Object.keys(kv).filter(k=>k.startsWith('schedule:'));
const totalJobs = dates.reduce((s,k)=>s+JSON.parse(kv[k]).length,0);
console.log('STORED:', dates.length, 'dates,', totalJobs, 'jobs');
const sample = JSON.parse(kv['schedule:2026-08-18'])[0];
console.log('SAMPLE:', JSON.stringify({property:sample.property,unit:sample.unit,team:sample.team,estimatedTime:sample.estimatedTime,priority:sample.priority,guestConfirmed:sample.guestConfirmed,materialNeeded:sample.materialNeeded}));

// dashboard on the imported data
await p.getByRole('button', { name: 'Dashboard', exact: true }).click(); await p.waitForTimeout(500);
const ins = await p.$$('input[type=date]');
await ins[1].fill('2026-08-18'); await ins[2].fill('2026-09-01'); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Load range/ }).click();
await p.waitForFunction(()=>document.body.innerText.includes('The range:'), null, {timeout:60000});
await p.waitForTimeout(1200);
const t=await p.innerText('body');
console.log('RANGE:', t.match(/The range: [^\n]*/)?.[0]);
console.log('LOAD:', t.match(/Planned load vs capacity\n[^\n]*/)?.[0].replace(/\n/g,' = '));
console.log('OVERLOAD:', t.match(/Tech-days over\ncapacity\n[^\n]*/)?.[0].replace(/\n/g,' '));
console.log('errors:', errs.length?errs:'none');
await b.close();
