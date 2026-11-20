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
const questionPrompts = [];
const realFetch = globalThis.fetch;
const week = () => ({ dagen: Array.from({ length: 7 }, (_, d) => ({ dag: d, type: "duurrit", minuten: 60, zone: "Z2", titel: "Duur", beschrijving: "Rustig." })), tips: "x" });
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.groq.com")) return realFetch(url, init);
  const p = JSON.parse(init.body).messages[1].content; prompts.push(p);
  let content = "{}";
  const m = p.match(/trainingsschema van (\d+) weken/);
  if (p.includes("vervolgvragen")) { questionPrompts.push(p); content = JSON.stringify({ vragen: [{ id: "v1", vraag: "Hoeveel uur train je nu per week?" }, { id: "v2", vraag: "Wat voor soort ondergrond fiets je meestal (bijv. vlak, heuvelachtig, bergachtig)?" }, { id: "v3", vraag: "Op wat voor soort fiets rijd je, een racefiets?" }, { id: "v4", vraag: "Heb je ervaring met intervaltraining?" }] }); }
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

test("vervolgvragen: de coach vraagt niet naar ondergrond of soort fiets, ook niet als de AI dat wel probeert", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const r = await api(env, "POST", "/api/intake/questions", { intake: base() }, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.vragen.map(v => v.vraag), ["Hoeveel uur train je nu per week?", "Heb je ervaring met intervaltraining?"]);
  assert.deepEqual(r.data.vragen.map(v => v.id), ["v1", "v2"], "ids lopen netjes door");
  const prompt = questionPrompts.at(-1);
  assert.match(prompt, /Vraag niet naar de ondergrond of het terrein/);
  assert.match(prompt, /racefiets/);
  assert.ok(!prompt.includes("terrein, materiaal"), "terrein en materiaal staan niet meer als voorbeeld");
});