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
  else if (prompt.includes("Nieuw bericht van de gebruiker")) content = JSON.stringify({
    antwoord: "Ik stel een rustige duurtraining voor. Pas ik die voor je toe?",
    voorstel: { type: "duurrit", minuten: 55, zone: "Z2", titel: "Rustige duur", beschrijving: "55 minuten op Z2, RPE 3-4." }
  });
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
const ok = (cond, msg) => { if (!cond) { console.error("MISLUKT:", msg, "\nScherm:", text().slice(0, 300)); process.exit(1); } console.log("ok:", msg); };
const submit = async (form) => { for (const fn of form.listeners.submit || []) await fn({ preventDefault() {} }); await tick(); await tick(); };

vm.runInContext(fs.readFileSync("public/app.js", "utf8"), sandbox, { filename: "app.js" });
await tick();
ok(text().includes("Inloggen") && text().includes("Een trainingsschema dat met je meegroeit"), "inlogscherm zichtbaar voor een bezoeker");

find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Maak er een")[0].click();
ok(text().includes("Account maken"), "registreerscherm");
const inputs = find(root.app, e => e.tagName === "INPUT");
inputs.find(i => i.attrs.name === "username").value = "hessel";
inputs.find(i => i.attrs.name === "password").value = "een-lang-wachtwoord";
inputs.find(i => i.attrs.name === "consent").checked = true;
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Jouw doel en situatie"), "na registreren: intakeformulier");
ok(text().includes("Welke meetapparatuur gebruik je?") && text().includes("TrainingPeaks-gegevens importeren"), "meterkeuze en route naar TrainingPeaks-import zichtbaar");
const meter = find(root.app, e => e.tagName === "SELECT")[1];
for (const option of meter.children) delete option.attrs.selected;
meter.children.find(option => option.attrs.value === "heart_rate").attrs.selected = "";

const doel = find(root.app, e => e.tagName === "INPUT" && e.attrs.type === "text")[0];
doel.value = "Toertocht van 120 km";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Vragen van de coach") && text().includes("Hoeveel uur train je nu?"), "eerste coachvraag in chat getoond");

find(root.app, e => e.tagName === "TEXTAREA")[0].value = "4 uur";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Hoeveel uur train je nu?") && text().includes("Heb je ervaring met intervallen?") && text().includes("4 uur"), "chat toont gesprek en volgende vraag");
find(root.app, e => e.tagName === "TEXTAREA")[0].value = "Ja, een beetje";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Toertocht van 120 km") && text().includes("Week 1") && text().includes("Rustige opbouw"), "schema getoond met week 1");
ok(find(root.app, e => e.className.includes("day")).length >= 7, "zeven dagkaarten");
ok(text().includes("Hoe ging week 1?"), "check-in formulier onder de laatste week");
ok(text().includes("Dagmetingen en analyse bekijken") && text().includes("Kopieer prompt voor TrainingPeaks AI"), "herstelmetingen en TrainingPeaks-workoutprompt zichtbaar");
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Kopieer prompt voor TrainingPeaks AI")[0].click();
await tick();
ok(sandbox.copiedText.includes("Build Intervals By: Duration") && sandbox.copiedText.includes("Intensity: Heart Rate") && sandbox.copiedText.includes("hartslagzones"), "TrainingPeaks-prompt gebruikt hartslagzones en workoutduur");

find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Analyse")[0].click();
ok(text().includes("Dagmetingen toevoegen") && text().includes("Body Battery hoog"), "analysepagina biedt herstelmetingen");
find(root.app, e => e.tagName === "INPUT" && e.attrs.name === "resting_hr")[0].value = "52";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Recente dagmetingen") && text().includes("52 bpm"), "dagmeting kan worden opgeslagen en getoond");

find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Coach")[0].click();
await tick();
const coachForm = find(root.app, e => e.tagName === "FORM" &&
  find(e, child => child.tagName === "BUTTON" && child.textContent === "Stuur naar de coach").length)[0];
find(coachForm, e => e.tagName === "TEXTAREA")[0].value = "Maak deze training rustiger.";
const before = await (await sandbox.fetch("/api/plan")).json();
const beforeMinutes = before.weeks[0].dagen.find(day => day.dag === 1).minuten;
const chatSending = submit(coachForm);
await tick();
ok(text().includes("De coach is je bericht aan het verwerken"), "coachchat toont een zichtbare laadstatus tijdens antwoord");
await chatSending;
ok(text().includes("Ik stel een rustige duurtraining voor") && text().includes("Pas training aan"), "coachchat toont een voorstel dat wacht op bevestiging");
const stillUnchanged = await (await sandbox.fetch("/api/plan")).json();
ok(stillUnchanged.weeks[0].dagen.find(day => day.dag === 1).minuten === beforeMinutes, "training blijft ongewijzigd totdat de gebruiker bevestigt");
find(root.app, e => e.tagName === "BUTTON" && e.textContent === "Pas training aan")[0].click();
await tick();
await tick();
const afterApply = await (await sandbox.fetch("/api/plan")).json();
ok(afterApply.weeks[0].dagen.find(day => day.dag === 1).minuten === 55, "training verandert pas na bevestiging");
find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Plan")[0].click();

const checkin = find(root.app, e => e.tagName === "FORM" && e.children.some(c => c.tagName === "BUTTON" && c.textContent === "Maak week 2"))[0];
await submit(checkin);
ok(text().includes("Week 2") && text().includes("Iets rustiger."), "na check-in: week 2 met uitleg van de coach");
ok(!text().includes("Hoe ging week 1?") && text().includes("Hoe ging week 2?"), "check-in hoort nu bij week 2");

find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Account")[0].click();
ok(text().includes("Ingelogd als") && text().includes("hessel"), "accountpagina");
console.log("\nRooktest geslaagd.");
process.exit(0);
