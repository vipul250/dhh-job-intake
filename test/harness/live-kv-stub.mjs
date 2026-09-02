/* Drives the EXACT JavaScript deployed to dhh-job-intake.vercel.app, with
   the Supabase REST endpoint stubbed by an in-memory kv_store. The real
   production database is never contacted, so nothing here can write test
   rows into the department's live data. */
import fs from 'fs';
export function installKvStub(page, seed) {
  const kv = new Map(Object.entries(seed || {}));
  const ver = new Map();
  for (const k of kv.keys()) ver.set(k, "seed");
  const stamp = () => new Date().toISOString() + Math.random().toString(36).slice(2, 6);
  const J = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // searchParams already decodes; decoding twice breaks on a literal %.
  const eqOf = (u, f) => { const v = u.searchParams.get(f); return v && v.startsWith('eq.') ? v.slice(3) : null; };

  return page.route('**/rest/v1/kv_store*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const key = eqOf(u, 'key');

    if (m === 'GET') {
      const like = u.searchParams.get('key');
      if (like && like.startsWith('like.')) {
        const pre = like.slice(5).replace(/%$/, '');
        return route.fulfill(J([...kv.keys()].filter(k => k.startsWith(pre)).map(k => ({ key: k }))));
      }
      if (key == null) return route.fulfill(J([]));
      if (!kv.has(key)) return route.fulfill(J([]));
      return route.fulfill(J([{ key, value: kv.get(key), updated_at: ver.get(key) ?? 'seed' }]));
    }

    if (m === 'POST') {
      const rows = JSON.parse(req.postData() || '[]');
      const list = Array.isArray(rows) ? rows : [rows];
      const merge = /merge-duplicates/.test(req.headers()['prefer'] || '');
      const out = [];
      for (const r of list) {
        if (kv.has(r.key) && !merge) {
          return route.fulfill(J({ code: '23505', message: 'duplicate key' }, 409));
        }
        kv.set(r.key, r.value);
        const v = r.updated_at || stamp();
        ver.set(r.key, v);
        out.push({ key: r.key, value: r.value, updated_at: v });
      }
      return route.fulfill(J(out, 201));
    }

    if (m === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const expect = eqOf(u, 'updated_at');
      if (key == null || !kv.has(key)) return route.fulfill(J([]));
      if (expect != null && (ver.get(key) ?? 'seed') !== expect) return route.fulfill(J([]));
      kv.set(key, body.value);
      const v = body.updated_at || stamp();
      ver.set(key, v);
      return route.fulfill(J([{ key, value: body.value, updated_at: v }]));
    }
    return route.fulfill(J([]));
  }).then(() => kv);
}
