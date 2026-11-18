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
const grant = async (env, username, body = {}) => { const r = await api(env, "POST", "/api/admin/pass", { username, ...body }, await adminCookie(env)); return { status: r.status, json: async () => r.data }; };
const races = count => Array.from({ length: count }, (_, i) => ({ datum: future(14 + i * 3), naam: `Race ${i + 1}`, prioriteit: "B" }));

test("beheer: alleen ingelogde beheerders komen erin, anderen niet", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "Beheer, anders" };
  const cookie = await signup(env, "renner", "10.1.1.1");
  assert.equal((await api(env, "GET", "/api/admin/users")).status, 401, "niet ingelogd");
  assert.equal((await api(env, "GET", "/api/admin/users", undefined, cookie)).status, 403, "gewoon account");
  assert.equal((await api(env, "POST", "/api/admin/pass", { username: "renner" }, cookie)).status, 403);
  assert.equal((await api(env, "POST", "/api/admin/delete", { username: "renner", bevestig: "renner" }, cookie)).status, 403);
  assert.equal((await api({ ...env, ADMIN_USERS: "" }, "GET", "/api/admin/users", undefined, await adminCookie(env))).status, 403, "zonder ADMIN_USERS is niemand beheerder");
  assert.equal((await api(env, "GET", "/api/me", undefined, cookie)).data.beheerder, false);
  assert.equal((await api(env, "GET", "/api/me", undefined, await adminCookie(env))).data.beheerder, true);
  assert.equal((await grant(env, "bestaatniet")).status, 404);
});

test("pas: activeren duurt 2 maanden, verlengen telt op, maanden kunnen gekozen worden en /api/me toont de status en limieten", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env);
  let me = await api(env, "GET", "/api/me", undefined, cookie);
  assert.equal(me.data.pas.actief, false);
  assert.deepEqual(me.data.limieten, { weken: 8, wedstrijden: 4, chat_per_dag: 10 });
  const plusMonths = (ms, n) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };
  const before = Date.now();
  const first = await (await grant(env, "renner")).json();
  const t1 = new Date(first.verloopt).getTime();
  assert.ok(t1 >= plusMonths(before, 2) && t1 <= plusMonths(Date.now(), 2), "2 maanden vanaf nu");
  const second = await (await grant(env, "renner")).json();
  assert.equal(new Date(second.verloopt).getTime(), plusMonths(t1, 2), "verlengen telt op bij de lopende pas");
  const third = await (await grant(env, "renner", { maanden: 1 })).json();
  assert.equal(new Date(third.verloopt).getTime(), plusMonths(new Date(second.verloopt).getTime(), 1));
  const odd = await (await grant(env, "renner", { maanden: 99 })).json();
  assert.equal(new Date(odd.verloopt).getTime(), plusMonths(new Date(third.verloopt).getTime(), 2), "ongeldige duur wordt 2 maanden");
  me = await api(env, "GET", "/api/me", undefined, cookie);
  assert.equal(me.data.pas.actief, true);
  assert.deepEqual(me.data.limieten, { weken: 16, wedstrijden: 15, chat_per_dag: null });
});

test("pas: een verlopen pas telt niet meer mee", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env);
  await grant(env, "renner");
  env.DB.db.prepare("UPDATE passes SET expires_at = ?").run(Date.now() - 1000);
  assert.equal((await api(env, "GET", "/api/me", undefined, cookie)).data.pas.actief, false);
});

