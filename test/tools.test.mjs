import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = file => fs.readFileSync(`public/${file}`, "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(read("zones-math.js"), sandbox);
const plain = value => JSON.parse(JSON.stringify(value)); // waarden uit de aparte testomgeving
const Z = sandbox.WSZones;
const app = read("app.js");
const fromApp = new Function(app.match(/function defaultHrZones[\s\S]*?\n}\n/)[0] + app.match(/function defaultPowerZones[\s\S]*?\n}\n/)[0] + "return { defaultHrZones, defaultPowerZones };")();

test("de rekentool geeft dezelfde grenzen als WielerSchema zelf", () => {
  for (let max = 140; max <= 215; max++) assert.deepEqual(plain(Z.hrLimits(max, 0, "percentage")), plain(fromApp.defaultHrZones(max)), `max ${max}`);
  for (let ftp = 90; ftp <= 420; ftp += 3) {
    assert.deepEqual(plain(Z.powerLimits(ftp, 7)), plain(fromApp.defaultPowerZones(ftp, 7)), `ftp ${ftp} (7)`);
    assert.deepEqual(plain(Z.powerLimits(ftp, 5)), plain(fromApp.defaultPowerZones(ftp, 5)), `ftp ${ftp} (5)`);
  }
});

test("hartslagzones: percentage en Karvonen", () => {
  assert.deepEqual(plain(Z.hrLimits(190, 0, "percentage")), [114, 133, 152, 171, 190]);
  assert.deepEqual(plain(Z.hrLimits(190, 50, "karvonen")), [134, 148, 162, 176, 190]);
  const text = plain(Z.ranges(Z.hrLimits(190, 0, "percentage"), 5).map(r => Z.rangeText(r, "bpm")));
  assert.deepEqual(text, ["≤ 114 bpm", "115–133 bpm", "134–152 bpm", "153–171 bpm", "172–190 bpm"]);
  assert.equal(Z.tanaka(40), 180);
});

test("vermogenszones, testen en watt per kilo", () => {
  assert.deepEqual(plain(Z.powerLimits(250, 7)), [138, 188, 225, 263, 300, 375]);
  const seven = plain(Z.ranges(Z.powerLimits(250, 7), 7).map(r => Z.rangeText(r, "W")));
  assert.deepEqual(seven, ["≤ 138 W", "139–188 W", "189–225 W", "226–263 W", "264–300 W", "301–375 W", "> 375 W"]);
  const five = plain(Z.ranges(Z.powerLimits(250, 5), 5).map(r => Z.rangeText(r, "W")));
  assert.deepEqual(five, ["≤ 138 W", "139–188 W", "189–225 W", "226–263 W", "> 263 W"]);
  assert.equal(Z.ftpFromTest("twenty", 263), 250);
  assert.equal(Z.ftpFromTest("eight", 278), 250);
  assert.equal(Z.ftpFromTest("ramp", 333), 250);
  assert.equal(Z.wattsPerKg(250, 70), 3.57);
  assert.equal(Z.POWER_ZONES[7].length, 7);
  assert.equal(Z.POWER_ZONES[5].length, 5);
  assert.equal(Z.HR_ZONES.length, 5);
});

test("de rekenpagina's zijn goed vindbaar en veilig opgebouwd", () => {
  const pages = { "hartslagzones-berekenen": "Hartslagzones berekenen", "ftp-zones-berekenen": "FTP en vermogenszones berekenen" };
  const sitemap = read("sitemap.xml");
  for (const [slug, name] of Object.entries(pages)) {
    const html = read(`${slug}/index.html`);
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(title.length <= 65 && title.includes("WielerSchema"), title);
    assert.ok(description.length >= 100 && description.length <= 175, `${slug}: ${description.length}`);
    assert.ok(html.includes(`<link rel="canonical" href="https://wielerschema.me/${slug}/">`));
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.ok(html.includes(name));
    assert.ok(html.includes('<script src="/zones-math.js"></script>') && html.includes('<script src="/calc.js"></script>'));
    assert.ok(!/<script(?![^>]*(src=|application\/ld\+json))/.test(html), "geen inline scripts (CSP)");
    assert.ok(!/\son(click|input|change)=/i.test(html), "geen inline gebeurtenissen (CSP)");
    assert.ok(html.includes('href="/"') && html.includes("Maak mijn trainingsschema") && html.includes('id="cta"'));
    assert.ok(html.includes("Je betaalt niets extra") && html.includes("sponsored"));
    assert.ok(sitemap.includes(`<loc>https://wielerschema.me/${slug}/</loc>`));
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(block[1]);
  }
  assert.ok(read("hartslagzones-berekenen/index.html").includes('href="/ftp-zones-berekenen/"'));
  assert.ok(read("ftp-zones-berekenen/index.html").includes('href="/hartslagzones-berekenen/"'));
  const home = read("index.html");
  assert.ok(home.includes('href="/hartslagzones-berekenen/"') && home.includes('href="/ftp-zones-berekenen/"'));
  assert.ok(home.includes("Racefietselektronica kopen? Kijk snel!") && home.includes("f=TXL"));
  assert.ok(home.includes('height="300"'));
});

test("de intake neemt zones uit de rekentool over via de link", () => {
  assert.ok(app.includes("hrmax") && app.includes("TOOL_PREFILL") && app.includes("Object.assign(savedProfile, TOOL_PREFILL)"));
});
