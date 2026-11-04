// Rooktest: draait public/app.js tegen de echte worker (nagebootste D1 en Groq) met een minimale nagebootste DOM.
import vm from "node:vm";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";

const BASE = "https://wielerschema.test";
class FakeD1 {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) { const db = this.db; return { args: [], bind(...a) { this.args = a.map(v => v ?? null); return this; },
    async first() { return db.prepare(sql).get(...this.args) ?? null; }, async all() { return { results: db.prepare(sql).all(...this.args) }; },
    async run() { db.prepare(sql).run(...this.args); return {}; } }; }
  async batch(s) { for (const x of s) await x.run(); return []; }
}
const week = (m) => ({ dagen: Array.from({ length: 7 }, (_, d) => ({ dag: d, type: "duurrit", minuten: m, zone: "Z2", titel: "Duurrit", beschrijving: "Rustig, RPE 4" })), tips: "Drink genoeg." });
let coachTurn = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.groq.com")) return realFetch(url, init);
  const prompt = JSON.parse(init.body).messages[1].content;
  let content = "{}";
  if (prompt.includes("vervolgvragen")) content = JSON.stringify({ vragen: [{ vraag: "Hoeveel uur train je nu?" }, { vraag: "Heb je ervaring met intervallen?" }] });
  else if (prompt.includes("Maak een trainingsschema van")) {
    const n = Number(prompt.match(/van (\d+) weken/)[1]);
    content = JSON.stringify({ samenvatting: "Rustige opbouw naar je doel.", weken: Array.from({ length: n }, (_, i) => ({ week: i + 1, fase: "opbouw", focus: "Basis", uren: 6 })), week1: week(90) });
  } else if (prompt.includes("Maak nu week")) content = JSON.stringify({ uitleg: "Iets rustiger.", week: week(80) });
  else if (prompt.includes("Nieuw bericht van de gebruiker")) {
    coachTurn++;
    content = coachTurn === 1 ? JSON.stringify({
      antwoord: "Hoe lang duurt de rit ongeveer? Ik kan de intensiteit open laten.",
      voorstel: null,
      week_feedback: null
    }) : JSON.stringify({
      antwoord: "Ik heb de MTB-rit op zaterdag in je schema gezet.",
      voorstel: { dag: 5, type: "mtb", minuten: 45, zone: "Z2", titel: "MTB-rit met de club", beschrijving: "45 minuten op Z2." },
      week_feedback: null
    });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};

// --- minimale DOM ---
class TextNode { constructor(t) { this.nodeType = 3; this.data = t; } get textContent() { return this.data; } }
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.className = ""; this.disabled = false; this._value = undefined; this.checked = false;
    this.classList = { add: (c) => { this.className += " " + c; } }; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  append(...items) { items.forEach(item => this.appendChild(typeof item === "string" ? new TextNode(item) : item)); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "value") this._value = String(v); if (k === "checked") this.checked = true; }
  removeAttribute(k) { delete this.attrs[k]; }
  focus() {}
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); }
  get textContent() { return this.children.map(c => c.textContent).join(""); }
  set textContent(v) { this.children = [new TextNode(String(v))]; }
  get value() {
    if (this.tagName === "SELECT") { const opt = this.children.find(o => o.attrs.selected !== undefined) || this.children[0]; return opt ? opt.attrs.value : ""; }
    if (this._value !== undefined) return this._value;
    return this.tagName === "TEXTAREA" ? this.textContent : "";
  }
  set value(v) { this._value = String(v); }
}
const walk = (el, fn) => { fn(el); (el.children || []).forEach(c => c.children && walk(c, fn)); };
const find = (root, pred) => { const out = []; walk(root, (e) => { if (pred(e)) out.push(e); }); return out; };

