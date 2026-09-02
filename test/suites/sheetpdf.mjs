/* The daily sheet as it actually arrives: copied off the locked PDF, so
   spaces instead of tabs and rows wrapped over several lines. Pasted into
   the quick-add box it used to become one job per line with the year as
   the unit number; here it must be caught, redirected, and read properly. */
import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const sheet = fs.readFileSync(`${SP}/day0903.txt`,'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1500 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,160)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1300);
await p.locator('input[placeholder*="Ahmed"]').fill('Tiyana');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
const D = '2026-09-03';
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(2200);

console.log('=== PASTED INTO THE WRONG BOX ===');
await p.locator('textarea').first().fill(sheet); await p.waitForTimeout(1600);
let t = await p.innerText('body');
console.log('  caught:', /That is the daily sheet, not a single job/.test(t) ? 'yes' : '*** NOT CAUGHT — would mangle ***');
console.log('  no per-line preview shown:', /Read as —/.test(t) ? '*** preview leaked ***' : 'correct');
await p.getByRole('button', { name: 'Read it as the daily sheet' }).click(); await p.waitForTimeout(2500);
t = await p.innerText('body');
console.log('  redirected to the sheet reader:', /Paste the day in/.test(t) ? 'yes' : '*** NO ***');
console.log('  ', (t.match(/\d+\s+row[^\n]{0,70}/) || t.match(/\d+ job[^\n]{0,60}/) || ['(no count shown)'])[0]);
await p.screenshot({ path: `${SP}/../sheetpdf-dialog.png`, fullPage: false });

/* The five Palm villas must survive as five distinct villas. */
const body = await p.innerText('body');
for (const u of ['E41','O56','O103','F30','L14'])
  console.log(`  villa ${u}:`, body.includes(u) ? 'read' : '*** LOST ***');
console.log('  year-as-unit "2026" present:', /\b2026\b/.test(body.replace(/2026-\d\d-\d\d/g,'')) ? '*** STILL THERE ***' : 'gone');

const commit = p.getByRole('button', { name: /Add .*job|Add these|Add \d+/ });
if (await commit.count()) { await commit.first().click(); await p.waitForTimeout(3000); }
t = await p.innerText('body');
console.log('\n=== ON THE BOARD ===');
console.log('  Palm villa cards:', (t.match(/Palm villa/gi)||[]).length);
console.log('  mis-read banner (should be absent now):',
  /were read wrong/.test(t) ? '*** banner fired on clean data ***' : 'absent, correct');
console.log('  Resty job count:', (t.match(/Resty\s+(\d+) jobs?/)||['?','?'])[1]);
await p.screenshot({ path: `${SP}/../sheetpdf-board.png`, fullPage: true });
console.log('\nerrors:', errs.length ? errs.slice(0,5) : 'none');
await b.close();
