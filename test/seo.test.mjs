import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/worker.js";

const read = (file) => fs.readFileSync(`public/${file}`, "utf8");
const html = read("index.html");

test("startpagina bevat echte inhoud in de ruwe HTML en geen JavaScript-melding als samenvatting", () => {
  const beforeNoscript = html.split("<noscript>")[0];
  assert.ok(!beforeNoscript.includes("Deze site heeft JavaScript nodig"));
  assert.ok(!html.includes("Deze site heeft JavaScript nodig"));
  assert.match(beforeNoscript, /<h1>WielerSchema:/);
  assert.ok(beforeNoscript.includes("Veelgestelde vragen") && beforeNoscript.includes("Wat kun je met WielerSchema?"));
  assert.ok(beforeNoscript.toLowerCase().includes("wielertrainingsschema"));
});

test("titel, beschrijving, canonical en deelafbeelding zijn netjes", () => {
  const title = html.match(/<title>(.*?)<\/title>/s)[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(title.length <= 65, title);
  assert.ok(description.length >= 100 && description.length <= 170, String(description.length));
  assert.ok(html.includes('<link rel="canonical" href="https://wielerschema.me/">'));
  assert.ok(html.includes('og:image" content="https://wielerschema.me/og-image.png"'));
  assert.ok(!html.includes("workers.dev"));
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].name, "WielerSchema");
  assert.equal(blocks[1]["@type"], "WebSite");
  assert.ok(read("privacy.html").includes('rel="canonical" href="https://wielerschema.me/privacy.html"'));
});

test("robots.txt, sitemap.xml en og-image zijn aanwezig en kloppen", () => {
  const robots = read("robots.txt");
  assert.ok(robots.includes("Sitemap: https://wielerschema.me/sitemap.xml") && robots.includes("Disallow: /api/"));
  const sitemap = read("sitemap.xml");
  assert.ok(sitemap.includes("<loc>https://wielerschema.me/</loc>") && sitemap.includes("<loc>https://wielerschema.me/privacy.html</loc>"));
  const png = fs.readFileSync("public/og-image.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("de inhoud na het laden (app.js) komt overeen met de ruwe HTML", () => {
  const js = read("app.js");
  const questions = [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map(m => m[1]);
  assert.equal(questions.length, 6);
  for (const question of questions) assert.ok(js.includes(question), question);
  for (const item of [...html.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1])) assert.ok(js.includes(item.replaceAll("&amp;", "&")), item);
});

test("het workers.dev-adres stuurt pagina's door naar het eigen domein", async () => {
  const env = { ASSETS: { fetch: async () => new Response("pagina", { status: 200 }) } };
  const redirect = await worker.fetch(new Request("https://wielerschema.hesselh.workers.dev/privacy.html?x=1"), env);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("Location"), "https://wielerschema.me/privacy.html?x=1");
  assert.equal((await worker.fetch(new Request("https://wielerschema.hesselh.workers.dev/", { method: "HEAD" }), env)).status, 301);
  assert.equal((await worker.fetch(new Request("https://wielerschema.hesselh.workers.dev/api/login", { method: "POST", body: "{}" }), env)).status !== 301, true);
  const own = await worker.fetch(new Request("https://wielerschema.me/"), env);
  assert.equal(own.status, 200);
});