const root = { app: new El("main"), nav: new El("nav"), account: new El("div"), launcher: new El("div") };
const jar = {};
const env = { DB: new FakeD1(), GROQ_API_KEY: "test" };
const sandbox = {
  console, Date, Math, JSON, Number, String, Array, Promise, Object, Error, setTimeout, URL: { createObjectURL: () => "blob:x" }, Blob: class {},
  document: { getElementById: (id) => ({ app: root.app, nav: root.nav, "sidebar-account": root.account, "coach-launcher": root.launcher })[id], createElement: (t) => new El(t), createTextNode: (t) => new TextNode(t), body: new El("body") },
  window: { scrollTo() {} }, navigator: { clipboard: { writeText: async (value) => { sandbox.copiedText = value; } } }, confirm: () => true,
  copiedText: "",
  fetch: async (path, init = {}) => {
    const headers = { ...(init.headers || {}), "CF-Connecting-IP": "1.1.1.1" };
    if (jar.cookie) headers.Cookie = jar.cookie;
    const res = await worker.fetch(new Request(BASE + path, { method: init.method || "GET", headers, body: init.body }), env);
    const sc = res.headers.get("Set-Cookie");
    if (sc) { const m = sc.match(/__Host-ws=([0-9a-f]*)/); jar.cookie = m && m[1] ? `__Host-ws=${m[1]}` : null; }
    return res;
  }
};
sandbox.window.confirm = sandbox.confirm;
vm.createContext(sandbox);

const tick = () => new Promise(r => setTimeout(r, 80));
const text = () => root.app.textContent;
const ok = (cond, msg) => { if (!cond) { console.error("MISLUKT:", msg, "\nScherm:", text().slice(0, 1000)); process.exit(1); } console.log("ok:", msg); };
const submit = async (form) => { for (const fn of form.listeners.submit || []) await fn({ preventDefault() {} }); await tick(); await tick(); };
const youthBirthDate = new Date();
youthBirthDate.setUTCFullYear(youthBirthDate.getUTCFullYear() - 17);

vm.runInContext(fs.readFileSync("public/app.js", "utf8"), sandbox, { filename: "app.js" });
await tick();
ok(text().includes("Jouw wielerdoel") && text().includes("Maak mijn schema") && text().includes("Jeugdrenner?"), "publieke startpagina zichtbaar voor een bezoeker");

find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Maak mijn schema")[0].click();
ok(text().includes("Account maken") && text().includes("Terug naar startpagina"), "registreerscherm is bereikbaar vanaf de startpagina");
ok(text().includes("Account maken"), "registreerscherm");
const inputs = find(root.app, e => e.tagName === "INPUT");
inputs.find(i => i.attrs.name === "username").value = "hessel";
inputs.find(i => i.attrs.name === "password").value = "een-lang-wachtwoord";
inputs.find(i => i.attrs.name === "consent").checked = true;
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Jouw doel") && find(root.app, e => e.className === "wizard-progress").length === 1, "na registreren: eerste stap van de wizard");
ok(text().includes("Geboortedatum") && text().includes("ouder/verzorger"), "geboortedatum en jeugdbegeleiding worden helder uitgelegd");
find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "goal")[0].value = "Toertocht van 120 km";
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Volgende")[0].click();
ok(text().includes("Vul je geldige geboortedatum in"), "wizard controleert geboortedatum voor doorgaan");
find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "geboortedatum")[0].value = youthBirthDate.toISOString().slice(0, 10);
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Volgende")[0].click();
ok(text().includes("2. Jouw tijd"), "wizard gaat door naar beschikbare tijd");
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Volgende")[0].click();
ok(text().includes("3. Jouw training") && text().includes("meetapparatuur"), "wizard gaat door naar trainingsgegevens");
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Vorige stap")[0].click();
ok(text().includes("2. Jouw tijd") && find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "goal")[0].value === "Toertocht van 120 km", "vorige stap behoudt ingevulde antwoorden");
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Volgende")[0].click();
ok(text().includes("Welke meetapparatuur gebruik je?"), "meetapparatuur staat in de laatste stap");
const meter = find(root.app, e => e.tagName === "SELECT")[1];
const chooseMeter = value => {
  for (const option of meter.children) delete option.attrs.selected;
  meter.children.find(option => option.attrs.value === value).attrs.selected = "";
  for (const listener of meter.listeners.change || []) listener();
};
chooseMeter("heart_rate");
find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "hr_max")[0].value = "190";
find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "hr_threshold")[0].value = "170";
chooseMeter("both");
ok(find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "hr_max")[0].value === "190" &&
  find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "ftp").length === 1,
  "meterkeuze toont beide kalibraties zonder ingevulde hartslaggegevens te wissen");
find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "ftp")[0].value = "220";

