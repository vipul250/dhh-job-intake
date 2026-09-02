import { chromium } from 'playwright';
import fs from 'fs';
import { installStubs } from '../harness/supabase-stub.mjs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const ME = 'vipul@deluxehomes.com';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/40\d \(/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
const { kv } = await installStubs(p, seed, { code: '123456', allowed: [ME, 'haris@deluxehomes.com'] });
await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(2500);
await p.locator('input[placeholder*="Ahmed"]').fill('Vipul');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(1400);
await p.getByRole('button', { name: 'Roster' }).first().click(); await p.waitForTimeout(2500);

let t = await p.innerText('body');
const i = t.indexOf('Before you turn it on');
console.log('=== READINESS CHECK ===');
console.log(i < 0 ? '*** MISSING ***' : t.slice(i, i + 620).split('\n').filter(Boolean).slice(0,6).join('\n'));
console.log('\n=== TEAM LIST HAS AN EMAIL COLUMN ===');
console.log('  header:', /Work email/.test(t) ? 'yes' : '*** MISSING ***');
const emailCells = await p.locator('table input[type=email]').count();
console.log('  editable cells:', emailCells);

// fill one in and confirm it saves
if (emailCells) {
  await p.locator('table input[type=email]').first().fill('haris@deluxehomes.com');
  await p.locator('table input[type=email]').first().blur();
  await p.waitForTimeout(2000);
  const saved = JSON.parse(kv.get('staff') || '[]').filter(x => x.email);
  console.log('  saved to the database:', saved.map(x => `${x.name}=${x.email}`).join(', ') || '*** not saved ***');
  t = await p.innerText('body');
  console.log('  counter moved:', (t.match(/\d+ of \d+ on the team have a work email/)||['?'])[0]);
}
await p.screenshot({ path: `${SP}/A4-ready.png`, fullPage: true });
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await b.close();
