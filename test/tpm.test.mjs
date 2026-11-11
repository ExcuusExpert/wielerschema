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
const LIMIT = 8000, CHARS_PER_TOKEN = 3; // streng: echte tokenizer is ruimer
let limitOn = false, calls = [];
const realFetch = globalThis.fetch;
function week() { return { dagen: Array.from({ length: 7 }, (_, d) => ({ dag: d, type: "duurrit", minuten: 60, zone: "Z2", titel: "Duur", beschrijving: "Rustig." })), tips: "x" }; }
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.groq.com")) return realFetch(url, init);
  const b = JSON.parse(init.body);
  const input = Math.ceil((b.messages[0].content.length + b.messages[1].content.length) / CHARS_PER_TOKEN);
  const requested = input + b.max_completion_tokens;
  calls.push({ model: b.model, input, out: b.max_completion_tokens, requested });
  if (limitOn && requested > LIMIT) return new Response(JSON.stringify({ error: { message: `Request too large for model \`${b.model}\` on tokens per minute (TPM): Limit ${LIMIT}, Requested ${requested}, please reduce your message size and try again.` } }), { status: 413 });
  const p = b.messages[1].content; let content = "{}";
  if (p.includes("Maak een trainingsschema van")) { const n = Number(p.match(/van (\d+) weken/)[1]); content = JSON.stringify({ samenvatting: "ok", weken: Array.from({ length: n }, (_, i) => ({ week: i + 1, fase: "opbouw", focus: "Basis", uren: 6 })), week1: week() }); }
  else if (p.includes("Nieuw bericht van de gebruiker")) content = JSON.stringify({ antwoord: "Mooie rit gereden!", voorstel: null, week_feedback: null });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};
const future = d => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const INTAKE = { doel: "Toertocht van 120 km", datum: future(70), niveau: "gevorderd", uren_per_week: 6, dagen: [1, 3, 5, 6], geboortedatum: "1990-06-15", meter: "power", ftp: 220, ervaring_jaren: 3, beperkingen: "", opmerkingen: "" };
let n = 0;
async function api(env, method, path, body, cookie) {
  const h = { "CF-Connecting-IP": `10.1.0.${++n}` }; if (body) h["Content-Type"] = "application/json"; if (cookie) h.Cookie = cookie;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  const sc = res.headers.get("Set-Cookie"); const m = sc && sc.match(/__Host-ws=([0-9a-f]{64})/);
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: m ? `__Host-ws=${m[1]}` : null };
}

test("chat en schema blijven onder 8000 tokens met 10 zware FIT-ritten", async () => {
  const env = { DB: new FakeD1(), GROQ_API_KEY: "test" };
  const r = await api(env, "POST", "/api/register", { username: "tpm", password: "een-lang-wachtwoord", consent: true });
  const cookie = r.cookie;
  limitOn = false;
  assert.equal((await api(env, "POST", "/api/plan/create", { intake: INTAKE }, cookie)).status, 200);
  const uid = env.DB.db.prepare("SELECT id FROM users").get().id;
  for (let i = 0; i < 10; i++) {
    const samples = Array.from({ length: 300 }, (_, k) => ({ time: "2026-11-0" + (i % 9 + 1) + "T10:00:00Z", latitude: 53.0881234 + k * 1e-4, longitude: 5.6952123 + k * 1e-4, distance: k * 31.7, speed: 8.123, heartrate: 140 + (k % 20), power: 180 + (k % 30), altitude: 12.4 }));
    const act = { source: "fit", name: "Rit " + i, start_date_local: `2026-11-0${i % 9 + 1}T10:00:00`, elapsed_time: 3600, distance: 30000, average_heartrate: 140, average_watts: 180, samples };
    env.DB.db.prepare("INSERT INTO intervals_activities (user_id, activity_id, activity_date, data, updated_at) VALUES (?,?,?,?,?)").run(uid, "fit:" + i, `2026-11-0${i % 9 + 1}`, JSON.stringify(act), Date.now());
  }
  limitOn = true; calls = [];
  const chat = await api(env, "POST", "/api/coach/chat", { week_no: 1, day_no: 0, bericht: "Hoe ging mijn laatste rit?", global: true }, cookie);
  assert.equal(chat.status, 200, JSON.stringify(chat.data));
  assert.ok(calls.every(c => c.requested <= LIMIT), JSON.stringify(calls));
  console.log("chat:", JSON.stringify(calls));
  calls = [];
  const plan = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, cookie);
  assert.equal(plan.status, 200, JSON.stringify(plan.data));
  console.log("schema:", JSON.stringify(calls));
});

test("schema van 16 weken blijft onder 8000 tokens", async () => {
  const env = { DB: new FakeD1(), GROQ_API_KEY: "test" };
  const r = await api(env, "POST", "/api/register", { username: "lang", password: "een-lang-wachtwoord", consent: true });
  limitOn = true; calls = [];
  const plan = await api(env, "POST", "/api/plan/create", { intake: { ...INTAKE, datum: future(130) } }, r.cookie);
  assert.equal(plan.status, 200, JSON.stringify(plan.data));
  assert.equal(plan.data.plan.total_weeks, 16);
  assert.equal(plan.data.plan.outline.length, 16);
  assert.ok(calls.every(c => c.requested <= LIMIT), JSON.stringify(calls));
});