await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Vragen van de coach") && text().includes("Hoeveel uur train je nu?"), "eerste coachvraag in chat getoond");

find(root.app, e => e.tagName === "TEXTAREA")[0].value = "4 uur";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Hoeveel uur train je nu?") && text().includes("Heb je ervaring met intervallen?") && text().includes("4 uur"), "chat toont gesprek en volgende vraag");
find(root.app, e => e.tagName === "TEXTAREA")[0].value = "Ja, een beetje";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Toertocht van 120 km") && text().includes("Week 1") && text().includes("Rustige opbouw"), "schema getoond met week 1");
ok(text().includes("Jeugdrenner: train met begeleiding"), "jeugdrenner krijgt een blijvende begeleidingsmelding bij het schema");
ok(find(root.app, e => e.className.includes("day")).length >= 7, "zeven dagkaarten");
ok(find(root.app, e => e.className.includes("week-visual-day")).length === 7, "week heeft een visueel overzicht van alle zeven dagen");
ok(!text().includes("Hoeveel van het schema heb je gedaan?"), "oude weekcheck-in met formulier is verwijderd");
ok(!text().includes("Dagmetingen") && !text().includes("Kopieer trainingsprompt"), "dagmetingen en TrainingPeaks-prompt staan niet prominent in het weekschema");
const planData = await (await sandbox.fetch("/api/plan")).json();
const dayToEdit = planData.plan.intake.dagen[0];
const dayButton = find(root.app, e => e.className.includes("week-visual-day"))[dayToEdit];
dayButton.click();
ok(find(root.app, e => e.attrs.role === "dialog").length === 1 && text().includes("Training aanpassen"),
  "op een dag klikken opent een detailvenster");
ok(text().includes("Optioneel: gebruiken in TrainingPeaks AI"), "TrainingPeaks-prompt zit achter een optionele uitklapper");
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Kopieer trainingsprompt")[0].click();
await tick();
ok(sandbox.copiedText.includes("Build Intervals By: Duration") && sandbox.copiedText.includes("Intensity: Heart Rate") && sandbox.copiedText.includes("hartslagzones"), "TrainingPeaks-prompt gebruikt hartslagzones en workoutduur");
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Training aanpassen")[0].click();
const editForm = find(root.app, e => e.tagName === "FORM" && e.className.includes("workout-editor"))[0];
find(editForm, e => e.tagName === "INPUT" && e.attrs.type === "number")[0].value = "70";
find(editForm, e => e.tagName === "INPUT" && e.attrs.type === "text")[0].value = "Handmatige duurrit";
find(editForm, e => e.tagName === "TEXTAREA")[0].value = "70 minuten rustig, RPE 3.";
const zoneSelect = find(editForm, e => e.tagName === "SELECT")[1];
for (const option of zoneSelect.children) delete option.attrs.selected;
zoneSelect.children.find(option => option.attrs.value === "Z1").attrs.selected = "";
await submit(editForm);
ok(text().includes("Handmatige duurrit") && text().includes("1 u 10 min"), "training handmatig aanpassen slaat wijzigingen in het schema op");
find(root.app, e => e.className.includes("week-visual-day"))[dayToEdit].click();
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Kopieer trainingsprompt")[0].click();
await tick();
ok(sandbox.copiedText.includes("Duration: 70 minuten") &&
  sandbox.copiedText.includes("Target: Z1 volgens mijn ingestelde hartslagzones, 70 minuten rustig, RPE 3.") &&
  sandbox.copiedText.includes("Training: Handmatige duurrit."),
  "TrainingPeaks-prompt gebruikt de nieuwste handmatig opgeslagen training");

find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Activiteiten")[0].click();
ok(text().includes("Nog geen activiteiten gekoppeld") && !text().includes("TrainingPeaks"), "activiteiten-tab toont status zonder importfunctie");
ok(text().includes("Een koppeling met Strava is nog niet beschikbaar"), "Strava staat eerlijk als toekomstige koppeling aangegeven");
find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Garmin koppelen")[0].click();
ok(text().includes("Koppel Garmin") && text().includes("Koppeling nog niet actief") &&
  find(root.app, e => e.tagName === "BUTTON" && e.attrs.disabled !== undefined && e.textContent === "Garmin binnenkort koppelen").length === 1,
  "Garmin-pagina toont een duidelijke status zonder een niet-bestaande koppeling te suggereren");

