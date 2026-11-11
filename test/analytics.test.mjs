import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";

const BASE = "https://wielerschema.test";
class FakeD1 {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) { const db = this.db; return {
    args: [], bind(...a) { this.args = a.map(v => (v === undefined ? null : v)); return this; },
    async first() { return db.prepare(sql).get(...this.args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...this.args) }; },
    async run() { const r = db.prepare(sql).run(...this.args); return { meta: { changes: r.changes } }; } }; }
  async batch(s) { for (const x of s) await x.run(); return []; }
}
let n = 0;
async function api(env, method, path, body, cookie) {
  const h = { "CF-Connecting-IP": `10.2.0.${++n}` }; if (body) h["Content-Type"] = "application/json"; if (cookie) h.Cookie = cookie;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  const sc = res.headers.get("Set-Cookie"); const m = sc && sc.match(/__Host-ws=([0-9a-f]{64})/);
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: m ? `__Host-ws=${m[1]}` : null };
}
const day = (off) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };

test("analyse: leeg account geeft nette lege kaarten", async () => {
  const env = { DB: new FakeD1(), GROQ_API_KEY: "x" };
  const r = await api(env, "POST", "/api/register", { username: "leeg", password: "een-lang-wachtwoord", consent: true });
  const a = await api(env, "GET", "/api/analytics", undefined, r.cookie);
  assert.equal(a.status, 200);
  assert.equal(a.data.nacht, null);
  assert.equal(a.data.gereedheid, null);
  assert.equal(a.data.reeks.length, 84);
  assert.equal((await api(env, "GET", "/api/analytics")).status, 401);
});

test("analyse: belasting, vorm, nacht en gereedheid uit opgeslagen gegevens", async () => {
  const env = { DB: new FakeD1(), GROQ_API_KEY: "x" };
  const r = await api(env, "POST", "/api/register", { username: "vol", password: "een-lang-wachtwoord", consent: true });
  const uid = env.DB.db.prepare("SELECT id FROM users").get().id;
  const ins = env.DB.db.prepare("INSERT INTO intervals_activities (user_id, activity_id, activity_date, data, updated_at) VALUES (?,?,?,?,?)");
  for (let i = 1; i <= 20; i += 2) ins.run(uid, "fit:" + i, day(-i), JSON.stringify({ elapsed_time: 3600, average_heartrate: 140, icu_training_load: 60, samples: Array(300).fill({ latitude: 53 }) }), 1);
  ins.run(uid, "fit:p", day(-1), JSON.stringify({ elapsed_time: 7200, average_watts: 200 }), 1); // geen plan/FTP -> schatting
  const w = env.DB.db.prepare("INSERT INTO intervals_wellness (user_id, wellness_date, data, updated_at) VALUES (?,?,?,?)");
  for (let i = 0; i < 8; i++) w.run(uid, day(-i), JSON.stringify({ sleepSecs: (7 - (i === 0 ? 1.5 : 0)) * 3600, sleepScore: 80, hrv: 60 + (i === 0 ? 8 : i % 3), restingHR: 50 - (i === 0 ? 2 : 0), weight: 71.4 }), 1);
  const a = await api(env, "GET", "/api/analytics?dagen=28", undefined, r.cookie);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const d = a.data;
  assert.equal(d.reeks.length, 28);
  assert.ok(d.kaarten.ctl > 0 && d.kaarten.atl > 0, JSON.stringify(d.kaarten));
  assert.equal(d.kaarten.gewicht.kg, 71.4);
  assert.equal(d.nacht.nachten.length, 7);
  assert.equal(d.nacht.laatste.uren, 5.5);
  assert.ok(d.nacht.slaapschuld_uren >= 2.5);
  assert.ok(d.gereedheid.score >= 0 && d.gereedheid.score <= 100);
  assert.ok(d.gereedheid.hrv.verschil > 0);
  assert.ok(d.belastingsverhouding.acwr > 0);
  assert.equal(d.bronnen.intervals, 10);
  assert.equal(d.bronnen.schatting, 1);
  console.log(JSON.stringify({ kaarten: d.kaarten, gereedheid: d.gereedheid?.score, risico: d.belastingsrisico, bel: d.belastingsverhouding }));
});
