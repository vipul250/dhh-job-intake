import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const MSG = `*Shift Timings for 02/09/2026*

Week off - Riyaz
Fujairah - Faizal

*Daily ops*
9.00am - 6.00pm
Vitalis
Jabbar
Bright
Resty

*Project team*
Adi, Khaled, Nizar, Shafiq & Bijaya

Stand-by Emergency Tech 11.00pm - 2.00am
Anthony +971 50 260 6632

*Coordinators Shift*
Haris - 8.00 am - 5.00 pm
Tiyana - 2.00 pm - 11.00 pm
Monish - 9.00 am - 6.00 pm`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1500, height: 1500 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1400);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
await p.getByRole('button', { name: 'Roster' }).first().click(); await p.waitForTimeout(2600);
console.log('paste guidance mentions both teams:',
  /Project team/.test(await p.innerText('body')) && /Daily ops/.test(await p.innerText('body')) ? 'yes' : 'MISSING');
await p.getByRole('button', { name: /Paste|Edit|shift message/i }).first().click().catch(()=>{});
await p.waitForTimeout(600);
const ta = p.locator('textarea').first();
await ta.fill(MSG); await p.waitForTimeout(900);
await p.getByRole('button', { name: /^Save/ }).first().click(); await p.waitForTimeout(2600);
const t = await p.innerText('body');
const tile = (label) => { const i=t.indexOf(label); return i<0?'MISSING':t.slice(i, i+150).split('\n').filter(Boolean).slice(0,3).join(' · '); };
console.log('\nTILES');
for (const l of ['Available today','On shift','Coordinators on','On projects','Not available','Off-site','Stand-by']) {
  console.log('  ' + l.padEnd(17), tile(l).slice(0, 92));
}
console.log('\nproject crew NOT called idle:', /idle: /.test(t) ? (t.match(/idle: [^\n]*/)||[''])[0] : 'no idle line at all');
console.log('Vipul anywhere on the roster board:', /Vipul/.test(t.slice(0, t.indexOf('The team') > 0 ? t.indexOf('The team') : 4000)) ? '*** YES ***' : 'no');
await p.screenshot({ path: `${SP}/../rosterteams.png`, fullPage: true });
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await b.close();
