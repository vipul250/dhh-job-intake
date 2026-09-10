/* ---------------------------------------------------------------------- *
 * device.mjs — the board on a device that is not this one.
 *
 * Four things, none of which a `vite build` can tell you:
 *
 *   1. the build really does ship a second, older copy of itself, and that
 *      copy is not written in syntax the old browsers choke on;
 *   2. a healthy load says nothing extra — the boot guard stays quiet;
 *   3. a load where the bundle never arrives ends in a panel that names
 *      the browser, rather than a white screen;
 *   3b. that older copy is not merely parseable but actually runs;
 *   4. a copy button that cannot reach the clipboard says so instead of
 *      claiming success, which is what it used to do.
 *
 * Run it like every other suite: mock storage in place, `npm run build`,
 * `vite preview` on 4173.
 * ---------------------------------------------------------------------- */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const SP = process.env.SP;
const ROOT = path.resolve(SP, '..', '..');
const seed = JSON.parse(fs.readFileSync(`${SP}/seed-kv.json`, 'utf8'));
const require = createRequire(`${ROOT}/package.json`);

let bad = 0;
const ok = (label, pass, detail = '') => {
  console.log(`${pass ? '  ok  ' : '  ***  '} ${label}${detail ? ' — ' + detail : ''}`);
  if (!pass) bad++;
};

