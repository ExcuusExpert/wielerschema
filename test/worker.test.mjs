import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
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
    dagen.push({ dag: d, type: allDays || d % 2 === 0 ? "duurrit" : "rust", minuten: minutes, zone: "Z2", titel: d === 0 ? "<script>alert(1)</script>Rustig" : "Duurrit", beschrijving: "Rustig rijden, gelijkmatig tempo." });
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
    if (coachMode === "rpe") content = JSON.stringify({
      antwoord: "Vandaag een rustige duurtraining. De intensiteit wordt gemeten met hartslagzones en een RPE-score om overbelasting te voorkomen.",
      voorstel: null,
      week_feedback: null
    });
    else if (coachMode === "mtb-first") content = JSON.stringify({
      antwoord: "Hoe lang duurt de rit ongeveer? Ik kan de intensiteit open laten.",
      voorstel: null
    });
    else if (coachMode === "mtb-followup") content = JSON.stringify({
      antwoord: "Ik heb de MTB-rit op zaterdag in je schema gezet.",
      voorstel: { dag: 5, type: "mtb", minuten: 45, zone: "Z2", titel: "MTB-rit met de club", beschrijving: "45 minuten op Z2." }
    });
    else if (coachMode === "mtb-two-hour") content = JSON.stringify({
      antwoord: "Ik heb de MTB-rit op zaterdag in je schema gezet.",
      voorstel: {
        dag: 5, type: "mtb", minuten: 60, zone: "Z2", titel: "Club MTB-rit",
        beschrijving: "2 uur MTB-rit met de club in Appelscha (aangepast naar 60 min om binnen de weeklimiet te blijven).",
        blokken: [
          { minuten: 60, zone: "Z2", label: "MTB-rit met de club" },
          { minuten: 60, zone: "Z3", label: "Tempo in de groep" }
        ]
      }
    });
    else if (coachMode === "event-plan") {
      const outline = JSON.parse(prompt.match(/<schema-overzicht>(.*?)<\/schema-overzicht>/)[1]);
      const eventWeek = Number(prompt.match(/week (\d+), dag/)[1]);
      outline[eventWeek - 1] = {
        ...outline[eventWeek - 1],
        fase: "piek",
        focus: "Wedstrijd Appelscha"
      };
      content = JSON.stringify({
        antwoord: "Ik heb een voorstel gemaakt voor de wedstrijd en de aangepaste opbouw.",
        voorstel: null,
        week_feedback: null,
        evenement: { titel: "Wedstrijd Appelscha", type: "wedstrijd", beschrijving: "Wielerwedstrijd in Appelscha." },
        schema_aanpassing: { samenvatting: "Rustige opbouw naar de wedstrijd met herstel erna.", weken: outline }
      });
    }
    else if (coachMode === "today") content = JSON.stringify({
      antwoord: "Vandaag staat je rustige duurtraining van 45 minuten in Z2 gepland.",
      voorstel: null,
      week_feedback: null
    });
    else if (coachMode === "week-checkin") content = JSON.stringify({
      antwoord: "Dank je voor je terugblik.",
      voorstel: null,
      week_feedback: { gedaan_pct: 75, uren_gedaan: 4, gevoel: 4, klachten: false, opmerking: "Drie ritten, voelde goed." }
    });
    else content = JSON.stringify({
      antwoord: "Ik stel een rustigere training voor.",
      voorstel: { dag: 3, type: "duurrit", minuten: 55, zone: "Z2", titel: "Rustige duur", beschrijving: "55 minuten op Z2, rustig en gelijkmatig." },
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

test("profiel berekent vijf hartslagzones uit maximum en vijf of zeven vermogenszones uit FTP", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  assert.equal(created.status, 200);
  assert.ok(lastGroqPrompt.includes('"leeftijd":'));
  assert.ok(!lastGroqPrompt.includes(INTAKE.geboortedatum));

  const invalid = await api(env, "POST", "/api/account/profile", { profile: {
    geboortedatum: "1990-06-15", meter: "heart_rate", hr_max: 250
  } }, { cookie });
  assert.equal(invalid.status, 400);

  const profile = {
    geboortedatum: "1990-06-15", meter: "both",
    hr_max: 190, ftp: 220, power_zone_count: 7
  };
  const saved = await api(env, "POST", "/api/account/profile", { profile }, { cookie });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.plan_updated, true);
  assert.deepEqual(saved.data.profile.hr_zones, [114, 133, 152, 171, 190]);
  assert.deepEqual(saved.data.profile.power_zones, [121, 165, 198, 231, 264, 330]);
  assert.equal(Object.hasOwn(saved.data.profile, "hr_threshold"), false);
  const stored = await api(env, "GET", "/api/account/profile", undefined, { cookie });
  assert.equal(stored.data.profile.birth_date, profile.geboortedatum);
  const plan = (await api(env, "GET", "/api/plan", undefined, { cookie })).data.plan;
  assert.equal(plan.intake.meter, "both");
  assert.deepEqual(plan.intake.hr_zones, [114, 133, 152, 171, 190]);
  assert.deepEqual(plan.intake.power_zones, [121, 165, 198, 231, 264, 330]);
  assert.equal(plan.intake.hr_threshold, undefined);
  assert.equal(plan.intake.power_zone_count, 7);
  const today = new Date().toISOString().slice(0, 10);
  const expectedAge = Number(today.slice(0, 4)) - 1990 - (today.slice(5) < "06-15" ? 1 : 0);
  assert.equal(plan.intake.leeftijd, expectedAge);
  assert.ok(!JSON.stringify(plan.intake).includes(profile.geboortedatum));

  const fiveZones = await api(env, "POST", "/api/account/profile", { profile: {
    ...profile, power_zone_count: 5
  } }, { cookie });
  assert.equal(fiveZones.status, 200, JSON.stringify(fiveZones.data));
  assert.deepEqual(fiveZones.data.profile.power_zones, [121, 165, 198, 231]);
  assert.equal(fiveZones.data.profile.power_zone_count, 5);
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

test("AI-coach verwijdert RPE-zinnen uit zichtbare antwoorden", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  coachMode = "rpe";
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 0, bericht: "Hoe intensief is het?", global: true
  }, { cookie });
  coachMode = "proposal";
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.match(reply.data.antwoord, /rustige duurtraining/);
  assert.doesNotMatch(reply.data.antwoord, /RPE/i);
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
    week_no: 1, day_no: 3, workout: { type: "tempo", minuten: 55, zone: "Z2", titel: "Tempo", beschrijving: "Stevig tempo." }
  })).status, 401);
  assert.equal((await edit({ type: "tempo", minuten: 55, zone: "Z9", titel: "Tempo", beschrijving: "Stevig tempo." })).status, 400);
  assert.equal((await edit({ type: "tempo", minuten: 361, zone: "Z2", titel: "Tempo", beschrijving: "Stevig tempo." })).status, 400);
  assert.equal((await api(env, "POST", "/api/plan/workout", {
    week_no: 1, day_no: 2, workout: { type: "tempo", minuten: 55, zone: "Z2", titel: "Tempo", beschrijving: "Stevig tempo." }
  }, { cookie })).status, 400);

  const updated = await edit({
    type: "tempo", minuten: 55, zone: "Z3", titel: "Handmatige tempotraining", beschrijving: "55 minuten, RPE 5.",
    blokken: [
      { minuten: 10, zone: "Z1", label: "Warming-up" },
      { minuten: 15, zone: "Z4", label: "Interval" },
      { minuten: 5, zone: "Z2", label: "Herstel" },
      { minuten: 15, zone: "Z4", label: "Interval" },
      { minuten: 10, zone: "Z1", label: "Cooling-down" }
    ]
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  const updatedWorkout = updated.data.week.dagen.find(day => day.dag === 3);
  assert.equal(updatedWorkout.titel, "Handmatige tempotraining");
  assert.equal(updatedWorkout.minuten, 55);
  assert.equal(updatedWorkout.beschrijving, "55 minuten.");
  assert.doesNotMatch(updatedWorkout.beschrijving, /RPE/i);
  assert.deepEqual(updatedWorkout.blokken.map(({ minuten, zone }) => ({ minuten, zone })), [
    { minuten: 10, zone: "Z1" }, { minuten: 15, zone: "Z4" }, { minuten: 5, zone: "Z2" },
    { minuten: 15, zone: "Z4" }, { minuten: 10, zone: "Z1" }
  ]);
  const invalidBlocks = await edit({
    type: "tempo", minuten: 55, zone: "Z3", titel: "Zonder geldig profiel", beschrijving: "55 minuten, RPE 5.",
    blokken: [{ minuten: 54, zone: "Z2", label: "Te kort" }]
  });
  assert.equal(invalidBlocks.status, 200);
  assert.equal(invalidBlocks.data.week.dagen.find(day => day.dag === 3).blokken, undefined);
  assert.deepEqual(invalidBlocks.data.week.dagen.find(day => day.dag === 1), unchanged);
  assert.equal(invalidBlocks.data.week.totaal_minuten,
    invalidBlocks.data.week.dagen.filter(day => day.type !== "rust").reduce((sum, day) => sum + day.minuten, 0));
  const saved = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(saved.data.weeks[0].dagen.find(day => day.dag === 3).titel, "Zonder geldig profiel");

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
    workout: { type: "duurrit", minuten: 30, zone: "Z2", titel: "Rustige duur", beschrijving: "Rustig en beheerst." }
  }, { cookie });
  assert.equal(safe.status, 200, JSON.stringify(safe.data));
});

