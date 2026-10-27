// Cloudflare Worker: global announcement backend. The owner is read from roles.json on GitHub.
// Deploy: Cloudflare > Workers > Create > name it "announcement" > paste this > Deploy. REQUIRED: Settings > Bindings > add a KV namespace binding named ANN, otherwise isolates do not share messages and other users miss announcements.
// OPTIONAL (recommended): Settings > Variables and Secrets > add a secret named KEY. The owner then runs getgenv().UH_BROADCAST_KEY = "<same value>" before the script. Without KEY, anyone who knows an owner's name or id could post.
const ROLES_URL = "https://raw.githubusercontent.com/Elliot12-wq/uh-mod-visual-system/main/roles.json";
const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const out = (c, o) => new Response(JSON.stringify(o), { status: c, headers: H });
const err = (c, e) => out(c, { error: e });
let mem = { id: 0, last: 0, msgs: [] }, own = { at: 0, list: [] }, kvAt = 0;
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
const load = async (env, fresh) => {
  if (env && env.ANN && (fresh || Date.now() - kvAt > 4000)) {
    kvAt = Date.now();
    try {
      const v = await env.ANN.get("s", fresh ? { type: "json" } : { type: "json", cacheTtl: 30 });
      if (v && Array.isArray(v.msgs)) {
        const seen = new Set(mem.msgs.map(m => m.id));
        mem = { id: Math.max(mem.id, v.id || 0), last: Math.max(mem.last, v.last || 0), msgs: mem.msgs.concat(v.msgs.filter(m => !seen.has(m.id))).sort((a, b) => a.id - b.id).slice(-50) };
      }
    } catch (_) {}
  }
  return mem;
};
const save = async (env, s) => { mem = s; if (env && env.ANN) { try { await env.ANN.put("s", JSON.stringify(s)); kvAt = Date.now(); } catch (_) {} } };
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: H });
    const u = new URL(req.url);
    if (req.method === "GET" && u.pathname === "/poll") {
      const s = await load(env), a = u.searchParams.get("after"), n = Number(a);
      return out(200, { id: s.id, now: Date.now(), msgs: a === null || !Number.isFinite(n) ? [] : s.msgs.filter(m => m.id > n) });
    }
    if (req.method === "GET" && u.pathname === "/owner") return out(200, { owners: (await owners()).map(o => o.name).filter(Boolean) });
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/health")) return out(200, { ok: true, kv: !!(env && env.ANN), key: !!(env && env.KEY) });
    if (req.method === "POST" && u.pathname === "/send") {
      let j; try { j = JSON.parse((await req.text()).slice(0, 4096)); } catch (_) { return err(400, "bad json"); }
      if (!j || typeof j !== "object") return err(400, "bad json");
      if (env && env.KEY && String(j.key || "") !== String(env.KEY)) return err(403, "bad or missing key (set getgenv().UH_BROADCAST_KEY)");
      const name = String(j.user || "").toLowerCase(), id = Math.floor(Number(j.userId)) || 0;
      if (!(await owners()).some(o => (o.name && o.name === name) || (o.id && o.id === id))) return err(403, "not an owner in roles.json");
      const text = String(j.text || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 200);
      if (!text) return err(400, "empty message");
      const s = await load(env, true);
      if (Date.now() - s.last < 2000) return err(429, "too fast, wait 2s");
      s.last = Date.now();
      s.id = Math.max(Date.now(), s.id + 1);
      s.msgs.push({ id: s.id, text });
      s.msgs = s.msgs.filter(m => m.id > Date.now() - 3600000).slice(-50);
      await save(env, s);
      return out(200, { id: s.id });
    }
    return err(404, "not found");
  }
};
