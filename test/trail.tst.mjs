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
const admins = new WeakMap();
async function adminCookie(env) { if (!admins.has(env)) admins.set(env, await signup(env, "beheer", "10.7.7.7")); return admins.get(env); }
const me = (env, cookie) => api(env, "GET", "/api/me", undefined, cookie).then(r => r.data);
const trial = (env, cookie) => api(env, "POST", "/api/pass/trial", {}, cookie);

test("proef: één keer 3 dagen gratis met alle pasfuncties, met een melding", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env, "renner", "10.1.1.1");
  let m = await me(env, cookie);
  assert.equal(m.pas.proef_beschikbaar, true);
  assert.equal(m.pas.actief, false);
  const before = Date.now();
  const r = await trial(env, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const days = (new Date(r.data.verloopt) - before) / 86400000;
  assert.ok(days > 2.99 && days < 3.01, String(days));
  m = await me(env, cookie);
  assert.equal(m.pas.actief, true);
  assert.equal(m.pas.proef, true);
  assert.equal(m.pas.proef_beschikbaar, false);
  assert.deepEqual(m.limieten, { weken: 16, wedstrijden: 15, chat_per_dag: null });
  assert.match(m.meldingen[0].tekst, /gratis proef van 3 dagen is gestart en loopt tot/);
  assert.equal((await trial(env, cookie)).status, 409, "maar één keer tegelijk");
});

test("proef: na afloop is de pas weg en kan de proef niet nog een keer", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env, "renner", "10.1.1.1");
  await trial(env, cookie);
  env.DB.db.prepare("UPDATE passes SET expires_at = ?").run(Date.now() - 1000);
  const m = await me(env, cookie);
  assert.equal(m.pas.actief, false);
  assert.equal(m.pas.proef_beschikbaar, false);
  const again = await trial(env, cookie);
  assert.equal(again.status, 409);
  assert.match(again.data.message, /al gebruikt/);
  assert.equal((await api(env, "POST", "/api/pass/trial", {})).status, 401, "inloggen is nodig");
});

test("proef: niet voor wie al een (betaalde) pas heeft gehad, en betalen na de proef telt als nieuwe pas", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const paid = await signup(env, "betaald", "10.1.1.1");
  const admin = await adminCookie(env);
  await api(env, "POST", "/api/admin/pass", { username: "betaald" }, admin);
  assert.equal((await me(env, paid)).pas.proef_beschikbaar, false);
  assert.equal((await trial(env, paid)).status, 409);
  const tester = await signup(env, "tester", "10.2.2.2");
  await trial(env, tester);
  let list = (await api(env, "GET", "/api/admin/users", undefined, admin)).data.accounts;
  assert.equal(list.find(a => a.gebruiker === "tester").proef, true);
  assert.equal(list.find(a => a.gebruiker === "betaald").proef, false);
  await api(env, "POST", "/api/admin/pass", { username: "tester" }, admin);
  const m = await me(env, tester);
  assert.equal(m.pas.proef, false, "na betalen is het geen proef meer");
  assert.ok(m.meldingen.some(x => /geactiveerd/.test(x.tekst)), "melding zegt geactiveerd, niet verlengd");
  list = (await api(env, "GET", "/api/admin/users", undefined, admin)).data.accounts;
  assert.equal(list.find(a => a.gebruiker === "tester").proef, false);
});

test("proef: export en verwijderen ruimen de proef op", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "renner", "10.9.9.9");
  assert.equal((await trial(env, cookie)).status, 200);
  const exp = await api(env, "GET", "/api/account/export", undefined, cookie);
  assert.ok(exp.data.proef_gebruikt);
  assert.equal((await api(env, "POST", "/api/account/delete", { password: "een-lang-wachtwoord" }, cookie)).status, 200);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM trials").get().n, 0);
});