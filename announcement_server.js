// Cloudflare Worker: global announcement backend. No key, no SHA-256, no token. The owner is read from roles.json on GitHub.
// Deploy: Cloudflare > Workers > Create > name it "announcement" > paste this > Deploy. (Optional: bind a KV namespace named ANN to keep messages across isolates.)
const ROLES_URL = "https://raw.githubusercontent.com/Elliot12-wq/uh-mod-visual-system/main/roles.json";
const H = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const out = (c, o) => new Response(JSON.stringify(o), { status: c, headers: H });
let mem = { id: 0, last: 0, msgs: [] }, own = { at: 0, list: [] };
async function owners() {
  if (Date.now() - own.at < 20000) return own.list;
  own.at = Date.now() - 15000;
  try {
    const r = await fetch(ROLES_URL + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
    if (r.ok) {
      const d = await r.json();
      own = { at: Date.now(), list: (Array.isArray(d.entries) ? d.entries : [])
        .filter(e => e && String(e.role || "").toLowerCase() === "owner")
        .map(e => ({ name: typeof e.username === "string" ? e.username.toLowerCase() : "", id: Math.floor(Number(e.userId)) || 0 })) };
    }
  } catch (_) {}
  return own.list;
}
const load = async env => { if (env && env.ANN) { try { const v = await env.ANN.get("s", "json"); if (v) return v; } catch (_) {} } return mem; };
const save = async (env, s) => { mem = s; if (env && env.ANN) { try { await env.ANN.put("s", JSON.stringify(s)); } catch (_) {} } };
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: H });
    const u = new URL(req.url);
    if (req.method === "GET" && u.pathname === "/poll") {
      const s = await load(env), a = u.searchParams.get("after");
      return out(200, { id: s.id, msgs: a === null ? [] : s.msgs.filter(m => m.id > Number(a)) });
    }
    if (req.method === "GET" && u.pathname === "/owner") return out(200, { owners: (await owners()).map(o => o.name).filter(Boolean) });
    if (req.method === "POST" && u.pathname === "/send") {
      let j; try { j = JSON.parse((await req.text()).slice(0, 4096)); } catch (_) { return out(400, {}); }
      const name = String(j.user || "").toLowerCase(), id = Math.floor(Number(j.userId)) || 0;
      if (!(await owners()).some(o => (o.name && o.name === name) || (o.id && o.id === id))) return out(403, {});
      const text = String(j.text || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 200);
      const s = await load(env);
      if (!text || Date.now() - s.last < 2000) return out(400, {});
      s.last = Date.now();
      s.id = Math.max(Date.now(), s.id + 1);
      s.msgs.push({ id: s.id, text });
      s.msgs = s.msgs.slice(-50);
      await save(env, s);
      return out(200, { id: s.id });
    }
    return out(404, {});
  }
};