test("pas: gratis maximaal 4 wedstrijden en 8 weken, met pas 15 wedstrijden en 16 weken", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env);
  const tooMany = await api(env, "POST", "/api/plan/create", { intake: base({ wedstrijden: races(5) }) }, cookie);
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.message, /maximaal 4 wedstrijden/);
  assert.match(tooMany.data.message, /2-maandpas/);
  prompts = [];
  const free = await api(env, "POST", "/api/plan/create", { intake: base({ datum: future(130) }) }, cookie);
  assert.equal(free.status, 200, JSON.stringify(free.data));
  assert.equal(free.data.plan.total_weeks, 8);
  await grant(env, "renner");
  const many = await api(env, "POST", "/api/plan/create", { intake: base({ wedstrijden: races(15) }) }, cookie);
  assert.equal(many.status, 200, JSON.stringify(many.data));
  assert.equal((await api(env, "POST", "/api/plan/create", { intake: base({ wedstrijden: races(16) }) }, cookie)).status, 400);
  const long = await api(env, "POST", "/api/plan/create", { intake: base({ datum: future(130) }) }, cookie);
  assert.equal(long.data.plan.total_weeks, 16);
});

test("pas: gratis chat stopt na 10 berichten per dag, met pas niet", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env);
  assert.equal((await api(env, "POST", "/api/plan/create", { intake: base() }, cookie)).status, 200);
  const chat = () => api(env, "POST", "/api/coach/chat", { week_no: 1, day_no: 0, bericht: "Hoe voel je rustige duur?", global: true }, cookie);
  for (let i = 0; i < 10; i++) assert.notEqual((await chat()).data.error, "chat_limit", `bericht ${i + 1}`);
  const blocked = await chat();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, "chat_limit");
  assert.equal(blocked.data.upgrade, true);
  await grant(env, "renner");
  assert.notEqual((await chat()).data.error, "chat_limit");
});

test("pas: de diepe analyse (vorm, gereedheid, nacht) en de pas worden alleen met pas getoond; export en verwijderen nemen de pas mee", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env);
  const uid = env.DB.db.prepare("SELECT id FROM users").get().id;
  env.DB.db.prepare("INSERT INTO intervals_activities (user_id, activity_id, activity_date, data, updated_at) VALUES (?,?,?,?,?)")
    .run(uid, "fit:1", future(-2), JSON.stringify({ elapsed_time: 3600, average_heartrate: 140, icu_training_load: 60 }), 1);
  const free = await api(env, "GET", "/api/analytics", undefined, cookie);
  assert.equal(free.data.pro, false);
  assert.equal(free.data.kaarten.tsb, null);
  assert.equal(free.data.kaarten.atl, null);
  assert.equal(free.data.gereedheid, null);
  assert.equal(free.data.nacht, null);
  await grant(env, "renner");
  const pro = await api(env, "GET", "/api/analytics", undefined, cookie);
  assert.equal(pro.data.pro, true);
  assert.notEqual(pro.data.kaarten.tsb, null);
  const exp = await api(env, "GET", "/api/account/export", undefined, cookie);
  assert.ok(exp.data.pas_verloopt);
  const del = await api(env, "POST", "/api/account/delete", { password: "een-lang-wachtwoord" }, cookie);
  assert.equal(del.status, 200);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM passes").get().n, 0);
});

test("beheer: lijst met accounts, pas aan/intrekken en account verwijderen; PAS_URL als betaallink", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer", TIKKIE_URL: "https://tikkie.me/pay/steun", PAS_URL: "https://tikkie.me/pay/pas9" };
  const cookie = await signup(env, "renner", "10.1.1.1");
  const admin = await adminCookie(env);
  const list = async () => (await api(env, "GET", "/api/admin/users", undefined, admin)).data;
  let data = await list();
  assert.equal(data.totaal, 2);
  assert.equal(data.met_pas, 0);
  assert.deepEqual(data.accounts.map(a => a.gebruiker).sort(), ["beheer", "renner"]);
  assert.equal(data.accounts.find(a => a.gebruiker === "beheer").beheerder, true);
  assert.ok(!JSON.stringify(data).includes("hash") && !JSON.stringify(data).includes("salt"), "geen wachtwoordgegevens in de lijst");
  await grant(env, "renner");
  data = await list();
  assert.equal(data.met_pas, 1);
  assert.ok(data.accounts.find(a => a.gebruiker === "renner").pas_tot);
  assert.equal((await api(env, "GET", "/api/me", undefined, cookie)).data.betaallink, "https://tikkie.me/pay/pas9");
  assert.equal((await grant(env, "Renner", { intrekken: true })).status, 200);
  assert.equal((await api(env, "GET", "/api/me", undefined, cookie)).data.pas.actief, false);
  // verwijderen: bevestiging nodig, beheerders zijn beschermd
  assert.equal((await api(env, "POST", "/api/admin/delete", { username: "renner", bevestig: "fout" }, admin)).status, 400);
  assert.equal((await api(env, "POST", "/api/admin/delete", { username: "beheer", bevestig: "beheer" }, admin)).status, 400);
  assert.equal((await api(env, "POST", "/api/admin/delete", { username: "renner", bevestig: "renner" }, admin)).status, 200);
  assert.equal((await list()).totaal, 1);
  assert.equal((await api(env, "GET", "/api/me", undefined, cookie)).status, 401, "sessie van verwijderd account werkt niet meer");
});

