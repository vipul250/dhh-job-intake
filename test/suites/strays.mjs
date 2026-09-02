import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
// simulate the damage: the 28 Aug rows dragged onto 2 Sep, as the old
// rollover banner would have done, keeping their originDate.
const aug = JSON.parse(seed['schedule:2026-08-28'] || '[]').filter(r=>!r._tomb).slice(0, 9);
const moved = aug.map(j => ({ ...j, scheduledDate: '2026-09-02', originDate: '2026-08-28', pushCount: (j.pushCount||0)+1 }));
seed['schedule:2026-09-02'] = JSON.stringify(moved);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{ if(m.type()==='error' && !/Supabase env|404/.test(m.text())) errs.push('CONSOLE '+m.text().slice(0,140)); });
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(1400);
await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);
await p.locator('input[type=date]').first().fill('2026-09-02'); await p.waitForTimeout(3200);
let t = await p.innerText('body');
console.log('9 August jobs dragged onto 2 Sep.');
console.log('  banner:', (t.match(/\d+ jobs? on this day came from before [^\n]*/)||['*** MISSING ***'])[0].slice(0,100));
console.log('  button:', await p.getByRole('button', { name: 'Close them off' }).count() ? 'present' : 'MISSING');
await p.screenshot({ path: `${SP}/../strays.png` });
await p.getByRole('button', { name: 'Close them off' }).click(); await p.waitForTimeout(3200);
t = await p.innerText('body');
console.log('\nafter closing them off:');
console.log('  toast:', (t.match(/\d+ job\(s\) from before [^\n]*/)||['—'])[0].slice(0,70));
console.log('  banner gone:', /came from before/.test(t) ? '*** still there ***' : 'yes');
const st = await p.evaluate(()=>{
  const rows = JSON.parse(JSON.parse(localStorage.getItem('__dhh_mock_kv__'))['schedule:2026-09-02']).filter(r=>!r._tomb);
  return { total: rows.length, cancelled: rows.filter(r=>r.state==='cancelled').length,
           reason: (rows.find(r=>r.state==='cancelled')||{}).outcomeReason,
           stillOnRecord: rows.length };
});
console.log('  stored:', JSON.stringify(st));
console.log('  nothing deleted:', st.total === 9 ? 'yes — all 9 still on the day' : '*** ' + st.total);
console.log('\nerrors:', errs.length?errs.slice(0,4):'none');
await b.close();
