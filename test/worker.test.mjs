import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { File } from "node:buffer";
import { strToU8, zipSync } from "fflate";
import worker from "../src/worker.js";

const BASE = "https://wielerschema.test";

// Kleine nabootsing van Cloudflare D1 bovenop node:sqlite
class FakeD1 {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) {
    const db = this.db;
    return {
      args: [],
      bind(...a) { this.args = a.map(v => (v === undefined ? null : v)); return this; },
      async first() { return db.prepare(sql).get(...this.args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...this.args) }; },
      async run() { const r = db.prepare(sql).run(...this.args); return { meta: { changes: r.changes } }; }
    };
  }
  async batch(statements) {
    for (const s of statements) await s.run();
    return [];
  }
}

// Nagebootste Groq
let groqCalls = 0;
let groqMode = "ok";
let coachMode = "proposal";
let lastGroqPrompt = "";
let lastGroqSystemPrompt = "";
const realFetch = globalThis.fetch;
function weekJson({ minutes = 240, allDays = true } = {}) {
  const dagen = [];
  for (let d = 0; d < 7; d++) {
    dagen.push({ dag: d, type: allDays || d % 2 === 0 ? "duurrit" : "rust", minuten: minutes, zone: "Z2", titel: d === 0 ? "<script>alert(1)</script>Rustig" : "Duurrit", beschrijving: "Rustig rijden, RPE 4." });
  }
  return { dagen, tips: "Drink genoeg." };
}
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.groq.com")) return realFetch(url, init);
  groqCalls++;
  if (groqMode === "busy") return new Response("{}", { status: 429 });
  const prompt = JSON.parse(init.body).messages[1].content;
  lastGroqPrompt = prompt;
  lastGroqSystemPrompt = JSON.parse(init.body).messages[0].content;
  let content;
  if (groqMode === "garbage") content = "Dit is geen JSON";
  else if (prompt.includes("vervolgvragen")) content = JSON.stringify({ vragen: [{ vraag: "Hoeveel uur train je nu per week?" }, { vraag: "Heb je ervaring met intervallen?" }] });
  else if (prompt.includes("Maak een trainingsschema van")) {
    const weeks = Number(prompt.match(/van (\d+) weken/)[1]);
    content = JSON.stringify({
      samenvatting: "Rustige opbouw.",
      weken: Array.from({ length: weeks }, (_, i) => ({ week: i + 1, fase: i % 4 === 3 ? "herstel" : "opbouw", focus: "Basis", uren: 6 })),
      week1: weekJson()
    });
  } else if (prompt.includes("Maak nu week")) content = JSON.stringify({ uitleg: "Iets rustiger.", week: weekJson({ minutes: 200 }) });
  else if (prompt.includes("Nieuw bericht van de gebruiker")) {
    if (coachMode === "mtb-first") content = JSON.stringify({
      antwoord: "Hoe lang duurt de rit ongeveer? Ik kan de intensiteit open laten.",
      voorstel: null
    });
    else if (coachMode === "mtb-followup") content = JSON.stringify({
      antwoord: "Ik heb de MTB-rit op zaterdag in je schema gezet.",
      voorstel: { dag: 5, type: "mtb", minuten: 45, zone: "Z2", titel: "MTB-rit met de club", beschrijving: "45 minuten op Z2." }
    });
    else if (coachMode === "week-checkin") content = JSON.stringify({
      antwoord: "Dank je voor je terugblik.",
      voorstel: null,
      week_feedback: { gedaan_pct: 75, uren_gedaan: 4, gevoel: 4, klachten: false, opmerking: "Drie ritten, voelde goed." }
    });
    else content = JSON.stringify({
      antwoord: "Ik stel een rustigere training voor.",
      voorstel: { dag: 3, type: "duurrit", minuten: 55, zone: "Z2", titel: "Rustige duur", beschrijving: "55 minuten op Z2, RPE 3-4." },
      week_feedback: null
    });
  }
  else content = "{}";
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};

function makeEnv() { return { DB: new FakeD1(), GROQ_API_KEY: "test" }; }
let ipN = 0;

