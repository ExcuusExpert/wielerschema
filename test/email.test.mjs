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
  const h = { "CF-Connecting-IP": `10.6.0.${++n}` }; if (body) h["Content-Type"] = "application/json"; if (cookie) h.Cookie = cookie;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), { DB: env.DB, GROQ_API_KEY: "x" });
  const sc = res.headers.get("Set-Cookie"); const m = sc && sc.match(/__Host-ws=([0-9a-f]{64})/);
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: m ? `__Host-ws=${m[1]}` : null };
}
const PW = "een-lang-wachtwoord";
const dbEmail = env => env.DB.db.prepare("SELECT email FROM user_emails").all().map(r => r.email);

test("e-mailadres is optioneel bij het aanmaken van een account en wordt netjes opgeslagen", async () => {
  const env = { DB: new FakeD1() };
  const without = await api(env, "POST", "/api/register", { username: "zonder", password: PW, consent: true });
  assert.equal(without.status, 200);
  assert.equal((await api(env, "GET", "/api/me", undefined, without.cookie)).data.email, "");
  const withMail = await api(env, "POST", "/api/register", { username: "metmail", password: PW, consent: true, email: "  Hessel@Voorbeeld.NL " });
  assert.equal(withMail.status, 200);
  assert.deepEqual(dbEmail(env), ["hessel@voorbeeld.nl"]);
  assert.equal((await api(env, "GET", "/api/me", undefined, withMail.cookie)).data.email, "hessel@voorbeeld.nl");
  assert.equal((await api(env, "POST", "/api/register", { username: "leeg", password: PW, consent: true, email: "" })).status, 200);
});

test("ongeldige e-mailadressen worden geweigerd en er wordt dan geen account gemaakt", async () => {
  const env = { DB: new FakeD1() };
  for (const bad of ["geen-mail", "a@b", "a b@c.nl", "@c.nl", "a@@c.nl", `${"x".repeat(250)}@c.nl`, 5]) {
    const r = await api(env, "POST", "/api/register", { username: "fout", password: PW, consent: true, email: bad });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.data.error, "email");
  }
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
});

test("e-mailadres wijzigen of wissen vraagt het huidige wachtwoord", async () => {
  const env = { DB: new FakeD1() };
  const r = await api(env, "POST", "/api/register", { username: "wijzig", password: PW, consent: true });
  const set = (email, current = PW) => api(env, "POST", "/api/account/credentials", { username: "wijzig", email, current_password: current, new_password: "" }, r.cookie);
  assert.equal((await set("nieuw@voorbeeld.nl", "fout-wachtwoord")).status, 401);
  assert.deepEqual(dbEmail(env), []);
  const ok = await set("Nieuw@Voorbeeld.nl");
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.email, "nieuw@voorbeeld.nl");
  assert.deepEqual(dbEmail(env), ["nieuw@voorbeeld.nl"]);
  assert.equal((await set("nieuw@voorbeeld.nl")).status, 400, "niets gewijzigd");
  assert.equal((await set("kapot")).data.error, "email");
  const cleared = await set("");
  assert.equal(cleared.status, 200);
  assert.deepEqual(dbEmail(env), []);
  assert.equal((await api(env, "GET", "/api/me", undefined, r.cookie)).data.email, "");
});

test("e-mailadres zit in de export en verdwijnt bij het verwijderen van het account", async () => {
  const env = { DB: new FakeD1() };
  const r = await api(env, "POST", "/api/register", { username: "weg", password: PW, consent: true, email: "weg@voorbeeld.nl" });
  const exported = await api(env, "GET", "/api/account/export", undefined, r.cookie);
  assert.equal(exported.data.email, "weg@voorbeeld.nl");
  assert.equal((await api(env, "POST", "/api/account/delete", { password: PW }, r.cookie)).status, 200);
  assert.deepEqual(dbEmail(env), []);
});

test("na een nieuw wachtwoord blijft het e-mailadres bij het account horen", async () => {
  const env = { DB: new FakeD1() };
  const r = await api(env, "POST", "/api/register", { username: "nieuwww", password: PW, consent: true, email: "blijft@voorbeeld.nl" });
  const changed = await api(env, "POST", "/api/account/credentials", { username: "nieuwww", current_password: PW, new_password: "een-heel-ander-wachtwoord" }, r.cookie);
  assert.equal(changed.status, 200);
  assert.equal(changed.data.email, "blijft@voorbeeld.nl");
});
