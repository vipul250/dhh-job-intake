/* Stands in for Supabase Auth + the kv_store REST table, so the real
   production code path (createClient, signInWithOtp, verifyOtp) is exercised
   without sending a single email or touching any real project. */
export async function installStubs(page, seed, { code = "123456", allowed = [] } = {}) {
  const kv = new Map(Object.entries(seed || {}));
  const ver = new Map([...kv.keys()].map(k => [k, "seed"]));
  const stamp = () => new Date().toISOString() + Math.random().toString(36).slice(2, 6);
  const J = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const eqOf = (u, f) => { const v = u.searchParams.get(f); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const sent = [];

  await page.route('**/auth/v1/**', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const path = u.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : {};

    if (path.endsWith('/otp')) {
      const email = String(body.email || '').toLowerCase();
      // shouldCreateUser:false is the allowlist — an unknown address must not
      // receive a code, and Supabase answers with exactly this shape.
      if (allowed.length && !allowed.includes(email)) {
        return route.fulfill(J({ code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' }, 422));
      }
      sent.push(email);
      return route.fulfill(J({}));
    }
    if (path.endsWith('/verify') || path.endsWith('/token')) {
      const email = String(body.email || '').toLowerCase();
      if (String(body.token || '') !== code) {
        return route.fulfill(J({ error: 'invalid_grant', error_description: 'Token has expired or is invalid' }, 403));
      }
      const user = { id: 'stub-user', aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
      return route.fulfill(J({ access_token: 'stub.access.token', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now()/1000)+3600, refresh_token: 'stub-refresh', user }));
    }
    if (path.endsWith('/user')) {
      return route.fulfill(J({ id: 'stub-user', email: 'x@deluxehomes.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }));
    }
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill(J({}));
  });

  await page.route('**/rest/v1/kv_store*', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method(); const key = eqOf(u, 'key');
    if (m === 'GET') {
      const like = u.searchParams.get('key');
      if (like && like.startsWith('like.')) {
        const pre = like.slice(5).replace(/%$/, '');
        return route.fulfill(J([...kv.keys()].filter(k => k.startsWith(pre)).map(k => ({ key: k }))));
      }
      if (key == null || !kv.has(key)) return route.fulfill(J([]));
      return route.fulfill(J([{ key, value: kv.get(key), updated_at: ver.get(key) ?? 'seed' }]));
    }
    if (m === 'POST') {
      const rows = JSON.parse(req.postData() || '[]'); const list = Array.isArray(rows) ? rows : [rows];
      const merge = /merge-duplicates/.test(req.headers()['prefer'] || '');
      const out = [];
      for (const r of list) {
        if (kv.has(r.key) && !merge) return route.fulfill(J({ code: '23505', message: 'duplicate key' }, 409));
        kv.set(r.key, r.value); const v = r.updated_at || stamp(); ver.set(r.key, v);
        out.push({ key: r.key, value: r.value, updated_at: v });
      }
      return route.fulfill(J(out, 201));
    }
    if (m === 'PATCH') {
      const b = JSON.parse(req.postData() || '{}'); const expect = eqOf(u, 'updated_at');
      if (key == null || !kv.has(key)) return route.fulfill(J([]));
      if (expect != null && (ver.get(key) ?? 'seed') !== expect) return route.fulfill(J([]));
      kv.set(key, b.value); const v = b.updated_at || stamp(); ver.set(key, v);
      return route.fulfill(J([{ key, value: b.value, updated_at: v }]));
    }
    return route.fulfill(J([]));
  });

  return { kv, sent };
}
