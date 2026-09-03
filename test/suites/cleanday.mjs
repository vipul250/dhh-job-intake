/* "Start this day again" — the one thing that takes rows off a day, and
   the re-paste dedupe that is supposed to make it unnecessary. */
import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const sheet = fs.readFileSync(`${SP}/day0903.txt`,'utf8');
const D = '2026-09-03';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1500 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,160)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1300);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(2200);

const count = async () => p.evaluate((d)=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__')||'{}');
  return JSON.parse(kv['schedule:'+d]||'[]').filter(r=>!r._tomb).length;
}, D);

async function paste(text) {
  await p.getByRole('button', { name: /Paste the day in/ }).click(); await p.waitForTimeout(900);
  await p.locator('div.fixed.inset-0 textarea').first().fill(text); await p.waitForTimeout(2500);
  const add = p.getByRole('button', { name: /Add .*job|Add these|Add \d+/ });
  if (await add.count()) { await add.first().click(); await p.waitForTimeout(3000); }
  else { await p.getByRole('button', { name: /^Cancel$/ }).last().click(); await p.waitForTimeout(600); }
}

console.log('=== FIRST PASTE ===');
await paste(sheet);
const first = await count();
console.log('  rows on the day:', first);

console.log('\n=== SAME SHEET PASTED AGAIN (the thing that duplicated) ===');
await paste(sheet);
const second = await count();
console.log('  rows on the day:', second, second === first ? '— nothing duplicated' : `*** ${second-first} DUPLICATES ***`);
let t = await p.innerText('body');
console.log(' ', (t.match(/already (here|in the app)[^\n]*/) || t.match(/Every one of those[^\n]*/) || ['(no dedupe message)'])[0].slice(0,90));

console.log('\n=== START THIS DAY AGAIN ===');
console.log('  button present:', await p.getByRole('button', { name: /Start this day again/ }).count() ? 'yes' : '*** MISSING ***');
await p.getByRole('button', { name: /Start this day again/ }).click(); await p.waitForTimeout(900);
t = await p.innerText('body');
console.log('  says archived not deleted:', /archived, not deleted/.test(t) ? 'yes' : '*** NO ***');
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
const go = dlg.getByRole('button', { name: /Clear .* and start again/ });
console.log('  disabled before the date is typed:', await go.isDisabled() ? 'yes' : '*** ENABLED — mis-click risk ***');
await dlg.locator('input').first().fill('2026-09-04'); await p.waitForTimeout(400);
console.log('  still disabled on the WRONG date:', await go.isDisabled() ? 'yes' : '*** ENABLED ***');
await dlg.locator('input').first().fill(D); await p.waitForTimeout(400);
console.log('  enabled on the right date:', await go.isDisabled() ? '*** STILL DISABLED ***' : 'yes');
await go.click(); await p.waitForTimeout(3000);

console.log('  rows after clearing:', await count());
const arch = await p.evaluate((d)=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__')||'{}');
  const k=Object.keys(kv).find(x=>x.startsWith('archive:schedule:'+d));
  return k ? {key:k.slice(0,32)+'…', rows:JSON.parse(kv[k]).rows.length} : null;
}, D);
console.log('  archived:', arch ? `${arch.rows} rows kept` : '*** NOTHING ARCHIVED ***');
console.log('  day un-posted:', await p.evaluate((d)=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__')||'{}');
  return !kv['posted:'+d];
}, D) ? 'yes' : '*** still locked ***');
const other = await p.evaluate(()=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__')||'{}');
  return Object.keys(kv).filter(k=>k.startsWith('schedule:')).length;
}, D);
console.log('  other days untouched:', other, 'schedule keys still present');

console.log('\n=== PASTE AGAIN ONTO THE CLEAN DAY ===');
await paste(sheet);
console.log('  rows now:', await count(), '(should match the first paste:', first + ')');
await p.screenshot({ path: `${SP}/../cleanday.png`, fullPage: true });
console.log('\nerrors:', errs.length ? errs.slice(0,5) : 'none');
await b.close();
