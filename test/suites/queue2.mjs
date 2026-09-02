import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const tsv = fs.readFileSync(`${SP}/pms-issues.tsv`,'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1700 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
p.on('console', m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,150)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1000);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(700);
await p.getByRole('button', { name: 'Queue' }).first().click(); await p.waitForTimeout(2000);
await p.getByRole('button', { name: 'Paste the PMS queue' }).first().click(); await p.waitForTimeout(500);
await p.locator('textarea').first().fill(tsv);
await p.getByRole('button', { name: 'Add to the queue' }).click(); await p.waitForTimeout(2500);

// the rule panel
await p.getByRole('button', { name: 'The rule, in full' }).click(); await p.waitForTimeout(500);
let t = await p.innerText('body');
console.log('rule panel steps:', ['When can we get in?','When must it be done by?','Do those two overlap?','Which day inside the window?'].map(s=>t.includes(s)?'y':'N').join(''));

// book the recommended day on a "Book <date>" row
const book = p.getByRole('button', { name: /^Book 2026-/ }).first();
const label = await book.innerText();
console.log('\nbooking:', label);
await book.click(); await p.waitForTimeout(2500);
t = await p.innerText('body');
console.log('toast:', (t.match(/Booked for [^\n]*/)||['MISSING'])[0]);
console.log('queue count now:', (t.match(/Waiting\n(\d+)/)||['','?'])[1]);
console.log('booked-from section:', /Booked from this queue \(1\)/.test(t) ? 'YES' : 'no');

const stored = await p.evaluate((d)=>{
  const kv = JSON.parse(localStorage.getItem('__dhh_mock_kv__'));
  const day = JSON.parse(kv['schedule:'+d]||'[]').filter(r=>!r._tomb);
  const q = JSON.parse(kv['backlog']||'[]');
  return {
    onDay: day.filter(j=>j.source==='pms-queue').map(j=>({
      p:j.property, u:j.unit, pri:j.priority, basis:j.scheduledBasis,
      why:(j.scheduledWhy||'').slice(0,120), due:j.dueDate, occ:j.status })),
    queueScheduled: q.filter(i=>i.scheduledFor).length,
  };
}, label.replace('Book ','').trim());
console.log('\nSTORED:', JSON.stringify(stored, null, 1));
console.log('\nerrors:', errs.length?errs:'none');
await p.screenshot({ path: `${SP}/Q2-booked.png`, fullPage: true });
await b.close();
