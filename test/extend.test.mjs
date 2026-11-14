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
let aiCalls = [];
const realFetch = globalThis.fetch;
const weekJson = titel => ({ dagen: Array.from({ length: 7 }, (_, d) => ({ dag: d, type: "duurrit", minuten: 60, zone: "Z2", titel, beschrijving: "Rustig." })), tips: "x" });
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.groq.com")) return realFetch(url, init);
  const p = JSON.parse(init.body).messages[1].content;
  aiCalls.push(p);
  let content = "{}";
  const m = p.match(/trainingsschema van (\d+) weken/);
  if (m) content = JSON.stringify({ samenvatting: "ok", weken: Array.from({ length: Number(m[1]) }, (_, i) => ({ week: i + 1, fase: "opbouw", focus: "Basis", uren: 6 })), week1: weekJson("Eerste") });
  else if (p.includes("als voorlopige week")) content = JSON.stringify({ uitleg: "Voorlopig.", week: weekJson("Voorlopig") });
  else if (p.includes("pas die aan op de terugmelding")) content = JSON.stringify({ uitleg: "Bijgesteld.", week: weekJson("Bevestigd") });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};
const amsterdam = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
let n = 0;
async function api(env, method, path, body, cookie) {
  const h = { "CF-Connecting-IP": `10.5.0.${++n}` }; if (body) h["Content-Type"] = "application/json"; if (cookie) h.Cookie = cookie;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  const sc = res.headers.get("Set-Cookie"); const m = sc && sc.match(/__Host-ws=([0-9a-f]{64})/);
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: m ? `__Host-ws=${m[1]}` : null };
}
async function setup(startOffsetDays) {
  const env = { DB: new FakeD1(), GROQ_API_KEY: "x" };
  const cookie = (await api(env, "POST", "/api/register", { username: "vooruit", password: "een-lang-wachtwoord", consent: true })).cookie;
  const created = await api(env, "POST", "/api/plan/create", { intake: { doel: "Rijden", datum: null, niveau: "gevorderd", uren_per_week: 6, dagen: [1, 3, 5, 6], geboortedatum: "1990-06-15", meter: "none" } }, cookie);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const today = amsterdam();
  const wd = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(today, -wd + startOffsetDays); // maandag van deze week (+/- weken)
  env.DB.db.prepare("UPDATE plans SET start_date = ?").run(start);
  return { env, cookie, today, wd, start, needed: Math.min(8, Math.floor(diff(start, addDays(today, 13)) / 7) + 1) };
}
async function fill(env, cookie, needed) {
  let calls = 0, data;
  for (let i = 0; i < 6; i++) {
    const before = aiCalls.length;
    data = (await api(env, "POST", "/api/plan/extend", {}, cookie)).data;
    if (aiCalls.length === before) break;
    calls++;
    if (data.weeks.length >= needed) break;
  }
  return { calls, data };
}

test("het schema loopt altijd twee weken vooruit met voorlopige weken", async () => {
  const { env, cookie, needed } = await setup(0);
  aiCalls = [];
  const { calls, data } = await fill(env, cookie, needed);
  assert.equal(data.weeks.length, needed, `weken: ${data.weeks.length}, verwacht ${needed}`);
  assert.equal(calls, needed - 1, "één AI-aanvraag per ontbrekende week");
  assert.ok(data.weeks.slice(1).every(w => w.voorlopig === true));
  assert.ok(!data.weeks[0].voorlopig);
  const before = aiCalls.length;
  await api(env, "POST", "/api/plan/extend", {}, cookie);
  assert.equal(aiCalls.length, before, "als alles er al staat, is er geen AI-aanvraag nodig");
});

test("terugblik vervangt de volgende voorlopige week, bewaart voorbije en eigen dagen en haalt latere weken weg", async () => {
  const { env, cookie, today, wd, start, needed } = await setup(-7);
  aiCalls = [];
  await fill(env, cookie, needed);
  // eigen aanpassing in voorlopige week 2 (dinsdag)
  const edit = await api(env, "POST", "/api/plan/workout", { week_no: 2, day_no: 1, workout: { type: "duurrit", minuten: 75, zone: "Z2", titel: "Mijn rit", beschrijving: "Zelf gekozen.", blokken: null } }, cookie);
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.week.dagen[1].handmatig, true, "aanpassing in een voorlopige week wordt onthouden");
  const result = await api(env, "POST", "/api/plan/checkin", { week_no: 1, gedaan_pct: 80, gevoel: 4, klachten: false, uren_gedaan: 5 }, cookie);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const weeks = result.data.weeks;
  assert.equal(weeks.length, 2, "week 3 en later zijn verwijderd en worden opnieuw gemaakt");
  assert.ok(!weeks[1].voorlopig, "week 2 is nu bevestigd");
  assert.equal(weeks[1].dagen[1].titel, "Mijn rit");
  for (const day of weeks[1].dagen.filter(d => d.type !== "rust")) {
    const past = addDays(addDays(start, 7), day.dag) < today;
    if (day.dag !== 1) assert.equal(day.titel, past ? "Voorlopig" : "Bevestigd", `dag ${day.dag}`);
  }
  const refill = await fill(env, cookie, needed);
  assert.equal(refill.data.weeks.length, needed);
  assert.ok(refill.data.weeks.slice(2).every(w => w.voorlopig));
  void wd;
});

test("de chat ziet de weekterugblik van de laatste bevestigde week als open, ook met voorlopige weken", async () => {
  const { env, cookie, needed } = await setup(-7);
  await fill(env, cookie, needed);
  aiCalls = [];
  await api(env, "POST", "/api/coach/chat", { week_no: 2, day_no: 0, bericht: "Hoe gaat het?", global: true }, cookie);
  assert.ok(aiCalls.some(p => p.includes("Week 1 is afgelopen en er is nog geen terugblik")), "de coach vraagt naar week 1");
});
