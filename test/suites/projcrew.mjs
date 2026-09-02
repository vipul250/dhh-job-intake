/* Two things the coordinator hit on the live board:
   - "Coordinators on" said 3 on a day Tiyana was on week off
   - there was nowhere to say who is on a project                */
import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const D = '2026-09-03';
const MSG = `Date - 03/09/2026
Shift Timings
09:00-18:00
Vitalis, Resty, Abdul riyaz, Bijaya, Daljit, Yousouf, Jabbar, Bright
12:00-21:00
Anthony, Imran, Sameer, Nabin
14:00-23:00
Shafeeq
Week off - Imtiaz
Leave - Kofi
Fujairah - Faizal
Stand by 6pm - 9am
Anthony +971 50 260 6632
Coordinators
Haris - 8.00 am - 5.00 pm
Kaja - 2.00 pm - 11.00 pm
Tiyana - Week Off`;

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
await p.getByRole('button', { name: 'Roster' }).click(); await p.waitForTimeout(1500);
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(1200);
await p.locator('textarea').first().fill(MSG); await p.waitForTimeout(1200);
await p.getByRole('button', { name: /^Save/ }).first().click(); await p.waitForTimeout(1800);

let t = await p.innerText('body');
console.log('=== COORDINATORS (Tiyana is on week off) ===');
const coord = (t.match(/Coordinators on\s*\n\s*(\d+|—)\s*\n([^\n]*)\n([^\n]*)/) || []);
console.log('  count :', coord[1], coord[1] === '2' ? '' : '*** should be 2 ***');
console.log('  hours :', (coord[2]||'').trim());
console.log('  names :', (coord[3]||'').trim());
console.log('  Tiyana shown as off:', /Tiyana\s*—\s*off/.test(t) ? 'yes' : '*** NOT SHOWN ***');
console.log('  Tiyana not counted among field "Not available":',
  /Not available\s*\n\s*\d+\s*\n[^\n]*Tiyana/.test(t) ? '*** she is in the vans list ***' : 'correct');

console.log('\n=== A PLACE TO PUT THE PROJECT CREW ===');
console.log('  panel present:', /Who is on a project today/.test(t) ? 'yes' : '*** MISSING ***');
const chips = p.locator('button', { hasText: /^Resty$/ });
console.log('  roster names offered as chips:', await chips.count() ? 'yes' : '*** none ***');
await p.getByRole('button', { name: 'Resty', exact: true }).first().click(); await p.waitForTimeout(1200);
await p.getByRole('button', { name: 'Bijaya', exact: true }).first().click(); await p.waitForTimeout(1500);
t = await p.innerText('body');
console.log('  "On projects" tile now:', (t.match(/On projects\s*\n\s*(\d+|—)\s*\n([^\n]*)/) || ['','?','?']).slice(1,3).join(' — '));
console.log('  project picker appeared:', /Which project\?/.test(t) ? 'yes' : '*** NO ***');

// it must survive a reload, without a re-paste
await p.reload(); await p.waitForTimeout(2000);
await p.getByRole('button', { name: 'Roster' }).click(); await p.waitForTimeout(1200);
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(2000);
t = await p.innerText('body');
console.log('  survives a reload:', /On projects\s*\n\s*2\b/.test(t) ? 'yes' : '*** LOST ***');
console.log('  and they are not called idle:',
  /(idle|no duty today)[^\n]*Resty/i.test(t) ? '*** still idle ***' : 'correct');
await p.screenshot({ path: `${SP}/../projcrew.png`, fullPage: true });
console.log('\nerrors:', errs.length ? errs.slice(0,5) : 'none');
await b.close();
