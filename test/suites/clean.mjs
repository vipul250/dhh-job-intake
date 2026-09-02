import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1300 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,150)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1100);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);

const nav = await p.locator('nav button, header button').allTextContents();
const t0 = await p.innerText('body');
console.log('TABS:', (t0.split('\n').slice(0,20).filter(x=>/Live Board|Queue|Roster|Dashboard|Projects|Insights|Import|Print|Fault|Properties/.test(x))).join(' | '));
for (const gone of ['Import Sheet','Print / Export','AI Import']) {
  console.log(`  "${gone}" removed:`, t0.includes(gone) ? '*** STILL THERE ***' : 'yes');
}

// no "Other" anywhere in any dropdown on the board
await p.locator('input[type=date]').first().fill('2026-09-10'); await p.waitForTimeout(2000);
await p.locator('textarea').first().fill('Zed Tower 707 pool cleaning 1h Resty vacant p3');
await p.locator('textarea').first().press('Enter'); await p.waitForTimeout(1800);
await p.getByRole('button', { name: /^(more|less)$/ }).first().click(); await p.waitForTimeout(700);
const allOpts = async () => {
  const sels = await p.locator('select').all();
  const out = [];
  for (const s of sels) out.push(...await s.locator('option').allTextContents());
  return out;
};
let opts = await allOpts();
console.log('\nboard dropdown options containing "Other":', opts.filter(o=>/^other/i.test(o.trim())));

// not-done dialog
await p.getByRole('button', { name: 'Not done', exact: true }).first().click(); await p.waitForTimeout(1000);
opts = await allOpts();
console.log('not-done options:', opts.filter(o=>o && !/^\d/.test(o)).slice(0,12));
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
const btn = dlg.getByRole('button', { name: 'Mark not done' });
await dlg.locator('select').first().selectOption({ label: 'None of these — say what happened' }); await p.waitForTimeout(400);
await dlg.locator('input[type=radio]').first().check(); await p.waitForTimeout(300);
console.log('blocked until the words are typed:', await btn.isDisabled() ? 'YES' : '*** no ***');
await dlg.locator('input[placeholder*="own words"]').fill('Lift was out of service all day'); await p.waitForTimeout(400);
console.log('unblocked after typing:', await btn.isDisabled() ? '*** still blocked ***' : 'YES');
await btn.click(); await p.waitForTimeout(2200);
const stored = await p.evaluate(()=>JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-10']).filter(r=>!r._tomb).map(j=>({s:j.state,r:j.outcomeReason})));
console.log('stored reason:', JSON.stringify(stored));

// no delete anywhere
const t = await p.innerText('body');
console.log('\n"Delete" on the board:', /\bDelete\b/.test(t) ? '*** PRESENT ***' : 'none');
await p.getByRole('button', { name: 'Projects' }).first().click(); await p.waitForTimeout(3500);
const tp = await p.innerText('body');
console.log('"Delete" on Projects:', /\bDelete\b/.test(tp) ? '*** PRESENT ***' : 'none');
console.log('project dropdown "Other":', (await allOpts()).filter(o=>/^other/i.test(o.trim())));
console.log('\nerrors:', errs.length?errs:'none');
await p.screenshot({ path: `${SP}/C9-clean.png`, fullPage: true });
await b.close();