find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Coach")[0].click();
await tick();
ok(!text().includes("Week als context") && !text().includes("Training als context") && !text().includes("Week 1 · Ma"), "chat toont geen week- of dagcontext");
ok(root.launcher.textContent.includes("Je wielercoach"), "coachknop heeft een herkenbare compacte launcher");
ok(!text().includes("dagelijkse meetwaarden"), "coach krijgt nog geen automatische metingen zolang Garmin niet is gekoppeld");
let coachForm = find(root.app, e => e.tagName === "FORM" &&
  find(e, child => child.className === "chat-send").length)[0];
find(coachForm, e => e.tagName === "TEXTAREA")[0].value = "Ik heb komende zaterdag een MTB-rit met de club. Kan je dat erop zetten?";
const chatSending = submit(coachForm);
await tick();
ok(text().includes("De coach is je bericht aan het verwerken"), "coachchat toont een zichtbare laadstatus tijdens antwoord");
await chatSending;
ok(text().includes("Hoe lang duurt de rit ongeveer?"), "coach vraagt alleen de ontbrekende ritduur");
coachForm = find(root.app, e => e.tagName === "FORM" &&
  find(e, child => child.className === "chat-send").length)[0];
find(coachForm, e => e.tagName === "TEXTAREA")[0].value = "Ik weet nog niet welke zones en intensiteiten, dus laat dat leeg.";
await submit(coachForm);
await tick();
ok(text().includes("Ik heb een wijzigingsvoorstel voor zaterdag klaargezet.") &&
  text().includes("Huidige training") && text().includes("Voorgestelde training") &&
  text().includes("Voorstel toepassen"), "coach toont eerst het huidige en voorgestelde schema");
const approveButton = find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Voorstel toepassen")[0];
for (const listener of approveButton.listeners.click || []) await listener({ preventDefault() {} });
await tick();
await tick();
ok(text().includes("Training aangepast"), "coachwijziging wordt pas na bevestigen toegepast");
const afterApply = await (await sandbox.fetch("/api/plan")).json();
const saturday = afterApply.weeks[0].dagen.find(day => day.dag === 5);
ok(saturday.type === "mtb" && saturday.titel === "MTB-rit met de club" && saturday.zone === "" && saturday.beschrijving === "Intensiteit en trainingszone zijn nog open.", "MTB-rit staat op zaterdag met lege intensiteit");
const oldStart = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
env.DB.db.prepare("UPDATE plans SET start_date = ?").run(oldStart);
await vm.runInContext("start()", sandbox);
await tick();
find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Plan")[0].click();
ok(!text().includes("Hoeveel van het schema heb je gedaan?"), "plan bevat geen lang weekcheck-informulier");
ok(text().includes("Vertel het aan je coach"), "plan nodigt na de week uit voor een chat-terugblik");
find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Coach")[0].click();
await tick();
ok(text().includes("Heb je kunnen trainen, en hoe voelde het?"), "coach vraagt zelf naar de afgelopen trainingsweek");

find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Account")[0].click();
ok(text().includes("Ingelogd als") && text().includes("hessel"), "accountpagina");
ok(text().includes("Trainingsprofiel") && text().includes("Geboortedatum") &&
  text().includes("Hartslagzones aanpassen") && text().includes("Gebruikersnaam en wachtwoord"),
  "account bevat bewerkbaar trainingsprofiel en inloggegevens");
const accountForms = find(root.app, e => e.tagName === "FORM");
await submit(accountForms[0]);
ok(text().includes("Profiel opgeslagen en je huidige schema bijgewerkt."), "accountprofiel kan worden opgeslagen");
const credentialForm = find(root.app, e => e.tagName === "FORM")[1];
find(credentialForm, e => e.tagName === "INPUT" && e.attrs.type === "text")[0].value = "hessel2";
find(credentialForm, e => e.tagName === "INPUT" && e.attrs.autocomplete === "current-password")[0].value = "een-lang-wachtwoord";
await submit(credentialForm);
ok(text().includes("hessel2") && text().includes("Accountgegevens opgeslagen."), "gebruikersnaam kan vanuit Account worden gewijzigd");
console.log("\nRooktest geslaagd.");
process.exit(0);
