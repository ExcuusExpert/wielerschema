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
let prompts = [];
const realFetch = globalThis.fetch;
const week = () => ({ dagen: Array.from({ length: 7 }, (_, d) => ({ dag: d, type: "duurrit", minuten: 60, zone: "Z2", titel: "Duur", beschrijving: "Rustig." })), tips: "x" });
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.groq.com")) return realFetch(url, init);
  const p = JSON.parse(init.body).messages[1].content; prompts.push(p);
  let content = "{}";
  const m = p.match(/trainingsschema van (\d+) weken/);
  if (m) content = JSON.stringify({ samenvatting: "ok", weken: Array.from({ length: Number(m[1]) }, (_, i) => ({ week: i + 1, fase: "opbouw", focus: "Basis", uren: 6 })), week1: week() });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};
const future = d => { const x = new Date(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const base = (extra = {}) => ({ doel: "Wedstrijdseizoen", datum: null, niveau: "gevorderd", uren_per_week: 6, dagen: [1, 3, 5, 6], geboortedatum: "1990-06-15", meter: "none", ...extra });
let n = 0;
async function api(env, method, path, body, cookie) {
  const h = { "CF-Connecting-IP": `10.3.0.${++n}` }; if (body) h["Content-Type"] = "application/json"; if (cookie) h.Cookie = cookie;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  const sc = res.headers.get("Set-Cookie"); const m = sc && sc.match(/__Host-ws=([0-9a-f]{64})/);
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: m ? `__Host-ws=${m[1]}` : null };
}
const signup = async (env, name = "renner") => (await api(env, "POST", "/api/register", { username: name, password: "een-lang-wachtwoord", consent: true })).cookie;
const makeEnv = () => ({ DB: new FakeD1(), GROQ_API_KEY: "x" });

test("wedstrijden: tot 20 weken vooruit, schema maximaal 16 weken, wedstrijd binnen het schema wordt een evenement", async () => {
  const env = makeEnv(); const cookie = await signup(env);
  const races = [{ datum: future(21), naam: "Ronde van Bozum", prioriteit: "B" }, { datum: future(130), naam: "Eindrit", prioriteit: "A" }];
  prompts = [];
  const r = await api(env, "POST", "/api/plan/create", { intake: base({ wedstrijden: races }) }, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.plan.total_weeks, 16);
  assert.equal(r.data.plan.intake.wedstrijden.length, 2);
  const events = env.DB.db.prepare("SELECT title, event_type, event_date FROM plan_events").all();
  assert.equal(events.length, 1, "alleen de wedstrijd binnen het schema wordt een evenement");
  assert.equal(events[0].title, "Ronde van Bozum");
  assert.ok(prompts[0].includes("Ronde van Bozum") && prompts[0].includes("na dit schema") || prompts[0].includes("ná dit schema"), "prompt noemt wedstrijden en het verre hoofddoel");
});

test("wedstrijden: A-wedstrijd binnen het schema bepaalt de lengte", async () => {
  const env = makeEnv(); const cookie = await signup(env);
  const r = await api(env, "POST", "/api/plan/create", { intake: base({ wedstrijden: [{ datum: future(30), naam: "Hoofdrit", prioriteit: "A" }] }) }, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.plan.total_weeks >= 4 && r.data.plan.total_weeks <= 6, String(r.data.plan.total_weeks));
});

test("wedstrijden: ongeldige invoer wordt geweigerd", async () => {
  const env = makeEnv(); const cookie = await signup(env);
  const bad = async (intake) => (await api(env, "POST", "/api/plan/create", { intake }, cookie)).status;
  assert.equal(await bad(base({ wedstrijden: [{ datum: future(150), naam: "Te ver", prioriteit: "A" }] })), 400);
  assert.equal(await bad(base({ wedstrijden: [{ datum: future(3), naam: "Te snel", prioriteit: "A" }] })), 400);
  assert.equal(await bad(base({ wedstrijden: [{ datum: future(20), naam: "A" }, { datum: future(20), naam: "B" }] })), 400);
  assert.equal(await bad(base({ wedstrijden: [{ datum: future(20) }] })), 400);
  assert.equal(await bad(base({ wedstrijden: Array.from({ length: 5 }, (_, i) => ({ datum: future(15 + i), naam: "W" + i })) })), 400);
  assert.equal(await bad(base({ datum: future(150) })), 400);
});

test("eenvoudige weergave: standaard aan onder 16, kiesbaar, blijft bewaard", async () => {
  const env = makeEnv(); const cookie = await signup(env);
  const young = await api(env, "POST", "/api/plan/create", { intake: base({ geboortedatum: "2012-03-01" }) }, cookie);
  assert.equal(young.status, 200, JSON.stringify(young.data));
  let prof = await api(env, "GET", "/api/account/profile", undefined, cookie);
  assert.equal(prof.data.eenvoudig, true, "onder 16: standaard eenvoudig");
  assert.equal(prof.data.profile.eenvoudig, null);
  assert.equal((await api(env, "POST", "/api/account/simple", { eenvoudig: false }, cookie)).status, 200);
  prof = await api(env, "GET", "/api/account/profile", undefined, cookie);
  assert.equal(prof.data.eenvoudig, false);
  // profiel opslaan en een nieuw schema maken wist de keuze niet
  assert.equal((await api(env, "POST", "/api/account/profile", { profile: { birth_date: "2012-03-01", geboortedatum: "2012-03-01", meter: "none" } }, cookie)).status, 200);
  assert.equal((await api(env, "POST", "/api/plan/create", { intake: base({ geboortedatum: "2012-03-01" }) }, cookie)).status, 200);
  prof = await api(env, "GET", "/api/account/profile", undefined, cookie);
  assert.equal(prof.data.eenvoudig, false);
  assert.equal((await api(env, "POST", "/api/account/simple", { eenvoudig: "ja" }, cookie)).status, 400);
});

test("eenvoudige weergave: coach schrijft in eenvoudige taal en kan ook voor een volwassene aan", async () => {
  const env = makeEnv(); const cookie = await signup(env);
  await api(env, "POST", "/api/plan/create", { intake: base() }, cookie);
  prompts = [];
  await api(env, "POST", "/api/coach/chat", { week_no: 1, day_no: 0, bericht: "Hoe gaat het?", global: true }, cookie);
  assert.ok(!prompts.some(p => p.includes("eenvoudige taal")), "volwassene: gewone taal");
  await api(env, "POST", "/api/account/simple", { eenvoudig: true }, cookie);
  prompts = [];
  await api(env, "POST", "/api/coach/chat", { week_no: 1, day_no: 0, bericht: "Hoe gaat het?", global: true }, cookie);
  assert.ok(prompts.some(p => p.includes("eenvoudige taal")), "eenvoudige modus: coach krijgt de taalinstructie");
});
