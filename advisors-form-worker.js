/**
 * Cloudflare Worker: advisors.html intro form -> EmailOctopus (API v2)
 *
 * Paste this into the "weathered-heart-1e2d" Worker (Edit code), then set in
 * Settings -> Variables and Secrets:
 *   EO_API_KEY   (Secret)  EmailOctopus API key  (Account -> Integrations & API)
 *   EO_LIST_ID   (Text)    The list ID           (List -> Settings, a UUID)
 *   ALLOWED_ORIGINS (Text) Comma-separated, e.g. https://real.gold,https://www.real.gold
 *
 * In the EmailOctopus list, add these custom fields (List -> Fields) with
 * exactly these merge tags, or EmailOctopus rejects the request:
 *   FirstName, LastName (exist by default), Phone, LinkedIn, Notes  (all Text)
 * Tags applied automatically: "advisor-page", plus "roundtable" if ticked.
 */

const EO_BASE = 'https://api.emailoctopus.com';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);

    const cors = {
      'Access-Control-Allow-Origin': originOk ? (origin || '*') : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!originOk) return json({ error: 'Origin not allowed' }, 403);

    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    // Honeypot: bots fill the hidden "website" field. Pretend success, do nothing.
    if (data.website) return json({ ok: true });

    const clip = (v, n = 500) => String(v ?? '').trim().slice(0, n);
    const email = clip(data.email, 254).toLowerCase();
    const name = clip(data.name, 200);
    if (name.length < 2) return json({ error: 'Name required' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'Valid email required' }, 400);

    const [first, ...rest] = name.split(/\s+/);
    const fields = { FirstName: first, LastName: rest.join(' ') };
    const phone = clip(data.phone, 50);
    const linkedin = clip(data.linkedin, 300);
    const notes = clip(data.notes, 2000);
    if (phone) fields.Phone = phone;
    if (linkedin) fields.LinkedIn = linkedin;
    if (notes) fields.Notes = notes;

    const tags = { 'advisor-page': true };
    if (data.roundtable === true) tags.roundtable = true;

    // PUT = create-or-update, so a repeat submission updates instead of failing with 409.
    const res = await fetch(`${EO_BASE}/lists/${env.EO_LIST_ID}/contacts`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.EO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email_address: email, fields, tags, status: 'subscribed' }),
    });

    if (res.ok) return json({ ok: true });

    const detail = await res.text();
    console.error('EmailOctopus error', res.status, detail); // visible in Worker logs
    return json({ error: 'Could not save contact' }, 502);
  },
};
