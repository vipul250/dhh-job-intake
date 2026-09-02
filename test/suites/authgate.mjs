import { chromium } from 'playwright';
import fs from 'fs';
import { installStubs } from '../harness/supabase-stub.mjs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
seed['auth-required'] = 'true';                      // gate ON, as it would be after the switch
const HARIS = 'haris@deluxehomes.com';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1200 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/40[0-9] \(/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
const { kv } = await installStubs(p, seed, { code: '654321', allowed: [HARIS] });
await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(3000);

let t = await p.innerText('body');
console.log('=== A COORDINATOR OPENS THE APP ===');
console.log('  board hidden behind sign-in:', /Live Board/.test(t) ? '*** BOARD VISIBLE ***' : 'yes');
console.log('  screen says:', t.split('\n').filter(Boolean).slice(0,5).join(' | ').slice(0,140));
await p.screenshot({ path: `${SP}/A3-signin.png` });

const emailBox = p.locator('input[type=email]').first();
await emailBox.fill('someone@gmail.com');
await p.getByRole('button', { name: /Send|code/i }).first().click(); await p.waitForTimeout(1800);
t = await p.innerText('body');
console.log('\n  outsider turned away:', /not set up for this app/.test(t) ? 'YES' : '*** ' + ((t.match(/Could not[^\n]*|not set up[^\n]*/)||['?'])[0]));

await emailBox.fill(HARIS);
await p.getByRole('button', { name: /Send|code/i }).first().click(); await p.waitForTimeout(1800);
t = await p.innerText('body');
console.log('  code stage reached:', /code|Code/.test(t) ? 'yes' : 'no');
const codeBox = p.locator('input[inputmode="numeric"], input[placeholder*="6"], input').filter({ hasNot: p.locator('[type=email]') });
await p.locator('input').nth(await p.locator('input[type=email]').count()).fill('654321').catch(async()=>{
  await p.locator('input:not([type=email])').first().fill('654321');
});
await p.getByRole('button', { name: /Sign in|Verify|Check/i }).first().click(); await p.waitForTimeout(3500);
t = await p.innerText('body');
console.log('\n=== AFTER SIGNING IN ===');
console.log('  board reached:', /Live Board/.test(t) ? 'YES' : '*** still blocked: ' + t.slice(0,100));
console.log('  signed-in name used:', /Who is using this board/.test(t) ? '*** still asks for a typed name ***' : 'taken from the session');
console.log('  sign-out offered:', await p.getByRole('button', { name: 'Sign out' }).count() ? 'yes' : 'MISSING');

// the lockout escape hatch: flip the flag in the database, reload
kv.set('auth-required', 'false');
await p.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('sb-')).forEach(k=>localStorage.removeItem(k)));
await p.reload(); await p.waitForTimeout(3000);
t = await p.innerText('body');
console.log('\n=== RECOVERY (the SQL in docs/ACCESS.md) ===');
console.log('  setting auth-required=false reopens the app:', /Who is using this board|Live Board/.test(t) ? 'YES' : '*** still locked out ***');
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await b.close();
