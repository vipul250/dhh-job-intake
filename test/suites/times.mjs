/* Real arrival and departure times at close-out, and the estimate that
   stops being a guess once the same work has been measured enough times. */
import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
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

const D = '2026-09-24';
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(2200);

/* Five drain unclogs, so the sixth has something to learn from. */
console.log('=== SEEDING FIVE MEASURED DRAIN JOBS ===');
const ta = p.locator('textarea').first();
for (let i = 1; i <= 5; i++) {
  await ta.fill(`Marina Gate 1 ${1000+i} Bathroom drain clogged 30 mins Daljith occupied p3`);
  await ta.press('Enter'); await p.waitForTimeout(1200);
}
console.log('  cards with a Close out button:', await p.getByRole('button', { name: 'Close out' }).count());

/* Each took 09:00 -> 10:15, i.e. 75 minutes against the 30 estimated. */
for (let i = 0; i < 5; i++) {
  await p.getByRole('button', { name: 'Close out' }).nth(i).click(); await p.waitForTimeout(1000);
  const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
  await dlg.getByRole('button', { name: /^Fixed/ }).click(); await p.waitForTimeout(500);
  if (i === 0) {
    const t = await p.innerText('body');
    console.log('  prompt for real times:', /What time was he there/.test(t) ? 'shown' : '*** MISSING ***');
    console.log('  "Now" buttons:', await dlg.getByRole('button', { name: 'Now' }).count());
  }
  const times = dlg.locator('input[placeholder="09:15"]');
  await times.nth(0).fill('09:00');
  await times.nth(1).fill('10:15');
  await p.waitForTimeout(500);
  if (i === 0) {
    const t = await p.innerText('body');
    console.log('  computed span:', (t.match(/1h 15m on site[^\n]*/) || ['*** NOT COMPUTED ***'])[0].slice(0,90));
    console.log('  minutes box disabled once both times are in:',
      await dlg.locator('input[type=number]').first().isDisabled() ? 'yes' : '*** no ***');
  }
  await dlg.getByRole('button', { name: /^Close out$/ }).click(); await p.waitForTimeout(1500);
}
const stored = await p.evaluate((d) => {
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__') || '{}');
  const rows = JSON.parse(kv['schedule:' + d] || '[]');
  return rows.filter(r => !r._tomb).map(r => ({ state: r.state, a: r.arrivedAt, l: r.leftAt, cat: r.catalogueId }));
}, D);
console.log('  stored as fixed with both times:',
  stored.filter(r => r.state === 'fixed' && r.a === '09:00' && r.l === '10:15').length, 'of', stored.length);
console.log('  all snapped to the same standard task:',
  new Set(stored.map(r => r.cat)).size === 1 ? stored[0].cat : '*** ' + JSON.stringify(stored.map(r=>r.cat)));

/* The sixth line should now be estimated from what the work took. */
console.log('\n=== THE SIXTH ONE LEARNS ===');
await p.reload(); await p.waitForTimeout(2600);
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(2000);
await p.locator('textarea').first().fill('Marina Gate 1 2606 Bathroom drain clogged Daljith occupied p3');
await p.waitForTimeout(1200);
let t = await p.innerText('body');
console.log(' ', (t.match(/time from what it actually took[^\n]*/) || ['*** NO LEARNED ESTIMATE ***'])[0].slice(0,150));
console.log('  estimate chip on the preview:', (t.match(/Est\s*[^\n]{0,18}/) || ['?'])[0].slice(0,30));
await p.screenshot({ path: `${SP}/../times-board.png` });

/* And the dashboard should say so. */
console.log('\n=== DASHBOARD ===');
await p.locator('textarea').first().fill('');
await p.getByRole('button', { name: 'Dashboard' }).click(); await p.waitForTimeout(2500);
/* Three date inputs on this screen: the app header's day picker first,
   then the dashboard's own From and To. */
const dates = p.locator('input[type=date]');
await dates.nth(1).fill('2026-09-20'); await dates.nth(2).fill('2026-09-28');
await p.waitForTimeout(400);
await p.getByRole('button', { name: /Load range/ }).click(); await p.waitForTimeout(7000);
t = await p.innerText('body');
for (const [label, re] of [
  ['Tasks done section', /Tasks done, and time on site/],
  ['tasks done count', /Tasks done\s*\n?\s*5\b/],
  ['real times count', /Real arrival \/ departure\s*\n?\s*5\b/],
  ['median on site', /Median time on site\s*\n?\s*1h 15m/],
  ['duration library', /What the work really takes/],
  ['library is using it', /using the measured time/],
  ['source split', /5 real times/],
]) console.log(' ', label + ':', re.test(t) ? 'yes' : '*** NO ***');
console.log(' ', (t.match(/Drain unclogging[^\n]*/) || ['*** row missing ***'])[0].slice(0,110));
await p.screenshot({ path: `${SP}/../times-dash.png`, fullPage: true });

console.log('\nerrors:', errs.length ? errs.slice(0,5) : 'none');
await b.close();
