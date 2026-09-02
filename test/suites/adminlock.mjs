import { chromium } from 'playwright';
import fs from 'fs';
import { installStubs } from '../harness/supabase-stub.mjs';
const SP = process.env.SP;
const base = JSON.parse(fs.readFileSync(`${SP}/seed-legacy-staff.json`,'utf8'));

async function run(who, label) {
  const seed = JSON.parse(JSON.stringify(base));
  seed['auth-required'] = 'true';                       // gate already on
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/40\d \(/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,130)); });
  await installStubs(p, seed, { code: '222222', allowed: [who] });
  await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(2500);
  await p.locator('input[type=email]').first().fill(who);
  await p.getByRole('button', { name: /Send|code/i }).first().click(); await p.waitForTimeout(1600);
  await p.locator('input:not([type=email])').first().fill('222222');
  await p.getByRole('button', { name: /Sign in|Verify|Check/i }).first().click(); await p.waitForTimeout(3500);
  let t = await p.innerText('body');
  const inApp = /Live Board/.test(t);
  await p.getByRole('button', { name: 'Roster' }).first().click(); await p.waitForTimeout(3000);
  const off = p.getByRole('button', { name: 'Turn it off' });
  const disabled = await off.count() ? await off.isDisabled() : null;
  t = await p.innerText('body');
  const name = (t.match(/Signed in as ([^\s.]+)/)||['','?'])[1];
  console.log(`${label.padEnd(22)} signed in: ${inApp ? 'yes' : 'NO'} | can turn sign-in off: ${disabled === null ? 'button missing' : disabled ? 'NO (blocked)' : 'YES'} | as ${name}`);
  if (errs.length) console.log('   errors:', errs.slice(0,3));
  await p.screenshot({ path: `${SP}/A6-${label.split(' ')[0]}.png` });
  await b.close();
}
await run('haris@deluxehomes.com', 'Haris (coordinator)');
await run('vipul@deluxehomes.com', 'Vipul (admin)');
