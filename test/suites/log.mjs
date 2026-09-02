import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1300 } });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,150)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
const signIn = async (name) => {
  await p.evaluate(()=>localStorage.removeItem('dhh-me'));
  await p.reload(); await p.waitForTimeout(1100);
  await p.locator('input[placeholder*="Ahmed"]').fill(name);
  await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(800);
};
console.log('prompt mentions shift expiry:', /asked again each shift/.test(await p.innerText('body')) ? 'YES' : 'NO');

// Haris builds tomorrow
await signIn('Haris');
await p.locator('input[type=date]').first().fill('2026-09-06'); await p.waitForTimeout(2200);
for (const l of ['Alpha Tower 101 pool cleaning 1h Resty vacant p3',
                 'Beta Tower 202 ac not cooling 1h Nizar occupied p2']) {
  await p.locator('textarea').first().fill(l);
  await p.locator('textarea').first().press('Enter'); await p.waitForTimeout(1600);
}
await p.getByRole('button', { name: /^Post 2026-09-06/ }).click(); await p.waitForTimeout(1600);

// Kaja comes on shift and changes it
await signIn('Kaja');
await p.locator('input[type=date]').first().fill('2026-09-06'); await p.waitForTimeout(2200);
await p.getByRole('button', { name: /^(more|less)$/ }).first().click(); await p.waitForTimeout(600);
const est = p.locator('input[placeholder="1 hr"]').first();
await est.fill('3 hr'); await est.blur(); await p.waitForTimeout(900);
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.locator('select').selectOption('Emergency took priority');
await dlg.getByRole('button', { name: 'Save the change' }).click(); await p.waitForTimeout(1800);

let t = await p.innerText('body');
console.log('\nattribution line:', (t.match(/Built by[^\n]*/)||['MISSING'])[0]);
await p.getByRole('button', { name: 'see the log' }).click(); await p.waitForTimeout(1200);
t = await p.innerText('body');
const i = t.indexOf('Who did what on 2026-09-06');
console.log('\n' + t.slice(i, i+900).split('\n').filter(Boolean).slice(0,26).join('\n'));
await p.screenshot({ path: `${SP}/L9-daylog.png`, fullPage: true });
console.log('\nerrors:', errs.length?errs:'none');
await b.close();