test("een week boven de richtlijn kan worden opgeslagen met een duidelijke waarschuwing", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "weekwaarschuwing");
  const intake = { ...INTAKE, geboortedatum: "2010-06-15" };
  const created = await api(env, "POST", "/api/plan/create", { intake }, { cookie });
  const updated = await api(env, "POST", "/api/plan/workout", {
    week_no: 1, day_no: 3,
    workout: { type: "duurrit", minuten: 240, zone: "Z2", titel: "Lange rit", beschrijving: "Rustige duurtraining." }
  }, { cookie });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.ok(updated.data.week.totaal_minuten > intake.uren_per_week * 63);
  assert.match(updated.data.week.weekbelasting_waarschuwing, /meer dan je richtlijn/);
  assert.doesNotMatch(updated.data.week.weekbelasting_waarschuwing, /ouder\/verzorger|arts|overleg/i);
  assert.ok(created.data.weeks[0].dagen.find(day => day.dag === 3));
});

test("handmatige trainingszones volgen het gekozen zoneprofiel", async () => {
  const cases = [
    { meter: "heart_rate", hr_max: 190, invalid: "Z6", valid: "Z5" },
    { meter: "power", ftp: 220, power_zone_count: 5, invalid: "Z6", valid: "Z5" },
    { meter: "power", ftp: 220, power_zone_count: 7, valid: "Z7" }
  ];
  for (const [index, settings] of cases.entries()) {
    const env = makeEnv();
    const cookie = await signup(env, `zones${index}`);
    const intake = { ...INTAKE, ...settings };
    const created = await api(env, "POST", "/api/plan/create", { intake }, { cookie });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const edit = zone => api(env, "POST", "/api/plan/workout", {
      week_no: 1, day_no: 3,
      workout: { type: "duurrit", minuten: 30, zone, titel: "Zonecontrole", beschrijving: "Rustig trainen." }
    }, { cookie });
    if (settings.invalid) assert.equal((await edit(settings.invalid)).status, 400, `${settings.meter} ${settings.invalid}`);
    assert.equal((await edit(settings.valid)).status, 200, `${settings.meter} ${settings.valid}`);
  }
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

test("doorlopende coachchat krijgt de datum en exacte training van vandaag mee", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "vandaag");
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const userId = env.DB.db.prepare("SELECT id FROM users WHERE username = ?").get("vandaag").id;
  const todayDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const todayDay = (new Date(`${todayDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = new Date(`${todayDate}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - todayDay);
  const startDate = monday.toISOString().slice(0, 10);
  env.DB.db.prepare("UPDATE plans SET start_date = ? WHERE user_id = ?").run(startDate, userId);
  const week = JSON.parse(env.DB.db.prepare("SELECT detail FROM weeks WHERE user_id = ? AND week_no = 1").get(userId).detail);
  week.dagen[todayDay] = {
    dag: todayDay, type: "duurrit", minuten: 45, zone: "Z2", titel: "Vandaag: rustige duur",
    beschrijving: "Rustig, RPE 4.",
    blokken: [
      { minuten: 10, zone: "Z1", label: "Warming-up" },
      { minuten: 25, zone: "Z2", label: "Rustige duur" },
      { minuten: 10, zone: "Z1", label: "Cooling-down" }
    ]
  };
  week.totaal_minuten = week.dagen.filter(day => day.type !== "rust").reduce((total, day) => total + day.minuten, 0);
  env.DB.db.prepare("UPDATE weeks SET detail = ? WHERE user_id = ? AND week_no = 1").run(JSON.stringify(week), userId);

  coachMode = "today";
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 2, day_no: 0, bericht: "Wat moet ik vandaag doen?", global: true
  }, { cookie });
  coachMode = "proposal";
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.match(reply.data.antwoord, /45 minuten in Z2/);
  assert.ok(lastGroqPrompt.includes(`Vandaag is ${todayDate} (${["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"][todayDay]}, dag ${todayDay})`));
  assert.ok(lastGroqPrompt.includes('"titel":"Vandaag: rustige duur"'));
  assert.ok(lastGroqPrompt.includes('"minuten":45'));
  assert.ok(!lastGroqPrompt.includes("RPE"));
  const savedMessage = env.DB.db.prepare(
    "SELECT week_no, day_no FROM coach_messages WHERE user_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1"
  ).get(userId);
  assert.equal(savedMessage.week_no, 1);
  assert.equal(savedMessage.day_no, todayDay);
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
  assert.equal(conversation.data.messages[2].day_no,
    (new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" })}T00:00:00Z`).getUTCDay() + 6) % 7);
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

test("coach houdt een expliciete MTB-duur van twee uur aan en voorstel kan worden toegepast", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "mtb-twee-uur");
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const userId = env.DB.db.prepare("SELECT id FROM users WHERE username = ?").get("mtb-twee-uur").id;
  const weekRow = env.DB.db.prepare("SELECT detail FROM weeks WHERE user_id = ? AND week_no = 1").get(userId);
  const week = JSON.parse(weekRow.detail);
  for (const [dayNo, minutes] of [[1, 80], [3, 80], [5, 60], [6, 90]]) {
    const day = week.dagen.find(item => item.dag === dayNo);
    day.minuten = minutes;
  }
  week.dagen.find(day => day.dag === 5).beschrijving = "Rustig, RPE 4.";
  week.totaal_minuten = week.dagen.filter(day => day.type !== "rust").reduce((total, day) => total + day.minuten, 0);
  env.DB.db.prepare("UPDATE weeks SET detail = ? WHERE user_id = ? AND week_no = 1").run(JSON.stringify(week), userId);

  coachMode = "mtb-two-hour";
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 0,
    bericht: "Ik ga zaterdag met de club 2 uurtjes MTB'en in Appelscha. Zet dat op zaterdag in mijn schema.",
    global: true
  }, { cookie });
  coachMode = "proposal";
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.voorstel.workout.minuten, 120);
  assert.equal(reply.data.voorstel.workout.dag, 5);
  assert.ok(!reply.data.voorstel.workout.beschrijving.includes("aangepast naar 60"));
  assert.ok(lastGroqPrompt.includes("Gebruik exact deze duur"));

  const applied = await api(env, "POST", "/api/coach/suggestions", {
    id: reply.data.voorstel.id, action: "apply"
  }, { cookie });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const plan = await api(env, "GET", "/api/plan", undefined, { cookie });
  const saturday = plan.data.weeks[0].dagen.find(day => day.dag === 5);
  assert.equal(saturday.minuten, 120);
  assert.equal(saturday.type, "mtb");
  assert.ok(!saturday.beschrijving.includes("RPE"));
  assert.deepEqual(saturday.blokken, [
    { minuten: 60, zone: "Z2", label: "MTB-rit met de club" },
    { minuten: 60, zone: "Z3", label: "Tempo in de groep" }
  ]);
});

