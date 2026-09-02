import { chromium } from 'playwright';
import fs from 'fs';
import { installKvStub } from '../harness/live-kv-stub.mjs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`, 'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1500 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 150)); });
let kvHits = 0;
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => {
  if (/rest\/v1\/kv_store/.test(r.request().url())) { kvHits++; return r.continue(); }
  return r.abort();
});
await installKvStub(p, seed);
await p.goto('http://127.0.0.1:4180/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(2000);
console.log("browser today:", await p.evaluate(()=>new Date().toISOString().slice(0,10)));
console.log("date box:", await p.locator('input[type=date]').first().inputValue());
console.log("kv requests so far:", kvHits);

// 1. a seeded day loads from the (stubbed) database
await p.locator('input[type=date]').first().fill('2026-09-01'); await p.waitForTimeout(3000);
let t = await p.innerText('body');
console.log('\n1. SEEDED DAY 2026-09-01');
console.log('   jobs:', (t.match(/(\d+) jobs?\b/)||['','?'])[1]);
console.log('   lock:', (t.match(/Today — the schedule[^\n]*|Posted [^\n]*|Not posted yet[^\n]*|already happened[^\n]*/)||['—'])[0].slice(0,72));
console.log('   attribution:', (t.match(/Built by[^\n]*|Nothing recorded[^\n]*/)||['(none yet — imported rows have no author)'])[0].slice(0,80));
console.log('   review button:', (t.match(/End-of-day review[^\n]*/)||['MISSING'])[0]);

// 2. paste the daily sheet onto a future day
const SHEET = ['Date\tShift\tTeam / Technician\tProperty\tUnit / Villa No.\tStatus\tParking No.\tTime of Visit\tGuest Confirmed\tTask Description (Scope of Work)\tMaterial Needed? (Y/N)\tMaterial Details (what + qty)\tEstimated Time\tPending? (Y/N)\tPending Details\tPriority\tNotes\tIn PMS? (Y/N)\tPMS Ticket / Task Ref',
 '2026-09-15\t09:00-18:00\tVitalis\tLIV Marina\t2604\tVacant\tP3-97\t\tN\tLaundry room door is broken\tY\tHinges\t1 hr 30 mins\tN\t\tP3-Medium\t\tY\tTSK401330',
 '2026-09-15\t12:00-21:00\tYousoufu\tGrande\t2702\tOccupied - GC\t\t2-4pm\tY\tClogged sink\tN\t\t30 Mins\tN\t\tP2-High\t\tY\tTSK401999'].join('\n');
await p.getByRole('button', { name: /Paste the day in/ }).click(); await p.waitForTimeout(700);
await p.locator('div.fixed.inset-0 textarea').first().fill(SHEET); await p.waitForTimeout(1400);
t = await p.innerText('body');
console.log('\n2. PASTE THE DAY IN');
console.log('   format:', /daily sheet/.test(t) ? 'daily sheet' : /PMS task list/.test(t) ? 'PMS task list' : 'NOT DETECTED');
console.log('   date warning:', /carry their own dates/.test(t) ? 'shown' : 'missing');
await p.locator('div.fixed.inset-0').getByRole('button', { name: /^Add 2 to/ }).click(); await p.waitForTimeout(3000);
t = await p.innerText('body');
console.log('   landed on:', await p.locator('input[type=date]').first().inputValue());
console.log('   jobs now:', (t.match(/(\d+) jobs?\b/)||['','?'])[1]);
console.log('   appointment read from GC prefix:', /2-4pm/.test(t) ? 'yes' : 'no');

// 3. no delete, no Other
await p.getByRole('button', { name: /^(more|less)$/ }).first().click(); await p.waitForTimeout(800);
const opts = [];
for (const s of await p.locator('select').all()) opts.push(...await s.locator('option').allTextContents());
console.log('\n3. HOUSEKEEPING');
console.log('   "Other" options on the board:', opts.filter(o => /^other/i.test(o.trim())).length);
console.log('   "Delete" anywhere on the page:', /\bDelete\b/.test(await p.innerText('body')) ? '*** present ***' : 'none');
console.log('   Cancel this job offered:', /Cancel this job/.test(await p.innerText('body')) ? 'yes' : 'no');

// 4. close-out demands the words when nothing on the list fits
await p.getByRole('button', { name: 'Not done', exact: true }).first().click(); await p.waitForTimeout(1200);
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.locator('select').first().selectOption({ label: 'None of these — say what happened' }); await p.waitForTimeout(400);
await dlg.locator('input[type=radio]').first().check(); await p.waitForTimeout(300);
const mark = dlg.getByRole('button', { name: 'Mark not done' });
console.log('\n4. CLOSE-OUT');
console.log('   asks when it happens instead:', /When does it happen instead/.test(await p.innerText('body')) ? 'yes' : 'no');
console.log('   blocked until the words are typed:', await mark.isDisabled() ? 'yes' : '*** no ***');
await dlg.locator('input[placeholder*="own words"]').fill('Building lift out of service'); await p.waitForTimeout(400);
console.log('   unblocked after typing:', await mark.isDisabled() ? '*** still blocked ***' : 'yes');
await mark.click(); await p.waitForTimeout(3000);
console.log('   toast:', ((await p.innerText('body')).match(/Booked again for [^\n]*|Not done[^\n]*/)||['—'])[0].slice(0,50));

console.log('\nkv requests total:', kvHits);
console.log('errors:', errs.length ? errs : 'none');
await p.screenshot({ path: `${SP}/LIVE-full.png`, fullPage: true });
await b.close();
