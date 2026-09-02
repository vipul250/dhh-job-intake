import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1400);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);

// today is 2026-09-02, the go-live date. August history sits behind it.
await p.locator('input[type=date]').first().fill('2026-09-02'); await p.waitForTimeout(3000);
let t = await p.innerText('body');
console.log('=== 2 SEPTEMBER, THE DAY THEY START ===');
console.log('  "were never closed out" banner:', /never closed out/.test(t) ? '*** STILL THERE: ' + (t.match(/\d+ jobs from before[^\n]*/)||[''])[0] : 'gone');
console.log('  jobs on the day:', (t.match(/(\d+) jobs?\b/)||['','?'])[1]);
console.log('  strays banner:', /came from before/.test(t) ? (t.match(/\d+ jobs? on this day came from before[^\n]*/)||[''])[0].slice(0,70) : 'none (nothing dragged forward)');

// a day inside the history must still be readable
await p.locator('input[type=date]').first().fill('2026-08-28'); await p.waitForTimeout(2600);
t = await p.innerText('body');
console.log('\n=== 28 AUGUST (history) ===');
console.log('  still opens and shows its jobs:', (t.match(/(\d+) jobs?\b/)||['','?'])[1]);
console.log('  rollover banner on a history day:', /never closed out/.test(t) ? '*** present ***' : 'none');

// the setting
await p.getByRole('button', { name: 'Roster' }).first().click(); await p.waitForTimeout(2600);
t = await p.innerText('body');
const i = t.indexOf('Where the record starts');
console.log('\n=== THE SETTING ===');
console.log(i<0 ? '*** MISSING ***' : t.slice(i, i+330).split('\n').filter(Boolean).slice(0,5).join('\n'));
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await p.screenshot({ path: `${SP}/../../` + 'golive.png', fullPage: true }).catch(()=>{});
await b.close();