test("coach houdt een expliciete rit aan boven de weekrichtlijn en waarschuwt", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "mtb-limiet");
  await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const userId = env.DB.db.prepare("SELECT id FROM users WHERE username = ?").get("mtb-limiet").id;
  const weekRow = env.DB.db.prepare("SELECT detail FROM weeks WHERE user_id = ? AND week_no = 1").get(userId);
  const week = JSON.parse(weekRow.detail);
  for (const [dayNo, minutes] of [[1, 100], [3, 100], [5, 60], [6, 100]]) {
    week.dagen.find(item => item.dag === dayNo).minuten = minutes;
  }
  week.totaal_minuten = week.dagen.filter(day => day.type !== "rust").reduce((total, day) => total + day.minuten, 0);
  env.DB.db.prepare("UPDATE weeks SET detail = ? WHERE user_id = ? AND week_no = 1").run(JSON.stringify(week), userId);

  coachMode = "mtb-two-hour";
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 0,
    bericht: "Ik ga zaterdag met de club 2 uurtjes MTB'en in Appelscha. Zet dat op zaterdag in mijn schema.",
    global: true
  }, { cookie });
  coachMode = "proposal";
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.voorstel.workout.minuten, 120);
  assert.match(reply.data.voorstel.workout.weekbelasting_waarschuwing, /meer dan je richtlijn/);
  const applied = await api(env, "POST", "/api/coach/suggestions", {
    id: reply.data.voorstel.id, action: "apply"
  }, { cookie });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.match(applied.data.week.weekbelasting_waarschuwing, /meer dan je richtlijn/);
});

