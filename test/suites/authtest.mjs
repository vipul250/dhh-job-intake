import { chromium } from 'playwright';
import fs from 'fs';
import { installStubs } from '../harness/supabase-stub.mjs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const ME = 'vipul@deluxehomes.com';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1300 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text().slice(0,140)); });
const { kv, sent } = await installStubs(p, seed, { code: '123456', allowed: [ME] });
await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(2500);

console.log('=== BEFORE: gate off ===');
let t = await p.innerText('body');
console.log('  app opens without a login:', /Who is using this board/.test(t) ? 'yes' : (/one-time code/.test(t) ? 'NO — login shown' : '?'));
await p.locator('input[placeholder*="Ahmed"]').fill('Vipul');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(1500);
await p.getByRole('button', { name: 'Roster' }).first().click(); await p.waitForTimeout(2000);

console.log('\n=== THE GATE ===');
const onBtn = p.getByRole('button', { name: 'Turn sign-in on' });
console.log('  switch disabled before a code is proven:', await onBtn.isDisabled() ? 'YES (correct)' : '*** NO ***');

await p.locator('input[name="access-test-email"]').fill('stranger@example.com');
await p.getByRole('button', { name: 'Send test code' }).click(); await p.waitForTimeout(1600);
t = await p.innerText('body');
console.log('  uninvited address refused:', /not set up for this app/.test(t) ? 'YES' : '*** ' + ((t.match(/Could not send[^\n]*/)||['no message'])[0]));

await p.locator('input[name="access-test-email"]').fill(ME);
await p.getByRole('button', { name: 'Send test code' }).click(); await p.waitForTimeout(1600);
t = await p.innerText('body');
console.log('  code sent:', /Code sent to/.test(t) ? 'yes' : '*** ' + ((t.match(/Could not[^\n]*/)||['?'])[0]));

await p.locator('input[inputmode="numeric"]').fill('000000');
await p.getByRole('button', { name: 'Check it' }).click(); await p.waitForTimeout(1600);
t = await p.innerText('body');
console.log('  wrong code rejected:', /not right|invalid|expired/i.test(t) ? 'yes' : '*** accepted ***');

await p.locator('input[inputmode="numeric"]').fill('123456');
await p.getByRole('button', { name: 'Check it' }).click(); await p.waitForTimeout(2200);
t = await p.innerText('body');
console.log('  right code accepted:', /That worked/.test(t) ? 'yes' : '*** ' + ((t.match(/Could not[^\n]*|not right[^\n]*/)||['?'])[0]));
console.log('  switch now enabled:', await onBtn.isDisabled() ? '*** still disabled ***' : 'YES');
await p.screenshot({ path: `${SP}/A2-gate.png`, fullPage: true });

console.log('\n=== TURN IT ON ===');
await onBtn.click(); await p.waitForTimeout(2200);
t = await p.innerText('body');
console.log('  panel says:', (t.match(/Sign-in required[^\n]*/)||['MISSING'])[0].slice(0,72));
console.log('  flag written to the database:', JSON.stringify(kv.get('auth-required')));
console.log('  emails requested:', sent);
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await b.close();
