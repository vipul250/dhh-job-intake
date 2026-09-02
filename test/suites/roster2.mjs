import { chromium } from 'playwright';
import fs from 'fs';
const SP = process.env.SP;
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`,'utf8'));
const MSG = fs.readFileSync(`${SP}/msg.txt`,'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 1250 } });
const errs=[]; p.on('pageerror', e=>errs.push('PAGEERR '+e.message));
await p.goto('http://127.0.0.1:4173/');
await p.evaluate((s)=>localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
await p.evaluate(()=>localStorage.removeItem('dhh-me'));
await p.reload(); await p.waitForTimeout(900);
await p.locator('input[placeholder*="Ahmed"]').fill('Ahmed');
await p.getByRole('button', { name: 'Start' }).click(); await p.waitForTimeout(900);

// save the roster
await p.getByRole('button', { name: 'Roster', exact: true }).click(); await p.waitForTimeout(1200);
await p.locator('textarea').first().fill(MSG);
await p.waitForTimeout(1000);
await p.getByRole('button', { name: /Save roster/ }).click();
await p.waitForTimeout(1800);

// now schedule work for Abdul Riyaz, who is on week off
await p.getByRole('button', { name: 'Live Board', exact: true }).click(); await p.waitForTimeout(800);
await p.locator('input[type=date]').first().fill('2026-09-01'); await p.waitForTimeout(2800);
await p.locator('textarea').first().fill('Ocean Heights 1204 lights flickering 1h Abdul Riyaz occupied');
await p.locator('textarea').first().press('Enter');
await p.waitForTimeout(3500);
const t = await p.innerText('body');
const seg = (t.match(/job\(s\) are assigned to somebody who is not available today[\s\S]{0,200}/)||[''])[0];
console.log('AWAY-ASSIGNMENT WARNING:', seg ? 'FIRED' : 'did not fire');
seg.split('\n').filter(Boolean).slice(0,4).forEach(l=>console.log('   ', l.slice(0,110)));
console.log('idle line:', (t.match(/idle: [^\n]*/)||['(none)'])[0].slice(0,120));
console.log('headcount line present:', /of 16 available/.test(t) ? 'YES':'NO');
await p.evaluate(()=>window.scrollTo(0,80)); await p.waitForTimeout(500);
await p.screenshot({ path: `${SP}/R3-away-warning.png` });
console.log('errors:', errs.length?errs:'none');
await b.close();
