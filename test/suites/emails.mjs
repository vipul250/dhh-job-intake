import { chromium } from 'playwright';
import fs from 'fs';
import { installStubs } from '../harness/supabase-stub.mjs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const old = JSON.parse(seed['staff'] || '[]');
seed['staff'] = JSON.stringify(old.map(({ email, admin, ...r }) => r));   // as stored today
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1500, height: 1500 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/40\d \(/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
const { kv } = await installStubs(p, seed, { code: '111111', allowed: ['vipul@deluxehomes.com'] });
await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(2500);
await p.locator('input[placeholder*="Ahmed"]').fill('Vipul');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(1400);
await p.getByRole('button', { name: 'Roster' }).first().click(); await p.waitForTimeout(3000);

console.log('=== BACKFILL ONTO THE ALREADY-STORED LIST ===');
const stored = JSON.parse(kv.get('staff') || '[]');
stored.filter(r => r.email || r.admin).forEach(r =>
  console.log('  ', r.name.padEnd(9), (r.email||'—').padEnd(30), r.admin ? 'ADMIN' : ''));
console.log('  team size:', stored.length);

let t = await p.innerText('body');
console.log('\n=== READINESS ===');
console.log('  ', (t.match(/\d+ of \d+ on the team have a work email[^\n]*/)||['MISSING'])[0].slice(0,90));
console.log('  add-someone button:', await p.getByRole('button', { name: 'Add someone' }).count() ? 'present' : 'MISSING');

p.once('dialog', d => d.accept('Ahmed'));
await p.getByRole('button', { name: 'Add someone' }).click(); await p.waitForTimeout(2200);
const after = JSON.parse(kv.get('staff') || '[]');
console.log('\n=== ADDING SOMEONE ===');
console.log('  team size now:', after.length, after.some(r=>r.name==='Ahmed') ? '(Ahmed added)' : '*** not added ***');
const row = after.find(r=>r.name==='Ahmed');
console.log('  defaults:', row ? JSON.stringify({trade:row.trade, base:row.base, licence:row.licence, email:row.email}) : '—');
p.once('dialog', d => d.accept('Ahmed'));
await p.getByRole('button', { name: 'Add someone' }).click(); await p.waitForTimeout(1600);
console.log('  duplicate refused:', JSON.parse(kv.get('staff')||'[]').filter(r=>r.name==='Ahmed').length === 1 ? 'yes' : '*** duplicated ***');
await p.screenshot({ path: `${SP}/A5-team.png`, fullPage: true });
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await b.close();