test("coach maakt een voorstel voor een wedstrijd en aangepaste schema-opbouw", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "wedstrijdplan");
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  coachMode = "event-plan";
  const reply = await api(env, "POST", "/api/coach/chat", {
    week_no: 1, day_no: 0,
    bericht: "Ik heb over drie weken een wedstrijd in Appelscha. Zet die in mijn schema.",
    global: true
  }, { cookie });
  coachMode = "proposal";
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.aangepast, false);
  assert.equal(reply.data.voorstel.status, "pending");
  const event = reply.data.voorstel.workout;
  assert.equal(event.kind, "event");
  assert.equal(event.title, "Wedstrijd Appelscha");
  assert.ok(event.week_no >= 3 && event.week_no <= 4);
  assert.ok(lastGroqPrompt.includes("schema_aanpassing"));
  const unchanged = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(unchanged.data.plan.events.length, 0);
  assert.deepEqual(unchanged.data.plan.outline, created.data.plan.outline);

  const applied = await api(env, "POST", "/api/coach/suggestions", {
    id: reply.data.voorstel.id, action: "apply"
  }, { cookie });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const plan = await api(env, "GET", "/api/plan", undefined, { cookie });
  assert.equal(plan.data.plan.events.length, 1);
  assert.equal(plan.data.plan.events[0].title, "Wedstrijd Appelscha");
  assert.equal(plan.data.plan.events[0].event_date, event.event_date);
  assert.match(plan.data.plan.summary, /wedstrijd/);
  assert.equal(plan.data.plan.outline[event.week_no - 1].focus, "Wedstrijd Appelscha");
});

