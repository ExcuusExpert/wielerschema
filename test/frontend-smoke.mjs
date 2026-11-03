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
  if (prompt.includes("vervolgvragen")) content = JSON.stringify({ vragen: [{ vraag: "Hoeveel uur train je nu?" }] });
  else if (prompt.includes("Maak een trainingsschema van")) {
    const n = Number(prompt.match(/van (\d+) weken/)[1]);
    content = JSON.stringify({ samenvatting: "Rustige opbouw naar je doel.", weken: Array.from({ length: n }, (_, i) => ({ week: i + 1, fase: "opbouw", focus: "Basis", uren: 6 })), week1: week(90) });
  } else if (prompt.includes("Maak nu week")) content = JSON.stringify({ uitleg: "Iets rustiger.", week: week(80) });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};

// --- minimale DOM ---
class TextNode { constructor(t) { this.nodeType = 3; this.data = t; } get textContent() { return this.data; } }
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.className = ""; this.disabled = false; this._value = undefined; this.checked = false;
    this.classList = { add: (c) => { this.className += " " + c; } }; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
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

const root = { app: new El("main"), nav: new El("nav") };
const jar = {};
const env = { DB: new FakeD1(), GROQ_API_KEY: "test" };
const sandbox = {
  console, Date, Math, JSON, Number, String, Array, Promise, Object, Error, setTimeout, URL: { createObjectURL: () => "blob:x" }, Blob: class {},
  document: { getElementById: (id) => (id === "app" ? root.app : root.nav), createElement: (t) => new El(t), createTextNode: (t) => new TextNode(t), body: new El("body") },
  window: { scrollTo() {} }, confirm: () => true,
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

const doel = find(root.app, e => e.tagName === "INPUT" && e.attrs.type === "text")[0];
doel.value = "Toertocht van 120 km";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Een paar vragen van de coach") && text().includes("Hoeveel uur train je nu?"), "vragen van de coach getoond");

find(root.app, e => e.tagName === "TEXTAREA")[0].value = "4 uur";
await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Toertocht van 120 km") && text().includes("Week 1") && text().includes("Rustige opbouw"), "schema getoond met week 1");
ok(find(root.app, e => e.className.includes("day")).length >= 7, "zeven dagkaarten");
ok(text().includes("Hoe ging week 1?"), "check-in formulier onder de laatste week");

await submit(find(root.app, e => e.tagName === "FORM")[0]);
ok(text().includes("Week 2") && text().includes("Iets rustiger."), "na check-in: week 2 met uitleg van de coach");
ok(!text().includes("Hoe ging week 1?") && text().includes("Hoe ging week 2?"), "check-in hoort nu bij week 2");

find(root.nav, e => e.tagName === "BUTTON" && e.textContent === "Account")[0].click();
ok(text().includes("Ingelogd als") && text().includes("hessel"), "accountpagina");
console.log("\nRooktest geslaagd.");
process.exit(0);