/* ---- 1. the build ships an old copy ---------------------------------- */
const html = fs.readFileSync(`${ROOT}/dist/index.html`, 'utf8');
ok('legacy entry is on the page', /nomodule[^>]*id="vite-legacy-entry"/.test(html));
ok('legacy polyfills are on the page', /nomodule[^>]*id="vite-legacy-polyfill"/.test(html));
ok('modern build is still module-only', /<script type="module"[^>]*src="\/assets\/index-/.test(html));

const legacyName = (html.match(/data-src="\/assets\/(index-legacy-[^"]+\.js)"/) || [])[1];
ok('legacy chunk is named in the html', !!legacyName, legacyName || '');
if (legacyName) {
  const acorn = require('acorn');
  const src = fs.readFileSync(`${ROOT}/dist/assets/${legacyName}`, 'utf8');
  let parsed = '';
  try { acorn.parse(src, { ecmaVersion: 2015, sourceType: 'script' }); parsed = 'es2015'; }
  catch (e) { parsed = 'FAILED: ' + e.message; }
  ok('legacy chunk parses as ES2015 — no ?. or ?? left in it', parsed === 'es2015', parsed);
  ok('legacy chunk carries no nullish coalescing', !/[^?]\?\?[^?=]/.test(src));
}

/* The modern build is not the modern browser's problem alone: Vite lets
   everything from Chrome 64 up take it, and Chrome 64 cannot read `??`.
   plugin-legacy compiles it down accordingly — this fails if that ever
   stops being true, or if someone sets build.target and overrides it. */
const modernName = (html.match(/<script type="module" crossorigin src="\/assets\/(index-[^"]+\.js)"/) || [])[1];
if (modernName) {
  const src = fs.readFileSync(`${ROOT}/dist/assets/${modernName}`, 'utf8');
  ok('modern chunk carries no nullish coalescing either', !/[^?]\?\?[^?=]/.test(src));
}

/* ---- the browser ------------------------------------------------------ */
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/* ---- 2. a healthy load is silent -------------------------------------- */
{
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await p.goto('http://127.0.0.1:4173/');
  await p.evaluate((s) => localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
  await p.reload();
  await p.waitForTimeout(1500);

  ok('React signalled that it rendered', await p.evaluate(() => !!window.__dhhBootedAt));
  const body = await p.innerText('body');
  ok('no startup panel on a working load', !/did not start|too old to run/.test(body));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await p.close();
}

/* ---- 3. a load where the bundle never arrives ------------------------- */
{
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  /* Standing in for the real thing: an engine that cannot parse the
     bundle, a captive-portal wifi that swallows it, a chunk that 404s
     after a redeploy. All of them end the same way — nothing runs. */
  await p.route('**/assets/index-*.js', (r) => r.abort());
  await p.route('**/assets/polyfills-*.js', (r) => r.abort());
  await p.goto('http://127.0.0.1:4173/');
  /* First look is at 10s by design; give it a little more. */
  await p.waitForTimeout(13000);

  const body = await p.innerText('body');
  ok('the empty screen explains itself', /did not start|too old to run/.test(body), body.slice(0, 60));
  ok('the report names the browser', /browser: Mozilla/.test(body));
  ok('the report lists what the engine supports', /features: .*modules=/.test(body));
  ok('the report names the download that failed', /Could not download/.test(body));
  ok('there is a way back', await p.getByRole('button', { name: 'Reload' }).isVisible());
  await p.screenshot({ path: `${SP}/device-boot-failure.png`, fullPage: true });
  await p.close();
}

/* ---- 3b. the old copy actually runs ---------------------------------- */
/* Parsing as ES2015 only proves an old engine can read it. This proves it
   does something once read: the polyfills load, SystemJS resolves the
   entry, and React puts the board on the screen — with the modern build
   blocked so nothing else can be doing the rendering. No old engine is
   involved, which is the honest limit of this check; what it catches is
   a legacy bundle that is broken in itself, and that is the failure a
   modern-only test can never see. */
{
  const polyName = (html.match(/id="vite-legacy-polyfill" src="\/assets\/([^"]+)"/) || [])[1];
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  /* A predicate, not a glob: Playwright's globs have no "not" and the
     legacy chunks share the modern prefix. */
  await p.route((u) => /\/assets\/(index|polyfills)-/.test(u.pathname) && !/legacy/.test(u.pathname),
    (r) => r.abort());
  await p.goto('http://127.0.0.1:4173/');
  await p.evaluate((s) => localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
  await p.reload();
  await p.waitForTimeout(500);

  ok('the modern build was kept out', !(await p.evaluate(() => !!window.__dhhBootedAt)));

  await p.evaluate(([poly, entry]) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/assets/' + poly;
    s.onload = () => { window.System.import('/assets/' + entry).then(resolve, reject); };
    s.onerror = reject;
    document.body.appendChild(s);
  }), [polyName, legacyName]);
  await p.waitForTimeout(2500);

  ok('the ES2015 build renders the board', await p.evaluate(() => !!window.__dhhBootedAt));
  const body = await p.innerText('body');
  ok('and it is the real board, not an error', /Live Board|Job|Team/i.test(body) && !/did not start/.test(body));
  ok('no errors from the ES2015 build', errs.filter((e) => !/Failed to fetch|ERR_FAILED/.test(e)).length === 0,
     errs.join(' | '));
  await p.close();
}

/* ---- 4. a copy button that cannot copy ------------------------------- */
async function copyRun(label, { breakClipboard }) {
  const p = await b.newPage({ viewport: { width: 1400, height: 1300 } });
  if (breakClipboard) {
    /* An iPad before iOS 13.4, an in-app browser, a page on plain http:
       no Clipboard API at all, and the old fallback refused too. */
    await p.addInitScript(() => {
      try { Object.defineProperty(navigator, 'clipboard', { get: () => undefined }); } catch (e) {}
      document.execCommand = () => false;
    });
  }
  await p.goto('http://127.0.0.1:4173/');
  await p.evaluate((s) => localStorage.setItem('__dhh_mock_kv__', JSON.stringify(s)), seed);
  await p.evaluate(() => localStorage.removeItem('dhh-me'));
  await p.reload();
  await p.waitForTimeout(1200);
  await p.locator('input[placeholder*="Ahmed"]').fill('Haris');
  await p.getByRole('button', { name: 'Start' }).click();
  await p.waitForTimeout(900);
  await p.locator('input[type=date]').first().fill('2026-09-01');
  await p.waitForTimeout(2000);

  const btn = p.getByRole('button', { name: /Copy for the technician|Copy for PMS/ }).first();
  const found = await btn.count();
  if (!found) { ok(`${label}: a copy button is on the board`, false); await p.close(); return; }
  await btn.click();
  await p.waitForTimeout(900);
  const toast = await p.innerText('body');
  await p.close();
  return toast;
}

{
  const good = await copyRun('working clipboard', { breakClipboard: false });
  ok('a copy that worked says so', /Copied/.test(good || ''));

  const broken = await copyRun('no clipboard', { breakClipboard: true });
  ok('a copy that failed admits it', /would not let the app copy/.test(broken || ''));
  ok('a failed copy does not claim success', !/Copied \d+ job|Copied — paste/.test(broken || ''));
}

await b.close();
console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
