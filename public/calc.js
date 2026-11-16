"use strict";
/* Rekentools van WielerSchema: hartslagzones en FTP/vermogenszones. Alle tekst gaat via textContent. */
(function () {
  const Z = window.WSZones;
  const $ = id => document.getElementById(id);
  const kind = document.body.dataset.calc;
  const COLORS = ["#9aa5b1", "#3b82f6", "#22c55e", "#facc15", "#fb923c", "#ef4444", "#d946ef"];
  const num = el => (el && el.value !== "" ? Number(el.value) : NaN);
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  let copyText = "";

  // rows: [{ code, name, range, hint, color }] of null (met een melding)
  function show(rows, message, cta) {
    $("msg").textContent = message || "";
    $("results").hidden = !rows;
    if (!rows) return;
    const bar = $("zone-bar"), body = $("zones-body");
    bar.replaceChildren(); body.replaceChildren();
    rows.forEach(row => {
      const seg = el("div", "zone-seg");
      seg.style.background = row.color;
      seg.append(el("strong", "", row.code), el("span", "", row.range));
      bar.appendChild(seg);
      const tr = document.createElement("tr");
      const chip = el("span", "chip", row.code); chip.style.background = row.color;
      const first = document.createElement("td"); first.appendChild(chip);
      tr.append(first, el("td", "", row.name), el("td", "range", row.range), el("td", "hint", row.hint));
      body.appendChild(tr);
    });
    bar.setAttribute("aria-label", "Zones: " + rows.map(row => row.code + " " + row.range).join(", "));
    copyText = rows.map(row => row.code + " " + row.name + ": " + row.range).join("\n") + "\n(berekend op wielerschema.me)";
    $("cta").href = "/" + cta;
  }

  function updateHr() {
    const method = $("method").value, max = num($("hrmax")), rest = num($("rest"));
    $("rest-field").hidden = method !== "karvonen";
    if (Number.isNaN(max)) return show(null, "Vul je maximale hartslag in om je zones te zien.");
    if (!(max >= 100 && max <= 230)) return show(null, "Vul een maximale hartslag in tussen 100 en 230 slagen per minuut.");
    if (method === "karvonen" && !(rest >= 30 && rest <= 110 && rest < max - 20)) {
      return show(null, "Vul een rusthartslag in tussen 30 en 110, minstens 20 slagen onder je maximum.");
    }
    const rg = Z.ranges(Z.hrLimits(max, rest, method), 5);
    show(rg.map((range, i) => ({ code: "Z" + (i + 1), name: Z.HR_ZONES[i][0], range: Z.rangeText(range, "bpm"), hint: Z.HR_ZONES[i][1], color: COLORS[i] })), "", "?hrmax=" + max);
  }

  function updateFtp() {
    const mode = $("test").value, count = Number($("count").value), kg = num($("weight"));
    $("ftp-field").hidden = mode !== "direct";
    $("test-field").hidden = mode === "direct";
    const ftp = mode === "direct" ? num($("ftp")) : Z.ftpFromTest(mode, num($("testvalue")));
    $("ftp-result").textContent = "";
    if (Number.isNaN(ftp)) return show(null, "Vul je FTP of je testresultaat in om je zones te zien.");
    if (!(ftp >= 50 && ftp <= 600)) return show(null, "Vul een FTP in tussen 50 en 600 watt, of een geldig testresultaat.");
    const perKg = kg >= 25 && kg <= 150 ? " · " + Z.wattsPerKg(ftp, kg).toLocaleString("nl-NL", { minimumFractionDigits: 2 }) + " W/kg" : "";
    const rg = Z.ranges(Z.powerLimits(ftp, count), count);
    show(rg.map((range, i) => ({ code: "Z" + (i + 1), name: Z.POWER_ZONES[count][i][0], range: Z.rangeText(range, "W"), hint: Z.POWER_ZONES[count][i][1], color: COLORS[i] })), "", "?ftp=" + ftp);
    $("ftp-result").textContent = "Jouw FTP: " + ftp + " W" + perKg;
  }

  const update = kind === "hr" ? updateHr : updateFtp;
  document.querySelectorAll("[data-calc-input]").forEach(input => { input.addEventListener("input", update); input.addEventListener("change", update); });
  if (kind === "hr") {
    $("estimate").addEventListener("click", () => {
      const age = num($("age"));
      if (!(age >= 8 && age <= 90)) { $("msg").textContent = "Vul een leeftijd in tussen 8 en 90 jaar."; return; }
      $("hrmax").value = Z.tanaka(age);
      update();
      $("note").textContent = "Dit is een schatting (208 − 0,7 × leeftijd) en kan per persoon ruim afwijken. Een gemeten maximum is nauwkeuriger.";
    });
  }
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(copyText); $("status").textContent = "Zones gekopieerd."; }
    catch { $("status").textContent = "Kopiëren lukte niet. Selecteer de tabel en kopieer hem zelf."; }
  });
  $("print").addEventListener("click", () => window.print());

  // voettekst: uitleg bij de partnerlink en de steunlink (uit Cloudflare)
  const infoButton = $("partner-info-btn"), info = $("partner-info");
  if (infoButton && info) infoButton.addEventListener("click", () => { info.hidden = !info.hidden; infoButton.setAttribute("aria-expanded", String(!info.hidden)); });
  fetch("/api/support").then(res => res.json()).then(data => {
    const link = $("support-link");
    if (link && data.url) { link.href = data.url; link.hidden = false; }
  }).catch(() => {});

  update();
})();
