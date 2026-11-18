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
const ZOHO = { ZOHO_LIST_KEY: "listkey-123", ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "secret", ZOHO_REFRESH_TOKEN: "refresh", ZOHO_DC: "eu" };
let zohoCalls = [];
const wrapped = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("accounts.zoho.")) { zohoCalls.push({ url: u, body: String(init.body) }); return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }); }
  if (u.includes("campaigns.zoho.")) {
    zohoCalls.push({ url: u, body: String(init.body), auth: init.headers.Authorization });
    return new Response(JSON.stringify(globalThis.__zohoFail ? { status: "error", code: "2501" } : { status: "success", code: "0" }), { status: 200 });
  }
  return wrapped(url, init);
};
const reg = (env, body) => api(env, "POST", "/api/register", { username: "renner", password: "een-lang-wachtwoord", consent: true, ...body });

test("nieuwsbrief: aangevinkt vakje met e-mailadres meldt aan bij Zoho met de lijstsleutel", async () => {
  zohoCalls = []; globalThis.__zohoFail = false;
  const env = { ...makeEnv(), ...ZOHO };
  const r = await reg(env, { email: "Renner@Voorbeeld.nl", nieuwsbrief: true });
  assert.equal(r.status, 200);
  const sub = zohoCalls.find(c => c.url.includes("campaigns.zoho.eu/api/v1.1/json/listsubscribe"));
  assert.ok(sub, "listsubscribe aangeroepen");
  assert.equal(sub.auth, "Zoho-oauthtoken tok");
  const params = new URLSearchParams(sub.body);
  assert.equal(params.get("listkey"), "listkey-123");
  assert.equal(params.get("contactinfo"), "{Contact Email:renner@voorbeeld.nl}");
});

test("nieuwsbrief: zonder vinkje, zonder e-mailadres of zonder instellingen geen aanmelding", async () => {
  zohoCalls = [];
  const env = { ...makeEnv(), ...ZOHO };
  assert.equal((await reg(env, { email: "a@voorbeeld.nl" })).status, 200);
  assert.equal(zohoCalls.length, 0, "geen vinkje");
  assert.equal((await reg(makeEnv(), { nieuwsbrief: true })).status, 200);
  assert.equal(zohoCalls.length, 0, "geen e-mailadres");
  assert.equal((await reg({ ...makeEnv() }, { email: "a@voorbeeld.nl", nieuwsbrief: true })).status, 200);
  assert.equal(zohoCalls.length, 0, "Zoho niet ingesteld: account maken lukt toch");
});

test("nieuwsbrief: een fout bij Zoho stopt het aanmaken van een account niet, en vreemde adressen gaan niet door", async () => {
  zohoCalls = []; globalThis.__zohoFail = true;
  const env = { ...makeEnv(), ...ZOHO };
  assert.equal((await reg(env, { email: "a@voorbeeld.nl", nieuwsbrief: true })).status, 200);
  globalThis.__zohoFail = false; zohoCalls = [];
  assert.equal((await reg({ ...makeEnv(), ...ZOHO }, { username: "renner2", email: "a,b}@voorbeeld.nl", nieuwsbrief: true })).status, 200);
  assert.equal(zohoCalls.filter(c => c.url.includes("listsubscribe")).length, 0, "adres met komma of accolade niet doorsturen");
});

test("nieuwsbrief: vinkje bij Account meldt aan zonder dat er iets anders hoeft te veranderen", async () => {
  zohoCalls = []; globalThis.__zohoFail = false;
  const env = { ...makeEnv(), ...ZOHO };
  const cookie = (await reg(env, { email: "a@voorbeeld.nl" })).cookie;
  const save = body => api(env, "POST", "/api/account/credentials", { username: "renner", current_password: "een-lang-wachtwoord", ...body }, cookie);
  assert.equal((await save({ email: "a@voorbeeld.nl" })).status, 400, "niets gewijzigd");
  assert.equal((await save({ email: "a@voorbeeld.nl", nieuwsbrief: true })).status, 200);
  assert.equal(zohoCalls.filter(c => c.url.includes("listsubscribe")).length, 1);
});