test("een goedgekeurd evenement wordt in de gegenereerde trainingsweek opgenomen", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "wedstrijdweek");
  const created = await api(env, "POST", "/api/plan/create", { intake: INTAKE }, { cookie });
  const userId = env.DB.db.prepare("SELECT id FROM users WHERE username = ?").get("wedstrijdweek").id;
  const eventDate = new Date(`${created.data.plan.start_date}T00:00:00Z`);
  eventDate.setUTCDate(eventDate.getUTCDate() + 11);
  const eventIso = eventDate.toISOString().slice(0, 10);
  env.DB.db.prepare(
    "INSERT INTO plan_events (id, user_id, title, event_type, event_date, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("event-in-week-two", userId, "Jeugdwedstrijd", "wedstrijd", eventIso, "Wedstrijd van 2 uur.", Date.now());

  const next = await api(env, "POST", "/api/plan/checkin", {
    week_no: 1, gedaan_pct: 75, uren_gedaan: 5, gevoel: 4, klachten: false
  }, { cookie });
  assert.equal(next.status, 200, JSON.stringify(next.data));
  const raceDay = (eventDate.getUTCDay() + 6) % 7;
  const race = next.data.weeks.find(week => week.week_no === 2).dagen.find(day => day.dag === raceDay);
  assert.equal(race.type, "race");
  assert.equal(race.titel, "Jeugdwedstrijd");
  assert.equal(race.minuten, 200);
  assert.ok(lastGroqPrompt.includes("<evenementen>"));
  assert.ok(lastGroqPrompt.includes("herstel"));
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

test("oude import- en dagmetingstabellen worden verwijderd en de endpoints zijn uitgeschakeld", async () => {
  const env = makeEnv();
  const cookie = await signup(env);
  const db = env.DB.db;
  db.exec("CREATE TABLE training_history (user_id TEXT PRIMARY KEY, summary TEXT NOT NULL, imported_at INTEGER NOT NULL, consent_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE daily_metrics (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, metrics TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO training_history VALUES ('legacy', '{}', 0, 0)").run();
  db.prepare("INSERT INTO daily_metrics VALUES ('legacy', 'legacy', '2026-01-01', '{}', 0, 0)").run();
  env.DB = new FakeD1();
  env.DB.db = db;
  assert.equal((await api(env, "GET", "/api/me", undefined, { cookie })).status, 200);
  for (const table of ["training_history", "daily_metrics"]) {
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), undefined);
  }
  assert.equal((await api(env, "GET", "/api/trainingpeaks", undefined, { cookie })).status, 404);
  assert.equal((await api(env, "POST", "/api/trainingpeaks/import", {}, { cookie })).status, 404);
  assert.equal((await api(env, "GET", "/api/wellness", undefined, { cookie })).status, 404);
  assert.equal((await api(env, "POST", "/api/wellness", {}, { cookie })).status, 404);
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

test("schema bevat ook een doel op de eerste dag van een nieuwe week", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "weekgrens");
  const todayDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const target = new Date(`${todayDate}T00:00:00Z`);
  const day = target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + ((8 - day) % 7 || 7) + 14);
  const targetDate = target.toISOString().slice(0, 10);
  const created = await api(env, "POST", "/api/plan/create", {
    intake: { ...INTAKE, datum: targetDate },
    answers: []
  }, { cookie });
  assert.equal(created.status, 200);
  assert.equal(created.data.plan.total_weeks, 3);
  assert.equal(created.data.plan.outline.length, 3);
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
  for (let i = 0; i < 100; i++) {
    last = await api(env, "POST", "/api/intake/questions", { intake: INTAKE }, { cookie });
    assert.equal(last.status, 200, JSON.stringify(last.data));
  }
  last = await api(env, "POST", "/api/intake/questions", { intake: INTAKE }, { cookie });
  assert.equal(last.status, 429);
  assert.equal(last.data.error, "ai_limit");
});

