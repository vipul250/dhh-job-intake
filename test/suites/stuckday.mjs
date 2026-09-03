/* The exact sequence that left the live board stuck: quick-add wreckage on
   a day, "Close them off" pressed, and then no visible way to start over. */
import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const D = '2026-09-03';

/* Mangled rows exactly as the old quick-add produced them: the obvious kind
   (year as unit) and the subtle kind (parking bay as unit, clean-looking
   description) that no detector can tell from a real job. */
const wreck = [
  { id:'w1', state:'scheduled', scheduledDate:D, originDate:D, createdAt:Date.now(), createdBy:'Haris',
    property:'', unit:'2026', description:'09:00-18:00 and office - 7th floor Ms Anna office AC is not working N Y -Urgent Y https://pms.deluxehomes.ae/tasks-redirect-page?id=402305',
    team:'Vitalis', events:[{at:Date.now(),kind:'created',by:'Haris'}] },
  { id:'w2', state:'scheduled', scheduledDate:D, originDate:D, createdAt:Date.now(), createdBy:'Haris',
    property:'La Vie', unit:'B-257', description:'Remove DLX and QR code — reset smart lock',
    team:'Vitalis', estimatedTime:'30m', events:[{at:Date.now(),kind:'created',by:'Haris'}] },
  { id:'w3', state:'scheduled', scheduledDate:D, originDate:D, createdAt:Date.now(), createdBy:'Haris',
    property:'3802', unit:'', description:'Door lock repair / replacement',
    team:'Vitalis', estimatedTime:'2h', events:[{at:Date.now(),kind:'created',by:'Haris'}] },
];
seed[`schedule:${D}`] = JSON.stringify(wreck);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,160)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1300);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
await p.locator('input[type=date]').first().fill(D); await p.waitForTimeout(2200);

const live = () => p.evaluate((d)=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__')||'{}');
  const r=JSON.parse(kv['schedule:'+d]||'[]').filter(x=>!x._tomb);
  return { total:r.length, open:r.filter(x=>x.state!=='cancelled').length };
}, D);

let t = await p.innerText('body');
console.log('=== BEFORE ===');
console.log('  banner shown:', /were read wrong/.test(t) ? 'yes' : '*** NO ***');
console.log('  rows:', JSON.stringify(await live()));

console.log('\n=== PRESS "CLOSE THEM OFF" (what he did) ===');
await p.getByRole('button', { name: 'Close them off' }).click(); await p.waitForTimeout(2500);
t = await p.innerText('body');
console.log('  rows:', JSON.stringify(await live()));
console.log('  subtle wreckage still open (La Vie B-257):', /La Vie/.test(t) ? 'yes — as expected' : 'no');
console.log('  banner STILL offers a way out:', /carried rows that were read wrong/.test(t) ? 'yes' : '*** BANNER GONE — DEAD END ***');
const clearBtn = p.getByRole('button', { name: /Clear .* and start again/ });
console.log('  "Clear and start again" reachable:', await clearBtn.count() ? 'yes' : '*** NO WAY OUT ***');
await p.screenshot({ path: `${SP}/../stuckday.png`, fullPage: true });

console.log('\n=== CLEAR IT ===');
await clearBtn.first().click(); await p.waitForTimeout(900);
const dlg = p.locator('div.fixed.inset-0').locator('div.bg-white').first();
await dlg.locator('input').first().fill(D); await p.waitForTimeout(400);
await dlg.getByRole('button', { name: /Clear .* and start again/ }).click(); await p.waitForTimeout(3000);
console.log('  rows after:', JSON.stringify(await live()));
t = await p.innerText('body');
console.log('  banner gone:', /read wrong/.test(t) ? '*** STILL THERE ***' : 'yes');
console.log('  archived:', await p.evaluate((d)=>{
  const kv=JSON.parse(localStorage.getItem('__dhh_mock_kv__')||'{}');
  const k=Object.keys(kv).find(x=>x.startsWith('archive:schedule:'+d));
  return k ? JSON.parse(kv[k]).rows.length + ' rows kept' : '*** NOTHING ***';
}, D));
console.log('\nerrors:', errs.length ? errs.slice(0,5) : 'none');
await b.close();
