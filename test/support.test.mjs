import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";

class FakeD1 {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) { const db = this.db; return {
    args: [], bind(...a) { this.args = a; return this; },
    async first() { return db.prepare(sql).get(...this.args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...this.args) }; },
    async run() { const r = db.prepare(sql).run(...this.args); return { meta: { changes: r.changes } }; } }; }
  async batch(s) { for (const x of s) await x.run(); return []; }
}
const support = async (value) => {
  const env = { DB: new FakeD1() };
  if (value !== undefined) env.TIKKIE_URL = value;
  const res = await worker.fetch(new Request("https://wielerschema.me/api/support"), env);
  return { status: res.status, data: await res.json(), cache: res.headers.get("Cache-Control") };
};

test("steunlink komt uit de Cloudflare-variabele TIKKIE_URL en is voor iedereen zichtbaar", async () => {
  const none = await support();
  assert.equal(none.status, 200);
  assert.equal(none.data.url, null);
  const ok = await support("https://tikkie.me/pay/abc123");
  assert.equal(ok.data.url, "https://tikkie.me/pay/abc123");
  assert.ok(ok.cache.includes("max-age"));
  assert.equal((await support("  https://bunq.me/hessel  ")).data.url, "https://bunq.me/hessel");
});

test("onveilige of onbekende steunlinks worden niet getoond", async () => {
  for (const bad of ["http://tikkie.me/pay/x", "https://tikkie.me.evil.com/x", "https://evil.example/tikkie.me", "javascript:alert(1)", "geen url", "", "https://user@tikkie.me.evil.com/"]) {
    assert.equal((await support(bad)).data.url, null, bad);
  }
});

test("de voettekst bevat de steunlink en de uitleg bij de partnerlink", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  assert.ok(html.includes('id="support-link"') && html.includes('id="partner-info"') && html.includes("ongeveer 6%"));
  assert.ok(html.includes('aria-label="Uitleg over de partnerlink"') && html.includes("Je betaalt niets extra"));
  assert.ok(fs.readFileSync("wrangler.toml", "utf8").includes("keep_vars = true"));
});