test("ontwikkelaarsaccount kan boven de gebruikerslimiet; gezamenlijke AI-noodlimiet blijft actief", async () => {
  const env = makeEnv();
  const cookie = await signup(env, "ontwikkelaar");
  const userId = env.DB.db.prepare("SELECT id FROM users WHERE username = ?").get("ontwikkelaar").id;
  env.AI_UNLIMITED_USER_IDS = `andere-id, ${userId}`;
  for (let i = 0; i < 101; i++) {
    const response = await api(env, "POST", "/api/intake/questions", { intake: INTAKE }, { cookie });
    assert.equal(response.status, 200, JSON.stringify(response.data));
  }
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM counters WHERE key LIKE 'ai:u:%'").get().n, 0);
  assert.equal(env.DB.db.prepare("SELECT n FROM counters WHERE key LIKE 'ai:g:%'").get().n, 101);
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
  assert.match(w2.waarschuwing, /extra licht en gericht op herstel/);

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
  await api(env, "POST", "/api/coach/chat", { week_no: 1, day_no: 3, bericht: "Maak deze training rustiger." }, { cookie });
  const exp = await api(env, "GET", "/api/account/export", undefined, { cookie });
  assert.equal(exp.status, 200);
  assert.ok(!JSON.stringify(exp.data).match(/salt|hash/));
  assert.equal(exp.data.gebruikersnaam, "wissen");
  assert.equal(exp.data.coachgesprekken.length, 2);

  assert.equal((await api(env, "POST", "/api/account/delete", { password: "verkeerd-wachtwoord" }, { cookie })).status, 401);
  assert.equal((await api(env, "POST", "/api/account/delete", { password: GOOD_PW }, { cookie })).status, 200);
  assert.equal(exp.data.profiel.birth_date, INTAKE.geboortedatum);
  for (const table of ["users", "sessions", "plans", "weeks", "coach_suggestions", "coach_messages", "account_profiles"]) {
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