async function api(env, method, path, body, { cookie, ip, origin } = {}) {
  const headers = { "CF-Connecting-IP": ip || `10.0.0.${++ipN}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }), env);
  const setCookie = res.headers.get("Set-Cookie");
  const match = setCookie && setCookie.match(/__Host-ws=([0-9a-f]{64})/);
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: match ? `__Host-ws=${match[1]}` : null, setCookie, res };
}

const GOOD_PW = "een-lang-wachtwoord";
async function signup(env, username = "hessel", ip) {
  const r = await api(env, "POST", "/api/register", { username, password: GOOD_PW, consent: true }, { ip });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.cookie;
}
function future(days) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
const INTAKE = { doel: "Toertocht van 120 km", datum: future(70), niveau: "gevorderd", uren_per_week: 6, dagen: [1, 3, 5, 6], geboortedatum: "1990-06-15", meter: "power", ftp: 220, ervaring_jaren: 3, beperkingen: "", opmerkingen: "" };

test("registreren: cookie, beveiligde vlaggen en wachtwoord niet leesbaar opgeslagen", async () => {
  const env = makeEnv();
  const r = await api(env, "POST", "/api/register", { username: "Hessel", password: GOOD_PW, consent: true });
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /Secure/);
  assert.match(r.setCookie, /SameSite=Lax/);
  const row = env.DB.db.prepare("SELECT * FROM users").get();
  assert.equal(row.username, "hessel");
  assert.ok(!JSON.stringify(row).includes(GOOD_PW));
  assert.equal(row.hash.length, 64);
  const me = await api(env, "GET", "/api/me", undefined, { cookie: r.cookie });
  assert.equal(me.data.username, "hessel");
});

test("registreren: zwak wachtwoord, geen toestemming, dubbele naam", async () => {
  const env = makeEnv();
  assert.equal((await api(env, "POST", "/api/register", { username: "abc", password: "kort", consent: true })).status, 400);
  assert.equal((await api(env, "POST", "/api/register", { username: "abc", password: GOOD_PW, consent: false })).data.error, "consent");
  assert.equal((await api(env, "POST", "/api/register", { username: "a b", password: GOOD_PW, consent: true })).data.error, "username");
  await signup(env, "dubbel");
  assert.equal((await api(env, "POST", "/api/register", { username: "DUBBEL", password: GOOD_PW, consent: true })).status, 409);
});

test("twee gebruikers met hetzelfde wachtwoord hebben verschillende hashes", async () => {
  const env = makeEnv();
  await signup(env, "een"); await signup(env, "twee");
  const rows = env.DB.db.prepare("SELECT hash, salt FROM users").all();
  assert.notEqual(rows[0].hash, rows[1].hash);
  assert.notEqual(rows[0].salt, rows[1].salt);
});

test("inloggen en uitloggen", async () => {
  const env = makeEnv();
  await signup(env, "fietser");
  assert.equal((await api(env, "POST", "/api/login", { username: "fietser", password: "fout-wachtwoord!" })).status, 401);
  assert.equal((await api(env, "POST", "/api/login", { username: "bestaatniet", password: GOOD_PW })).status, 401);
  const ok = await api(env, "POST", "/api/login", { username: "FIETSER", password: GOOD_PW });
  assert.equal(ok.status, 200);
  assert.equal((await api(env, "GET", "/api/me", undefined, { cookie: ok.cookie })).status, 200);
  await api(env, "POST", "/api/logout", {}, { cookie: ok.cookie });
  assert.equal((await api(env, "GET", "/api/me", undefined, { cookie: ok.cookie })).status, 401);
});

test("zonder inlog geen toegang tot schema en AI", async () => {
  const env = makeEnv();
  assert.equal((await api(env, "GET", "/api/plan")).status, 401);
  assert.equal((await api(env, "POST", "/api/intake/questions", { intake: INTAKE })).status, 401);
  assert.equal(groqCalls >= 0, true);
});

test("CSRF: aanvraag van een andere site wordt geweigerd", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const r = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie, origin: "https://evil.example" });
  assert.equal(r.status, 403);
  const ok = await api(env, "POST", "/api/logout", {}, { cookie, origin: BASE });
  assert.equal(ok.status, 200);
});

test("inloggen: te veel pogingen worden geblokkeerd", async () => {
  const env = makeEnv();
  await signup(env, "doelwit");
  let last;
  for (let i = 0; i < 12; i++) last = await api(env, "POST", "/api/login", { username: "doelwit", password: "fout-wachtwoord!" }, { ip: "7.7.7.7" });
  assert.equal(last.status, 429);
});

test("registreren: limiet per IP-adres", async () => {
  const env = makeEnv();
  let last;
  for (let i = 0; i < 11; i++) last = await api(env, "POST", "/api/register", { username: `gebruiker${i}`, password: GOOD_PW, consent: true }, { ip: "6.6.6.6" });
  assert.equal(last.status, 429);
});

test("intake: ongeldige invoer wordt netjes geweigerd", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const bad = async (patch) => (await api(env, "POST", "/api/intake/questions", { intake: { ...INTAKE, ...patch } }, { cookie })).status;
  assert.equal(await bad({ doel: "" }), 400);
  assert.equal(await bad({ niveau: "superman" }), 400);
  assert.equal(await bad({ meter: "smartwatch" }), 400);
  assert.equal(await bad({ uren_per_week: 99 }), 400);
  assert.equal(await bad({ dagen: [2] }), 400);
  assert.equal(await bad({ datum: future(2) }), 400);
  assert.equal(await bad({ datum: "morgen" }), 400);
  assert.equal(await bad({ geboortedatum: "" }), 400);
  assert.equal(await bad({ meter: "heart_rate" }), 400);
});

test("jeugdrenners vanaf 12 jaar kunnen een schema aanvragen en krijgen leeftijdsbewuste coachinstructies", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "jeugdfietser");
  const birthDateForAge = age => {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - age);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  };
  const tooYoung = await api(env, "POST", "/api/intake/questions", {
    intake: { ...INTAKE, geboortedatum: birthDateForAge(11) }
  }, { cookie });
  assert.equal(tooYoung.status, 400);

  const youth = await api(env, "POST", "/api/intake/questions", {
    intake: { ...INTAKE, geboortedatum: birthDateForAge(12) }
  }, { cookie });
  assert.equal(youth.status, 200, JSON.stringify(youth.data));
  assert.ok(lastGroqPrompt.includes('"leeftijd":12'));
  assert.ok(lastGroqSystemPrompt.includes("ouder/verzorger en gekwalificeerde jeugdtrainer"));
});

test("profiel bewaart geboortedatum en zones, maar deelt alleen leeftijd met Groq", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  assert.equal(created.status, 200);
  assert.ok(lastGroqPrompt.includes('"leeftijd":'));
  assert.ok(!lastGroqPrompt.includes(INTAKE.geboortedatum));

  const invalid = await api(env, "POST", "/api/account/profile", { profile: {
    geboortedatum: "1990-06-15", meter: "heart_rate", hr_max: 190, hr_threshold: 170,
    hr_zones: [120, 140, "", 170, 180, 190]
  } }, { cookie });
  assert.equal(invalid.status, 400);

  const profile = {
    geboortedatum: "1990-06-15", meter: "both",
    hr_max: 190, hr_threshold: 170, hr_zones: [120, 140, 155, 170, 180, 190],
    ftp: 220, power_zones: [121, 165, 198, 231, 264, 330]
  };
  const saved = await api(env, "POST", "/api/account/profile", { profile }, { cookie });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.plan_updated, true);
  assert.deepEqual(saved.data.profile.hr_zones, profile.hr_zones);
  assert.deepEqual(saved.data.profile.power_zones, profile.power_zones);
  const stored = await api(env, "GET", "/api/account/profile", undefined, { cookie });
  assert.equal(stored.data.profile.birth_date, profile.geboortedatum);
  const plan = (await api(env, "GET", "/api/plan", undefined, { cookie })).data.plan;
  assert.equal(plan.intake.meter, "both");
  assert.deepEqual(plan.intake.hr_zones, profile.hr_zones);
  assert.deepEqual(plan.intake.power_zones, profile.power_zones);
  const today = new Date().toISOString().slice(0, 10);
  const expectedAge = Number(today.slice(0, 4)) - 1990 - (today.slice(5) < "06-15" ? 1 : 0);
  assert.equal(plan.intake.leeftijd, expectedAge);
  assert.ok(!JSON.stringify(plan.intake).includes(profile.geboortedatum));
});

test("gebruikersnaam en wachtwoord aanpassen vereist huidig wachtwoord en roteert sessies", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "fietser");
  await signup(env, "albezet");
  assert.equal((await api(env, "POST", "/api/account/credentials", {
    username: "nieuwenaam", current_password: "verkeerd-wachtwoord", new_password: ""
  }, { cookie })).status, 401);
  assert.equal((await api(env, "POST", "/api/account/credentials", {
    username: "albezet", current_password: GOOD_PW, new_password: ""
  }, { cookie })).status, 409);

  const changed = await api(env, "POST", "/api/account/credentials", {
    username: "nieuwenaam", current_password: GOOD_PW, new_password: "ander-lang-wachtwoord"
  }, { cookie });
  assert.equal(changed.status, 200);
  assert.ok(changed.cookie);
  assert.equal((await api(env, "GET", "/api/me", undefined, { cookie })).status, 401);
  assert.equal((await api(env, "GET", "/api/me", undefined, { cookie: changed.cookie })).data.username, "nieuwenaam");
  assert.equal((await api(env, "POST", "/api/login", { username: "nieuwenaam", password: GOOD_PW })).status, 401);
  assert.equal((await api(env, "POST", "/api/login", { username: "nieuwenaam", password: "ander-lang-wachtwoord" })).status, 200);
});

test("vragen van de coach", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const r = await api(env, "POST", "/api/intake/questions", { intake: INTAKE }, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.vragen.length, 2);
  assert.equal(r.data.vragen[0].id, "v1");
});

test("training handmatig aanpassen slaat alleen een geldige wijziging op", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  assert.equal(created.status, 200);
  const before = created.data.weeks[0];
  const unchanged = before.dagen.find(day => day.dag === 1);
  const edit = workout => api(env, "POST", "/api/plan/workout", {
    week_no: 1, day_no: 3, workout
  }, { cookie });

  assert.equal((await api(env, "POST", "/api/plan/workout", {
    week_no: 1, day_no: 3, workout: { type: "tempo", minuten: 55, zone: "Z2", titel: "Tempo", beschrijving: "RPE 5." }
  })).status, 401);
  assert.equal((await edit({ type: "tempo", minuten: 55, zone: "Z9", titel: "Tempo", beschrijving: "RPE 5." })).status, 400);
  assert.equal((await edit({ type: "tempo", minuten: 360, zone: "Z2", titel: "Tempo", beschrijving: "RPE 5." })).status, 400);
  assert.equal((await api(env, "POST", "/api/plan/workout", {
    week_no: 1, day_no: 2, workout: { type: "tempo", minuten: 55, zone: "Z2", titel: "Tempo", beschrijving: "RPE 5." }
  }, { cookie })).status, 400);

  const updated = await edit({
    type: "tempo", minuten: 55, zone: "Z3", titel: "Handmatige tempotraining", beschrijving: "55 minuten, RPE 5."
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.week.dagen.find(day => day.dag === 3).titel, "Handmatige tempotraining");
  assert.equal(updated.data.week.dagen.find(day => day.dag === 3).minuten, 55);
  assert.deepEqual(updated.data.week.dagen.find(day => day.dag === 1), unchanged);
  assert.equal(updated.data.week.totaal_minuten,
    updated.data.week.dagen.filter(day => day.type !== "rust").reduce((sum, day) => sum + day.minuten, 0));
  const saved = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(saved.data.weeks[0].dagen.find(day => day.dag === 3).titel, "Handmatige tempotraining");

  await api(env, "POST", "/api/plan/checkin", {
    week_no: 1, gedaan_pct: 75, uren_gedaan: 4, gevoel: 3, klachten: true
  }, { cookie });
  const restricted = await api(env, "POST", "/api/plan/workout", {
    week_no: 2, day_no: 3,
    workout: { type: "vo2max", minuten: 30, zone: "Z5", titel: "Interval", beschrijving: "Hard." }
  }, { cookie });
  assert.equal(restricted.status, 400);
  const safe = await api(env, "POST", "/api/plan/workout", {
    week_no: 2, day_no: 3,
    workout: { type: "duurrit", minuten: 30, zone: "Z2", titel: "Rustige duur", beschrijving: "Rustig, RPE 2." }
  }, { cookie });
  assert.equal(safe.status, 200, JSON.stringify(safe.data));
});

test("coachchat toont ook bij een expliciet verzoek eerst een voorstel en past pas na akkoord toe", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  assert.equal(created.status, 200);
  const originalWeek = created.data.weeks[0];
  const originalOtherDay = originalWeek.dagen.find(day => day.dag === 1);
  const r = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 3, bericht: "Maak deze training rustiger."
  }, { cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.aangepast, false);
  assert.equal(r.data.voorstel.status, "pending");
  assert.equal(r.data.voorstel.workout.minuten, 55);
  const unchanged = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.deepEqual(unchanged.data.weeks[0].dagen.find(day => day.dag === 3), originalWeek.dagen.find(day => day.dag === 3));
  assert.deepEqual(unchanged.data.weeks[0].dagen.find(day => day.dag === 1), originalOtherDay);
  const thread = await api(env, "GET", "/api/coach/chat?global=1", undefined, { cookie });
  assert.equal(thread.data.messages.length, 2);
  assert.equal(thread.data.messages[0].role, "user");
  assert.equal(thread.data.messages[1].role, "assistant");
  assert.equal(thread.data.messages[1].suggestion.status, "pending");
  assert.deepEqual(thread.data.messages[1].suggestion.workout.huidige, originalWeek.dagen.find(day => day.dag === 3));
  const applied = await api(env, "POST", "/api/coach/suggestions", { id: r.data.voorstel.id, action: "apply" }, { cookie });
  assert.equal(applied.status, 200);
  assert.equal((await api(env, "POST", "/api/coach/suggestions", { id: r.data.voorstel.id, action: "apply" }, { cookie })).status, 409);
  const changed = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(changed.data.weeks[0].dagen.find(day => day.dag === 3).minuten, 55);
  assert.notEqual(changed.data.weeks[0].dagen.find(day => day.dag === 3).minuten, originalWeek.dagen.find(day => day.dag === 3).minuten);
});

test("een vrijblijvende trainingsvraag blijft een voorstel totdat de gebruiker bevestigt", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const original = created.data.weeks[0].dagen.find(day => day.dag === 3);
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 3, bericht: "Wat zou een rustigere variant zijn?", global: true
  }, { cookie });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.aangepast, false);
  assert.equal(reply.data.voorstel.status, "pending");
  let plan = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.deepEqual(plan.data.weeks[0].dagen.find(day => day.dag === 3), original);
  const applied = await api(env, "POST", "/api/coach/suggestions", { id: reply.data.voorstel.id, action: "apply" }, { cookie });
  assert.equal(applied.status, 200);
  plan = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(plan.data.weeks[0].dagen.find(day => day.dag === 3).minuten, 55);
});

test("een coachvoorstel kan niet ongemerkt een inmiddels handmatig aangepaste training overschrijven", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 3, bericht: "Wat zou een rustigere variant zijn?", global: true
  }, { cookie });
  assert.equal(reply.status, 200);
  const manual = await api(env, "POST", "/api/plan/workout", {
    week_no: 1, day_no: 3,
    workout: { type: "herstelrit", minuten: 40, zone: "Z1", titel: "Mijn wijziging", beschrijving: "Rustig." }
  }, { cookie });
  assert.equal(manual.status, 200);
  const applied = await api(env, "POST", "/api/coach/suggestions", {
    id: reply.data.voorstel.id, action: "apply"
  }, { cookie });
  assert.equal(applied.status, 409);
  assert.match(applied.data.message, /intussen veranderd/);
  const current = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(current.data.weeks[0].dagen.find(day => day.dag === 3).titel, "Mijn wijziging");
});

test("doorlopende coachchat toont gesprekken samen en neemt eerdere berichten mee", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const earlier = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 1, bericht: "Hoe zwaar is mijn training?"
  }, { cookie });
  assert.equal(earlier.status, 200);
  const current = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 3, bericht: "Maak deze training rustiger.", global: true
  }, { cookie });
  assert.equal(current.status, 200, JSON.stringify(current.data));
  assert.equal(current.data.aangepast, false);
  assert.equal(current.data.voorstel.status, "pending");
  assert.ok(lastGroqPrompt.includes("Hoe zwaar is mijn training?"));

  const conversation = await api(env, "GET", "/api/coach/chat?global=1", undefined, { cookie });
  assert.equal(conversation.status, 200);
  assert.equal(conversation.data.messages.length, 4);
  assert.equal(conversation.data.messages[0].day_no, 1);
  assert.equal(conversation.data.messages[2].day_no, 3);
  assert.equal(conversation.data.messages[3].role, "assistant");
});

test("coach zet een club-MTB-rit op de genoemde zaterdag en laat intensiteit leeg", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  assert.equal(created.status, 200);
  const before = created.data.weeks[0];
  coachMode = "mtb-first";
  const first = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 1, bericht: "Ik heb komende zaterdag een MTB-rit met de club. Kan je dat erop zetten?", global: true
  }, { cookie });
  assert.equal(first.status, 200);
  assert.equal(first.data.voorstel, null);
  coachMode = "mtb-followup";
  const second = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 1, bericht: "Ik weet nog niet welke zones en intensiteiten, dus laat dat leeg.", global: true
  }, { cookie });
  coachMode = "proposal";
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.aangepast, false);
  assert.equal(second.data.voorstel.status, "pending");
  const beforeApproval = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.deepEqual(beforeApproval.data.weeks[0], before);
  const approved = await api(env, "POST", "/api/coach/suggestions", { id: second.data.voorstel.id, action: "apply" }, { cookie });
  assert.equal(approved.status, 200);
  const after = await api(env, "GET", "/api/plan", undefined, { cookie });
  const saturday = after.data.weeks[0].dagen.find(day => day.dag === 5);
  assert.equal(saturday.type, "mtb");
  assert.equal(saturday.titel, "MTB-rit met de club");
  assert.equal(saturday.minuten, 45);
  assert.equal(saturday.zone, "");
  assert.equal(saturday.beschrijving, "Intensiteit en trainingszone zijn nog open.");
  assert.deepEqual(after.data.weeks[0].dagen.find(day => day.dag === 1), before.dagen.find(day => day.dag === 1));
  assert.ok(lastGroqPrompt.includes("komende zaterdag een MTB-rit"));
});

test("coach haalt de weekterugblik op in chat en maakt daarna de volgende week", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const oldStart = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  env.DB.db.prepare("UPDATE plans SET start_date = ? WHERE user_id = (SELECT id FROM users WHERE username = 'hessel')").run(oldStart);
  coachMode = "week-checkin";
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 1, bericht: "Ik heb drie van de vier trainingen gedaan, vier uur in totaal en voelde me goed.", global: true
  }, { cookie });
  coachMode = "proposal";
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.plan_updated, true);
  assert.match(reply.data.antwoord, /week 2 voor je gemaakt/);
  const plan = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(plan.data.weeks.length, 2);
  assert.equal(plan.data.weeks[0].checkin.gedaan_pct, 75);
  assert.equal(plan.data.weeks[0].checkin.uren_gedaan, 4);
});

test("dagmetingen valideren invoer, bewaren tot een jaar en komen als context in de coachchat", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const saved = await api(env, "POST", "/api/wellness", {
    date: yesterday,
    metrics: { resting_hr: 52, sleep_hours: 7.5, deep_sleep_hours: 1.2, body_battery_low: 18, body_battery_high: 76, stress_avg: 31, hrv_ms: 54, note: "Voelde me uitgerust." }
  }, { cookie });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.entries[0].resting_hr, 52);
  assert.equal(saved.data.entries[0].note, "Voelde me uitgerust.");
  assert.equal((await api(env, "GET", "/api/wellness", undefined, { cookie })).data.entries.length, 1);
  assert.equal((await api(env, "POST", "/api/wellness", {
    date: today, metrics: { body_battery_low: 80, body_battery_high: 20 }
  }, { cookie })).status, 400);
  assert.equal((await api(env, "POST", "/api/wellness", {
    date: today, metrics: { resting_hr: 251 }
  }, { cookie })).status, 400);
  assert.equal((await api(env, "POST", "/api/wellness", {
    date: future(1), metrics: { resting_hr: 52 }
  }, { cookie })).status, 400);
  const tooOld = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
  assert.equal((await api(env, "POST", "/api/wellness", {
    date: tooOld, metrics: { resting_hr: 52 }
  }, { cookie })).status, 400);

  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const coach = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 3, bericht: "Hoe herstel ik?"
  }, { cookie });
  assert.equal(coach.status, 200);
  assert.ok(lastGroqPrompt.includes("52"));
  assert.ok(lastGroqPrompt.includes("Voelde me uitgerust."));
  assert.match(lastGroqPrompt, /stel geen medische diagnose/);
});

test("TrainingPeaks-import verwerkt ZIP/CSV, beperkt tot een jaar en bewaart alleen samenvattingen", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const summaryCsv = `Date,Duration,Distance,Average Power,Average Heart Rate\n${today},3600,25000,200,140\n${old},3600,25000,200,140\n`;
  const metricsCsv = `Date,Weight,Sleep\n${today},75.5,8\n`;
  const form = new FormData();
  form.append("summary", new File([zipSync({ "workouts.csv": strToU8(summaryCsv) })], "summary.zip"));
  const nestedMetrics = zipSync({ "metrics-export.zip": zipSync({ "metrics.csv": strToU8(metricsCsv) }) });
  form.append("metrics", new File([nestedMetrics], "metrics.zip"));
  form.append("ai_consent", "yes");
  const res = await worker.fetch(new Request(BASE + "/api/trainingpeaks/import", {
    method: "POST",
    headers: { Cookie: cookie, "CF-Connecting-IP": "10.0.0.1" },
    body: form
  }), env);
  const imported = await res.json();
  assert.equal(res.status, 200, JSON.stringify(imported));
  assert.equal(imported.summary.activities, 1);
  assert.equal(imported.summary.weeks.length, 1);
  assert.equal(imported.summary.weeks[0].hours, 1);
  assert.equal(imported.summary.weeks[0].avg_power, 200);
  assert.deepEqual(imported.summary.weeks[0].metrics, { Weight: 75.5, Sleep: 8 });
  const updateForm = new FormData();
  updateForm.append("metrics", new File([zipSync({ "metrics.csv": strToU8(`Date,Weight\n${today},76\n`) })], "metrics.zip"));
  updateForm.append("ai_consent", "yes");
  const updateResponse = await worker.fetch(new Request(BASE + "/api/trainingpeaks/import", {
    method: "POST", headers: { Cookie: cookie }, body: updateForm
  }), env);
  const merged = await updateResponse.json();
  assert.equal(merged.summary.activities, 1);
  assert.equal(merged.summary.weeks[0].avg_power, 200);
  assert.deepEqual(merged.summary.weeks[0].metrics, { Weight: 76, Sleep: 8 });
  const stored = env.DB.db.prepare("SELECT summary FROM training_history").get();
  assert.ok(stored.summary.includes("Weight"));
  assert.ok(!stored.summary.includes("workouts.csv"));
  const savedSummary = (await api(env, "GET", "/api/trainingpeaks", undefined, { cookie })).data.summary;
  assert.deepEqual(savedSummary.weeks, merged.summary.weeks);
  assert.equal(savedSummary.activities, 1);
  const otherCookie = await signup(env, "anders");
  assert.equal((await api(env, "GET", "/api/trainingpeaks", undefined, { cookie: otherCookie })).data.summary, null);
  const plan = await api(env, "POST", "/api/plan/create", { intake: { ...INTAKE, meter: "both", hr_max: 190, hr_threshold: 170 } }, { cookie });
  assert.equal(plan.status, 200);
  assert.equal(plan.data.plan.intake.meter, "both");
  assert.match(lastGroqPrompt, /"avg_power":200/);
  assert.match(lastGroqPrompt, /"Weight":76/);
});

test("TrainingPeaks-import vereist inloggen en ZIP-bestanden", async () => {
  const env = makeEnv();
  const noAuth = await worker.fetch(new Request(BASE + "/api/trainingpeaks/import", { method: "POST", body: new FormData() }), env);
  assert.equal(noAuth.status, 401);
  const cookie = await signup(env);
  const validForm = new FormData();
  validForm.append("summary", new File([zipSync({ "workouts.csv": strToU8("Date,Duration\n") })], "summary.zip"));
  const noConsent = await worker.fetch(new Request(BASE + "/api/trainingpeaks/import", {
    method: "POST", headers: { Cookie: cookie }, body: validForm
  }), env);
  assert.equal(noConsent.status, 400);
  assert.equal((await noConsent.json()).error, "consent");
  const form = new FormData();
  form.append("summary", new File(["not a zip"], "summary.zip"));
  form.append("ai_consent", "yes");
  const res = await worker.fetch(new Request(BASE + "/api/trainingpeaks/import", {
    method: "POST", headers: { Cookie: cookie }, body: form
  }), env);
  assert.equal(res.status, 400);
});

test("schema maken: vangrails op dagen, minuten en tekst", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const r = await api(env, "POST", "/api/plan/create", { intake: INTAKE, answers: [{ vraag: "Hoeveel uur?", antwoord: "4 uur" }] }, { cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const { plan, weeks } = r.data;
  assert.equal(new Date(plan.start_date + "T00:00:00Z").getUTCDay(), 1, "start op maandag");
  assert.equal(plan.outline.length, plan.total_weeks);
  assert.ok(plan.total_weeks >= 9 && plan.total_weeks <= 11);
  const w1 = weeks[0];
  // De AI plande op alle 7 dagen 240 minuten; alleen dagen 1,3,5,6 zijn beschikbaar
  for (const dag of w1.dagen) {
    if (![1, 3, 5, 6].includes(dag.dag)) assert.equal(dag.type, "rust");
  }
  assert.ok(w1.totaal_minuten <= 6 * 60 * 1.05 + 20, `totaal ${w1.totaal_minuten}`);
  assert.ok(!JSON.stringify(w1).includes("<script>"));
  // opgeslagen en terug te lezen
  const again = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(again.data.weeks.length, 1);
});

test("AI geeft rommel: geen schema opgeslagen en nette foutmelding", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  groqMode = "garbage";
  const r = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  groqMode = "ok";
  assert.equal(r.status, 502);
  assert.equal((await api(env, "GET", "/api/plan", undefined, { cookie })).data.plan, null);
});

test("AI bezet: 503", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  groqMode = "busy";
  const r = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  groqMode = "ok";
  assert.equal(r.status, 503);
});

test("dagelijkse AI-limiet per gebruiker", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  let last;
  for (let i = 0; i < 13; i++) last = await api(env, "POST", "/api/intake/questions", { intake: INTAKE }, { cookie });
  assert.equal(last.status, 429);
  assert.equal(last.data.error, "ai_limit");
});

test("ontwikkelaarsaccount kan boven de gebruikerslimiet; gezamenlijke AI-noodlimiet blijft actief", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "ontwikkelaar");
  const userId = env.DB.db.prepare("SELECT id FROM users WHERE username = ?").get("ontwikkelaar").id;
  env.AI_UNLIMITED_USER_IDS = `andere-id, ${userId}`;
  for (let i = 0; i < 13; i++) {
    const response = await api(env, "POST", "/api/intake/questions", { intake: INTAKE }, { cookie });
    assert.equal(response.status, 200, JSON.stringify(response.data));
  }
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM counters WHERE key LIKE 'ai:u:%'").get().n, 0);
  assert.equal(env.DB.db.prepare("SELECT n FROM counters WHERE key LIKE 'ai:g:%'").get().n, 13);
});

test("check-in: volgende week, geen dubbele check-in, klachten maken het licht", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const w1total = created.data.weeks[0].totaal_minuten;

  const bad = await api(env, "POST", "/api/plan/checkin", { week_no: 1, gedaan_pct: 90 }, { cookie });
  assert.equal(bad.status, 400);

  const r = await api(env, "POST", "/api/plan/checkin", { week_no: 1, gedaan_pct: 90, uren_gedaan: 5, gevoel: 4, klachten: true, opmerking: "knie doet pijn" }, { cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.weeks.length, 2);
  assert.equal(r.data.weeks[0].checkin.klachten, true);
  const w2 = r.data.weeks[1];
  assert.ok(w2.totaal_minuten <= w1total * 0.5 + 20, `week 2 = ${w2.totaal_minuten}, week 1 = ${w1total}`);
  assert.match(w2.waarschuwing, /arts/);

  const dubbel = await api(env, "POST", "/api/plan/checkin", { week_no: 1, gedaan_pct: 90, gevoel: 4 }, { cookie });
  assert.equal(dubbel.status, 409);
});

test("check-in zonder klachten: geen waarschuwing", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const r = await api(env, "POST", "/api/plan/checkin", { week_no: 1, gedaan_pct: 100, uren_gedaan: 6, gevoel: 4, klachten: false }, { cookie });
  assert.equal(r.data.weeks[1].waarschuwing, "");
});

test("gebruikers zien elkaars schema niet", async () => {
  const env = makeEnv();
  const a = await signup(env, "anna");
  const b = await signup(env, "bram");
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie: a });
  assert.equal((await api(env, "GET", "/api/plan", undefined, { cookie: b })).data.plan, null);
});

test("export bevat geen wachtwoordgegevens; account verwijderen wist alles", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "wissen");
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const today = new Date().toISOString().slice(0, 10);
  await api(env, "POST", "/api/wellness", { date: today, metrics: { resting_hr: 52 } }, { cookie });
  await api(env, "POST", "/api/coach/chat", { week_no: 1, day_no: 3, bericht: "Maak deze training rustiger." }, { cookie });
  const exp = await api(env, "GET", "/api/account/export", undefined, { cookie });
  assert.equal(exp.status, 200);
  assert.ok(!JSON.stringify(exp.data).match(/salt|hash/));
  assert.equal(exp.data.gebruikersnaam, "wissen");
  assert.equal(exp.data.dagelijkse_metrics[0].resting_hr, 52);
  assert.equal(exp.data.coachgesprekken.length, 2);

  assert.equal((await api(env, "POST", "/api/account/delete", { password: "verkeerd-wachtwoord" }, { cookie })).status, 401);
  assert.equal((await api(env, "POST", "/api/account/delete", { password: GOOD_PW }, { cookie })).status, 200);
  assert.equal(exp.data.profiel.birth_date, INTAKE.geboortedatum);
  for (const table of ["users", "sessions", "plans", "weeks", "training_history", "daily_metrics", "coach_suggestions", "coach_messages", "account_profiles"]) {
    assert.equal(env.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal((await api(env, "GET", "/api/me", undefined, { cookie })).status, 401);
});

test("nieuw schema beginnen wist het oude", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  assert.equal((await api(env, "DELETE", "/api/plan", undefined, { cookie })).status, 200);
  assert.equal((await api(env, "GET", "/api/plan", undefined, { cookie })).data.plan, null);
});
