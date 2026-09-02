import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1250 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !m.text().includes('404')) errs.push('CONSOLE '+m.text()); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(900);
await p.locator('input[placeholder*="Ahmed"]').fill('Ahmed');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);

// Team seeds itself on first visit to Roster
await p.getByRole('button', { name: 'Roster', exact: true }).click(); await p.waitForTimeout(2000);
let t = await p.innerText('body');
console.log('team table present:', /The team/.test(t)?'YES':'NO');
console.log('  licence gap notice:', (t.match(/Driving licence not recorded for [^\n.]*/)||['(none)'])[0].slice(0,90));
const staff = await p.evaluate(()=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['staff']||'[]'));
console.log('  staff seeded:', staff.length, '| e.g.', staff.slice(0,4).map(s=>`${s.name}/${s.trade}/${s.licence===true?'drives':s.licence===false?'no-lic':'?'}`).join(', '));
await p.evaluate(()=>window.scrollTo(0,99999)); await p.waitForTimeout(600);
await p.screenshot({ path: `${SP}/C1-team.png` });

// board: crew warnings on a day with real short-crewed jobs
await p.getByRole('button', { name: 'Live Board', exact: true }).click(); await p.waitForTimeout(700);
await p.locator('input[type=date]').first().fill('2026-08-26'); await p.waitForTimeout(2800);
t = await p.innerText('body');
const seg = (t.match(/Crewing[\s\S]{0,420}/)||[''])[0];
console.log('\ncrew strip:', /short-crewed/.test(t) ? 'PRESENT':'not on this day');
seg.split('\n').filter(Boolean).slice(0,7).forEach(l=>console.log('   ', l.slice(0,112)));
console.log('per-card badge "x/2 people":', /\d\/2 people/.test(t)?'YES':'NO');
await p.evaluate(()=>window.scrollTo(0,100)); await p.waitForTimeout(500);
await p.screenshot({ path: `${SP}/C2-crewstrip.png` });

// suggestion respects trade: a pool job, unassigned
await p.locator('textarea').first().fill('Gemz by Danube 801 Pool Cleaning 1h occupied');
await p.locator('textarea').first().press('Enter');
await p.waitForTimeout(4000);
const wand = p.locator('button[title="Suggest a technician using the scheduling rule"]');
console.log('\nsuggest buttons:', await wand.count());
if (await wand.count()) {
  await wand.first().click(); await p.waitForTimeout(800);
  const t2 = await p.innerText('body');
  const s2 = (t2.match(/By the rule[\s\S]{0,320}/)||[''])[0];
  s2.split('\n').filter(Boolean).slice(0,8).forEach(l=>console.log('   ', l.slice(0,105)));
  await p.screenshot({ path: `${SP}/C3-suggest.png` });
}
console.log('errors:', errs.length?errs:'none');
await b.close();