test("melding: bij activeren en verlengen krijgt de gebruiker één melding, met optioneel bericht, die je kunt wegklikken", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env, "renner", "10.1.1.1");
  const me = async () => (await api(env, "GET", "/api/me", undefined, cookie)).data;
  assert.deepEqual((await me()).meldingen, []);
  await grant(env, "renner", { bericht: "Bedankt voor je betaling!" });
  let m = (await me()).meldingen;
  assert.equal(m.length, 1);
  assert.match(m[0].tekst, /2-maandpas is geactiveerd en loopt tot \d+ \w+ \d{4}/);
  assert.match(m[0].tekst, /Bedankt voor je betaling!/);
  assert.equal((await api(env, "POST", "/api/notices/read", {}, cookie)).status, 200);
  assert.deepEqual((await me()).meldingen, []);
  await grant(env, "renner", { bericht: "<b>x</b>" });
  m = (await me()).meldingen;
  assert.match(m[0].tekst, /verlengd/);
  assert.ok(!m[0].tekst.includes("<"), "geen HTML in meldingen");
  const other = await signup(env, "andere", "10.2.2.2");
  assert.deepEqual((await api(env, "GET", "/api/me", undefined, other)).data.meldingen, [], "meldingen zijn per gebruiker");
});

test("notities: beheerder bewaart een notitie per account, die staat in de lijst en in de export, en verdwijnt bij verwijderen", async () => {
  const env = { ...makeEnv(), ADMIN_USERS: "beheer" };
  const cookie = await signup(env, "renner", "10.1.1.1");
  const admin = await adminCookie(env);
  const note = (user, notitie) => api(env, "POST", "/api/admin/note", { username: user, notitie }, admin);
  assert.equal((await api(env, "POST", "/api/admin/note", { username: "renner", notitie: "x" }, cookie)).status, 403);
  assert.equal((await note("renner", "Tikkie 17-11, vriend van Jeroen")).status, 200);
  let list = (await api(env, "GET", "/api/admin/users", undefined, admin)).data.accounts;
  assert.equal(list.find(a => a.gebruiker === "renner").notitie, "Tikkie 17-11, vriend van Jeroen");
  assert.equal(list.find(a => a.gebruiker === "beheer").notitie, "");
  assert.equal((await api(env, "GET", "/api/account/export", undefined, cookie)).data.notitie_beheerder, "Tikkie 17-11, vriend van Jeroen");
  assert.equal((await note("renner", "  ")).status, 200, "leeg wist de notitie");
  list = (await api(env, "GET", "/api/admin/users", undefined, admin)).data.accounts;
  assert.equal(list.find(a => a.gebruiker === "renner").notitie, "");
  await note("renner", "weg ermee");
  await grant(env, "renner");
  await api(env, "POST", "/api/admin/delete", { username: "renner", bevestig: "renner" }, admin);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM admin_notes").get().n, 0);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM notices").get().n, 0);
});
