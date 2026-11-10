"use strict";

/* WielerSchema frontend. Bewust zonder innerHTML: alle tekst gaat via textContent (veilig tegen XSS). */

const DAGEN_KORT = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const TYPE_LABEL = {
  rust: "Rust", duurrit: "Duurrit", tempo: "Tempo", drempel: "Drempel", vo2max: "VO2max", sprint: "Sprint",
  kracht: "Kracht", techniek: "Techniek", herstelrit: "Herstelrit", race: "Wedstrijd", mtb: "MTB"
};
const ZONE_OPTIONS = ["", "Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7"];
const FASE_LABEL = { basis: "Basis", opbouw: "Opbouw", piek: "Piek", afbouw: "Afbouw", herstel: "Herstel" };

const app = document.getElementById("app");
const nav = document.getElementById("nav");
const sidebarAccount = document.getElementById("sidebar-account");
const coachLauncher = document.getElementById("coach-launcher");

const state = { user: null, data: null, week: 1, page: "plan", coachDraft: "", unreadCoach: 0 };

// ---------- hulpfuncties ----------
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function show(...nodes) { clear(app); nodes.flat().forEach(n => n && app.appendChild(n)); window.scrollTo(0, 0); }
function coachRichText(text) {
  const fragment = h("span", {});
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
  parts.forEach(part => {
    if (/^\*\*[^*]+\*\*$/.test(part)) fragment.appendChild(h("strong", { text: part.slice(2, -2) }));
    else fragment.appendChild(document.createTextNode(part));
  });
  return fragment;
}
function storageKey() { return state.user ? `wielerschema:coach-read:${state.user}` : ""; }
function getCoachReadAt() {
  try { return Number(localStorage.getItem(storageKey()) || 0); } catch { return 0; }
}
function markCoachRead() {
  state.unreadCoach = 0;
  try { localStorage.setItem(storageKey(), String(Date.now())); } catch {}
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || "Er ging iets mis. Probeer het opnieuw.");
    error.status = res.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", { class: "label", text: label }), input, hint ? h("span", { class: "hint", text: hint }) : null);
}

function minutesText(m) {
  const hours = Math.floor(m / 60), min = m % 60;
  if (!hours) return `${min} min`;
  return min ? `${hours} u ${min} min` : `${hours} u`;
}

function dateOffset(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function cleanWorkoutDescription(text) {
  return String(text || "").replace(/\bRPE\s*\d+(?:\s*[-–/]\s*\d+)?(?:\s*\/\s*10)?/gi, "")
    .replace(/\s+([,.])/g, "$1").replace(/,\./g, ".").replace(/\s{2,}/g, " ").trim();
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateLabel(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function parseDutchDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2})[-/.]?(\d{2})[-/.]?(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

function dutchDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "";
}

function activityDateLabel(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Onbekende datum" : date.toLocaleDateString("nl-NL", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
  });
}

function birthDateInput(iso) {
  const input = h("input", {
    type: "text", name: "geboortedatum", inputmode: "numeric", autocomplete: "bday",
    placeholder: "DD-MM-JJJJ", pattern: "\\d{2}[-/.]?\\d{2}[-/.]?\\d{4}", maxlength: 10,
    required: true, value: dutchDate(iso || "")
  });
  input.addEventListener("blur", () => {
    const parsed = parseDutchDate(input.value);
    if (parsed) input.value = dutchDate(parsed);
  });
  return input;
}

function defaultHrZones(maximum) {
  return [0.6, 0.7, 0.8, 0.9].map(factor => Math.round(maximum * factor)).concat(maximum);
}

function defaultPowerZones(ftp, count) {
  const factors = count === 5 ? [0.55, 0.75, 0.90, 1.05] : [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];
  return factors.map(factor => Math.round(ftp * factor));
}

function validPowerLimits(limits, count) {
  if (!limits || limits.length !== count - 1 || limits.some(value => !Number.isInteger(value))) return null;
  for (let index = 1; index < limits.length; index++) {
    if (limits[index] <= limits[index - 1]) return null;
  }
  return limits;
}

function coachWheel() {
  return h("span", { class: "coach-wheel", "aria-hidden": "true" },
    h("span", { class: "coach-wheel-spokes" }));
}

function setCoachWaiting(element, message) {
  clear(element);
  element.append(coachWheel(), h("span", { text: message }));
  element.className = "coach-thinking";
  element.setAttribute("role", "status");
}

function zoneRangeList(title, unit, count, getLimits) {
  const list = h("ul", { class: "zone-ranges", "aria-label": title });
  const refresh = () => {
    clear(list);
    const limits = getLimits();
    if (!limits) return;
    for (let index = 0; index < count(); index++) {
      const upper = limits[index];
      const range = index === 0 ? `≤ ${upper} ${unit}`
        : upper === undefined ? `> ${limits[index - 1]} ${unit}`
          : `${limits[index - 1] + 1}–${upper} ${unit}`;
      list.appendChild(h("li", {}, h("strong", { text: `Z${index + 1}` }), h("span", { text: range })));
    }
  };
  refresh();
  return { element: list, refresh };
}

function powerZoneEditor(countInput, initial, ftpInput, onChange) {
  const grid = h("div", { class: "zone-grid" });
  let inputs = [];
  let custom = false;
  const defaultLimits = () => ftpInput.value ? defaultPowerZones(Number(ftpInput.value), Number(countInput.value)) : [];
  const initialDefaults = defaultLimits();
  if (initial?.length === initialDefaults.length &&
      initial.some((value, index) => value !== initialDefaults[index])) custom = true;
  const render = () => {
    const oldValues = custom ? inputs.map(input => input.value) : [];
    const size = Number(countInput.value) - 1;
    inputs = Array.from({ length: size }, (_, index) => h("input", {
      type: "number", min: 20, max: 2000, step: 1,
      name: `power_z${index + 1}`, placeholder: "—",
      value: oldValues[index] ?? (custom ? initial?.[index] ?? "" : "")
    }));
    clear(grid);
    grid.append(...inputs.map((input, index) => field(`Z${index + 1} tot (W)`, input)));
    inputs.forEach(input => input.addEventListener("input", () => { custom = true; onChange(); }));
    onChange();
  };
  const calculateButton = h("button", {
    class: "btn ghost small", type: "button", text: "Aangepaste grenzen wissen",
    onclick: () => {
      custom = false;
      initial = null;
      inputs.forEach(input => { input.value = ""; });
      onChange();
    }
  });
  countInput.addEventListener("change", () => { custom = false; initial = null; render(); });
  render();
  return {
    element: h("details", { class: "zone-editor" },
      h("summary", { text: "Vermogenszones aanpassen" }),
      h("p", { class: "hint", text: "Optioneel: stel eigen wattgrenzen in. Vul alle grenzen in; wis ze om de FTP-standaard te gebruiken." }),
      grid, calculateButton),
    values: () => !custom ? null : inputs.every(input => input.value === "") ? null
      : inputs.map(input => input.value === "" ? "" : Number(input.value))
  };
}

function measurementSettings(initial = {}, meter) {
  const container = h("div", { class: "stack equipment-settings" });
  const hrMax = h("input", { type: "number", name: "hr_max", min: 60, max: 240, step: 1, required: true, value: initial.hr_max ?? "" });
  const ftp = h("input", { type: "number", name: "ftp", min: 50, max: 1000, step: 1, required: true, value: initial.ftp ?? "" });
  const inferredCount = initial.power_zone_count ?? (initial.power_zones?.length === 4 ? 5 : 7);
  const powerCount = h("select", { name: "power_zone_count" },
    h("option", { value: 5, selected: inferredCount === 5, text: "5 zones" }),
    h("option", { value: 7, selected: inferredCount !== 5, text: "7 zones" }));
  let refreshPowerTable = () => {};
  const powerEditor = powerZoneEditor(powerCount, initial.power_zones, ftp, () => refreshPowerTable());
  const hrTable = zoneRangeList("Hartslagzones op basis van maximale hartslag", "bpm", () => 5,
    () => hrMax.value ? defaultHrZones(Number(hrMax.value)) : null);
  const powerTable = zoneRangeList("Vermogenszones", "W", () => Number(powerCount.value), () =>
    validPowerLimits(powerEditor.values(), Number(powerCount.value)) ||
      (ftp.value ? defaultPowerZones(Number(ftp.value), Number(powerCount.value)) : null));
  refreshPowerTable = powerTable.refresh;
  const render = () => {
    clear(container);
    const usesHr = ["heart_rate", "both"].includes(meter.value);
    const usesPower = ["power", "both"].includes(meter.value);
    hrMax.required = usesHr;
    ftp.required = usesPower;
    if (usesHr) {
      container.append(
        h("h3", { text: "Hartslaggegevens" }),
        field("Maximale hartslag (bpm)", hrMax),
        h("p", { class: "hint", text: "Vijf hartslagzones met bovengrenzen op 60%, 70%, 80%, 90% en 100% van je maximale hartslag." }),
        hrTable.element);
    }
    if (usesPower) {
      container.append(
        h("h3", { text: "Vermogensgegevens" }),
        field("FTP / drempelvermogen (watt)", ftp),
        field("Aantal vermogenszones", powerCount),
        h("p", { class: "hint", text: "Standaardgrenzen volgen de FTP-percentages: 55%, 75%, 90%, 105%, (120% en 150% bij 7 zones)." }),
        powerTable.element,
        powerEditor.element);
    }
  };
  hrMax.addEventListener("input", hrTable.refresh);
  ftp.addEventListener("input", powerTable.refresh);
  powerCount.addEventListener("change", powerTable.refresh);
  meter.addEventListener("change", render);
  render();
  return {
    element: container,
    values: () => ({
      hr_max: hrMax.value ? Number(hrMax.value) : null,
      hr_zones: hrMax.value ? defaultHrZones(Number(hrMax.value)) : null,
      ftp: ftp.value ? Number(ftp.value) : null,
      power_zone_count: ["power", "both"].includes(meter.value) ? Number(powerCount.value) : null,
      power_zones: ["power", "both"].includes(meter.value) ? powerEditor.values() : null
    })
  };
}

// Een knop die tijdens het wachten uitgeschakeld is en een melding toont
function busyButton(button, message, statusEl) {
  button.disabled = true;
  const original = button.textContent;
  if (message && statusEl) statusEl.textContent = message;
  return () => { button.disabled = false; button.textContent = original; if (statusEl) statusEl.textContent = ""; };
}

// ---------- menu ----------
function renderNav(activePage = state.page) {
  clear(nav);
  clear(sidebarAccount);
  clear(coachLauncher);
  if (!state.user) {
    nav.append(
      h("button", { class: "nav-item", type: "button", text: "Inloggen", onclick: () => viewAuth("login") }),
      h("button", { class: "nav-item", type: "button", text: "Account maken", onclick: () => viewAuth("register") })
    );
    return;
  }
  const pages = [
    ["plan", "Plan", () => state.data?.plan ? viewPlan() : viewIntake()],
    ["coach", "Coach", viewCoach],
    ["analytics", "Analyse", () => viewAnalytics()],
    ["activities", "Activiteiten", viewActivities],
    ["connections", "Koppelingen", viewConnections],
    ["account", "Account", viewAccount]
  ];
  for (const [page, label, action] of pages) {
    const labelNode = page === "coach" && state.unreadCoach
      ? h("span", { class: "nav-label-with-badge" }, h("span", { text: label }), h("span", { class: "coach-unread-badge", "data-count": String(state.unreadCoach), "aria-label": `${state.unreadCoach} ongelezen coachbericht` }))
      : h("span", { text: label });
    nav.appendChild(h("button", {
      class: `nav-item${activePage === page ? " active" : ""}`,
      type: "button",
      "aria-current": activePage === page ? "page" : null,
      onclick: action
    }, labelNode));
  }
  sidebarAccount.append(
    h("span", { class: "sidebar-username", text: state.user }),
    h("button", {
      class: "nav-logout", type: "button", text: "Uitloggen",
      onclick: async () => {
        await api("POST", "/api/logout", {}).catch(() => {});
        state.user = null;
        state.data = null;
        viewAuth("login");
      }
    })
  );
  if (state.data?.plan) coachLauncher.appendChild(h("button", {
    class: "coach-launcher-button",
    type: "button",
    "aria-label": "Chat met je coach",
    onclick: viewCoach
  },
    h("span", { class: "launcher-avatar", "aria-hidden": "true", text: "W" }),
    h("span", { class: "launcher-copy" },
      h("strong", { text: "Je wielercoach" }),
      h("span", { text: "Stel een vraag" })),
    state.unreadCoach ? h("span", { class: "coach-unread-badge launcher-badge", "data-count": String(state.unreadCoach), "aria-label": `${state.unreadCoach} ongelezen coachbericht` }) : null,
    h("span", { class: "launcher-arrow", "aria-hidden": "true", text: "↗" })));
}

// ---------- inloggen en registreren ----------
function viewAuth(mode = "login") {
  renderNav();
  const error = h("p", { class: "error", role: "alert" });
  const username = h("input", { type: "text", name: "username", autocomplete: "username", required: true, minlength: 3, maxlength: 30, autocapitalize: "none" });
  const password = h("input", { type: "password", name: "password", autocomplete: mode === "login" ? "current-password" : "new-password", required: true, minlength: mode === "login" ? 1 : 10, maxlength: 200 });
  const consent = h("input", { type: "checkbox", name: "consent", required: mode === "register" });
  const submit = h("button", { class: "btn", type: "submit", text: mode === "login" ? "Inloggen" : "Account maken" });

  const form = h("form", {
    class: "card stack",
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = "";
      const done = busyButton(submit);
      try {
        const body = { username: username.value, password: password.value };
        if (mode === "register") body.consent = consent.checked;
        const res = await api("POST", mode === "login" ? "/api/login" : "/api/register", body);
        state.user = res.username;
        await start();
      } catch (e) {
        error.textContent = e.message;
        done();
      }
    }
  },
  h("h2", { text: mode === "login" ? "Inloggen" : "Account maken" }),
  field("Gebruikersnaam", username, mode === "register" ? "Geen e-mailadres nodig. Kies een naam om mee in te loggen." : null),
  field("Wachtwoord", password, mode === "register" ? "Minstens 10 tekens. Let op: wachtwoord vergeten kan nu nog niet hersteld worden." : null),
  mode === "register"
    ? h("div", { class: "stack" },
    h("label", { class: "check" }, consent, h("span", {}, "Ik heb de ", h("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "privacyverklaring"), " gelezen en ga akkoord met verwerking van mijn gegevens voor deze dienst, waaronder verwerking van trainingsgegevens door de AI-coach.")))
    : null,
  error,
  submit,
  h("p", { class: "muted" },
    mode === "login" ? "Nog geen account? " : "Heb je al een account? ",
    h("button", { class: "link", type: "button", text: mode === "login" ? "Maak er een" : "Log in", onclick: () => viewAuth(mode === "login" ? "register" : "login") }))
  );

  show(h("button", { class: "link home-back", type: "button", text: "← Terug naar startpagina", onclick: viewHome }), form);
}

function viewHome() {
  state.user = null;
  state.data = null;
  state.page = "home";
  renderNav();
  show(
    h("section", { class: "landing-hero" },
      h("p", { class: "eyebrow", text: "TRAIN MET EEN PLAN" }),
      h("h1", {}, "Jouw wielerdoel. ", h("span", { text: "Een plan dat bij jou past." })),
      h("p", { class: "landing-lede", text: "Maak een overzichtelijk trainingsschema, bespreek trainingen met je coach en stuur je plan bij naarmate je verder komt." }),
      h("div", { class: "row landing-actions" },
        h("button", { class: "btn", type: "button", text: "Maak mijn schema", onclick: () => viewAuth("register") }),
        h("button", { class: "btn ghost", type: "button", text: "Ik heb al een account", onclick: () => viewAuth("login") })),
      h("p", { class: "landing-note", text: "Voor beginnende en ervaren wielrenners, inclusief jeugdrenners van 12 tot 18 jaar." })),
    h("section", { class: "landing-grid", "aria-label": "Zo werkt WielerSchema" },
      h("article", { class: "landing-card" },
        h("span", { class: "landing-number", text: "01" }),
        h("h2", { text: "Vertel over je doel" }),
        h("p", { text: "Beantwoord een paar duidelijke stappen over je doel, beschikbare tijd en trainingservaring." })),
      h("article", { class: "landing-card" },
        h("span", { class: "landing-number", text: "02" }),
        h("h2", { text: "Krijg een plan op maat" }),
        h("p", { text: "De coach maakt een weekschema op basis van jouw informatie en beschikbare trainingsdagen. De intensiteit wordt weergegeven met je ingestelde hartslag- en/of vermogenszones." })),
      h("article", { class: "landing-card" },
        h("span", { class: "landing-number", text: "03" }),
        h("h2", { text: "Blijf bijsturen" }),
        h("p", { text: "Gebruik de chat om vragen te stellen en bekijk coachvoorstellen voordat je ze toepast." }))),
    h("section", { class: "landing-integrations" },
      h("h2", { text: "Koppelingen" }),
      h("p", { text: "Garmin- en Wahoo-koppelingen worden voorbereid. Automatische synchronisatie werkt pas zodra officiële API-toegang beschikbaar is." }))
  );
}

// ---------- intake ----------
function viewIntake(prefill) {
  state.page = "plan";
  renderNav("plan");
  const p = prefill || {};
  const savedProfile = state.profile || {};
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });

  const doel = h("input", { type: "text", name: "goal", maxlength: 200, required: true, placeholder: "Bijvoorbeeld: mijn eerste wedstrijd rijden", value: p.doel || "" });
  const birthDate = birthDateInput(savedProfile.birth_date || "");
  const datum = h("input", { type: "date", min: addDays(todayIso(), 7), value: p.datum || "" });
  const niveau = h("select", { required: true }, ...[["beginner", "Beginner"], ["gevorderd", "Gevorderd"], ["ervaren", "Ervaren"], ["wedstrijd", "Wedstrijdrenner"]]
    .map(([v, t]) => h("option", { value: v, selected: (p.niveau || "gevorderd") === v, text: t })));
  const uren = h("input", { type: "number", min: 2, max: 25, step: 0.5, required: true, value: p.uren_per_week ?? 6 });
  const defaultMeter = savedProfile.meter || p.meter || "";
  const meter = h("select", { required: true }, [
    ["", "Maak een keuze"],
    ["power", "Vermogensmeter"],
    ["heart_rate", "Hartslagmeter"],
    ["both", "Beide"],
    ["none", "Geen van beide"]
  ].map(([value, label]) => h("option", { value, selected: defaultMeter === value, text: label })));
  const equipment = measurementSettings(savedProfile, meter);
  const dagenChecks = DAGEN_KORT.map((naam, i) => ({
    i, box: h("input", { type: "checkbox", checked: (p.dagen || [1, 3, 5, 6]).includes(i) }), naam
  }));
  const jaren = h("input", { type: "number", min: 0, max: 60, placeholder: "Optioneel", value: p.ervaring_jaren ?? "" });
  const beperkingen = h("textarea", { rows: 2, maxlength: 300, placeholder: "Optioneel, bijvoorbeeld een oude blessure. Vul alleen in wat je kwijt wilt." }, p.beperkingen || "");
  const opmerkingen = h("textarea", { rows: 2, maxlength: 400, placeholder: "Optioneel, bijvoorbeeld: ik werk onregelmatig of train vooral buiten." }, p.opmerkingen || "");
  const stepNames = ["Doel", "Tijd", "Training"];
  let currentStep = 0;
  const progressItems = stepNames.map((name, index) => h("li", {
    class: `wizard-progress-item${index === 0 ? " active" : ""}`,
    "aria-current": index === 0 ? "step" : null
  }, h("span", { class: "wizard-progress-number", text: String(index + 1) }), h("span", { text: name })));
  const progress = h("ol", { class: "wizard-progress", "aria-label": "Voortgang nieuw schema" }, ...progressItems);
  const submit = h("button", { class: "btn", type: "submit", text: "Verder naar vragen van de coach" });
  const back = h("button", { class: "btn ghost", type: "button", text: "Vorige stap", hidden: true });
  const next = h("button", { class: "btn", type: "button", text: "Volgende" });
  const panels = [
    h("section", { class: "wizard-panel stack" },
      h("h2", { text: "1. Jouw doel" }),
      h("p", { class: "muted", text: "Vertel waar je naartoe wilt werken en op welk niveau je fietst." }),
      field("Wat wil je bereiken?", doel),
      field("Geboortedatum (DD-MM-JJJJ)", birthDate, "Je leeftijd helpt de coach het schema af te stemmen. Alleen je leeftijd, niet je geboortedatum, wordt met de AI gedeeld."),
      field("Heb je een datum voor je doel?", datum, "Optioneel. Zonder datum maakt de coach een schema van ongeveer 8 weken."),
      field("Hoe zou je je niveau omschrijven?", niveau)),
    h("section", { class: "wizard-panel stack", hidden: true },
      h("h2", { text: "2. Jouw tijd" }),
      h("p", { class: "muted", text: "Kies alleen dagen en uren die echt in je week passen. Rust hoort ook bij trainen." }),
      field("Hoeveel uur per week kun je meestal trainen?", uren, "Dit is een bovengrens, geen doel dat je moet halen."),
      h("fieldset", { class: "days" }, h("legend", { text: "Op welke dagen kun je meestal trainen? (minimaal 2)" }),
        ...dagenChecks.map(d => h("label", { class: "daybox" }, d.box, h("span", { text: d.naam }))))),
    h("section", { class: "wizard-panel stack", hidden: true },
      h("h2", { text: "3. Jouw training" }),
      h("p", { class: "muted", text: "Meetapparatuur en trainingservaring helpen de coach, maar je kunt het later altijd aanpassen." }),
      field("Welke meetapparatuur gebruik je?", meter),
      equipment.element,
      field("Jaren ervaring", jaren, "Optioneel."),
      field("Zijn er beperkingen waar de coach rekening mee moet houden?", beperkingen, "Optioneel. Deel alleen wat nodig is; dit is geen medische beoordeling."),
      field("Nog iets dat helpt om je schema te maken?", opmerkingen, "Optioneel."))
  ];

  function renderStep(index) {
    currentStep = index;
    panels.forEach((panel, i) => { panel.hidden = i !== index; });
    progressItems.forEach((item, i) => {
      item.className = `wizard-progress-item${i === index ? " active" : i < index ? " complete" : ""}`;
      if (i === index) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    back.hidden = index === 0;
    next.hidden = index === panels.length - 1;
    submit.hidden = index !== panels.length - 1;
    error.textContent = "";
    window.scrollTo(0, 0);
  }

  function collect() {
    return {
      doel: doel.value, datum: datum.value || null, niveau: niveau.value, uren_per_week: Number(uren.value),
      dagen: dagenChecks.filter(d => d.box.checked).map(d => d.i),
      meter: meter.value,
      geboortedatum: parseDutchDate(birthDate.value),
      ...equipment.values(),
      ervaring_jaren: jaren.value ? Number(jaren.value) : null,
      beperkingen: beperkingen.value, opmerkingen: opmerkingen.value
    };
  }

  function validateStep(index) {
    if (index === 0) {
      if (!doel.value.trim() || doel.value.trim().length < 3) {
        error.textContent = "Beschrijf je doel in minimaal 3 tekens.";
        doel.focus();
        return false;
      }
      const isoBirthDate = parseDutchDate(birthDate.value);
      if (!isoBirthDate || isoBirthDate >= todayIso()) {
        error.textContent = "Vul je geldige geboortedatum in.";
        birthDate.focus();
        return false;
      }
      if (!niveau.value) {
        error.textContent = "Kies je niveau.";
        niveau.focus();
        return false;
      }
    }
    if (index === 1) {
      const hours = Number(uren.value);
      if (!Number.isFinite(hours) || hours < 2 || hours > 25) {
        error.textContent = "Vul 2 tot en met 25 uur per week in.";
        uren.focus();
        return false;
      }
      if (dagenChecks.filter(day => day.box.checked).length < 2) {
        error.textContent = "Kies minstens twee dagen waarop je kunt trainen.";
        return false;
      }
    }
    if (index === 2) {
      if (!meter.value) {
        error.textContent = "Kies een optie bij meetapparatuur. Geen meetapparatuur is ook een optie.";
        meter.focus();
        return false;
      }
      if (["heart_rate", "both"].includes(meter.value) && !equipment.values().hr_max) {
        error.textContent = "Vul je maximale hartslag in.";
        return false;
      }
      if (["power", "both"].includes(meter.value) && !equipment.values().ftp) {
        error.textContent = "Vul je FTP (drempelvermogen) in.";
        return false;
      }
    }
    error.textContent = "";
    return true;
  }

  back.addEventListener("click", () => renderStep(Math.max(0, currentStep - 1)));
  next.addEventListener("click", () => {
    if (validateStep(currentStep)) renderStep(Math.min(panels.length - 1, currentStep + 1));
  });

  const form = h("form", {
    class: "card stack wizard",
    novalidate: true,
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = "";
      for (let index = 0; index < panels.length; index++) {
        if (!validateStep(index)) { renderStep(index); return; }
      }
      const intake = collect();
      const done = busyButton(submit, "", status);
      setCoachWaiting(status, "De coach bekijkt je gegevens…");
      const startedAt = Date.now();
      try {
        const res = await api("POST", "/api/intake/questions", { intake });
        const remaining = 3000 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        if (res.vragen.length === 0) await createPlan(intake, [], error, status);
        else viewQuestions(intake, res.vragen);
      } catch (e) { error.textContent = e.message; clear(status); done(); }
    }
  },
  progress,
  ...panels,
  error, status,
  h("div", { class: "row wizard-actions" }, back, next, submit)
  );

  show(h("h1", { text: "Nieuw schema" }), h("p", { class: "muted wizard-intro", text: "We doen dit stap voor stap. Je hoeft niet alles al precies te weten." }), form);
  renderStep(0);
}

function viewActivities() {
  state.page = "activities";
  renderNav("activities");
  const file = h("input", { type: "file", accept: ".fit,application/octet-stream", id: "fit-upload" });
  const activityName = h("input", { type: "text", name: "activity_name", maxlength: 100, placeholder: "Bijv. rustige duurtraining" });
  const status = h("p", { class: "integration-status", role: "status" });
  const list = h("div", { class: "activity-list stack" });
  const uploadFit = async event => {
    event.preventDefault();
    const selected = file.files && file.files[0];
    if (!selected) { status.textContent = "Kies eerst een FIT-bestand."; return; }
    status.textContent = "FIT-bestand verwerken…";
    try {
      const startedAt = Date.now();
      const body = new FormData();
      body.append("file", selected, selected.name);
      body.append("name", activityName.value.trim());
      const response = await fetch("/api/activities/import", { method: "POST", credentials: "same-origin", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Het FIT-bestand kon niet worden geïmporteerd.");
      file.value = "";
      status.textContent = data.coach_feedback ? "De coach bekijkt je rit…" : "Activiteit geïmporteerd.";
      if (data.coach_feedback) await new Promise(resolve => setTimeout(resolve, Math.max(0, 10000 - (Date.now() - startedAt))));
      status.textContent = data.coach_feedback || "Activiteit geïmporteerd.";
      state.unreadCoach += data.coach_feedback ? 1 : 0;
      renderNav("activities");
      await loadActivities();
    } catch (error) { status.textContent = error.message; }
  };
  const renderActivities = activities => {
    clear(list);
    if (!activities.length) {
      list.appendChild(h("p", { class: "muted", text: "Nog geen activiteiten geïmporteerd." }));
      return;
    }
    for (const activity of activities) {
      const duration = Number(activity.elapsed_time);
      const distance = Number(activity.distance);
      const charts = [
        ["heartrate", "Hartslag", "bpm", "#b6534a"],
        ["power", "Vermogen", "W", "#587d3e"],
        ["speed", "Snelheid", "km/u", "#3f7194"],
        ["altitude", "Hoogte", "m", "#8a6b3f"]
      ].flatMap(([key, label, unit, color]) => {
        const values = (activity.samples || []).map(sample => Number(sample[key])).filter(Number.isFinite);
        if (values.length < 2 || Math.max(...values) - Math.min(...values) < 0.0001) return [];
        const canvas = h("canvas", { class: "activity-chart", width: 720, height: 180, "aria-label": `${label}grafiek van je activiteit` });
        setTimeout(() => drawActivityChart(canvas, activity.samples, key, label, unit, color), 0);
        return [h("div", { class: "activity-chart-block" }, h("h3", { text: label }), canvas)];
      });
      const routePoints = (activity.samples || []).filter(sample =>
        Number.isFinite(Number(sample.latitude)) && Number.isFinite(Number(sample.longitude)));
      const routeMap = routePoints.length > 1
        ? h("div", { class: "activity-chart-block" },
          h("h3", { text: "Jouw route" }),
          h("div", { class: "activity-map", "aria-label": "Kaart van je fietsroute" }))
        : null;
      if (routeMap) setTimeout(() => drawRouteMap(routeMap.children[1], routePoints), 0);
      const detailMetrics = [
          activity.average_heartrate ? `gem. ${Math.round(activity.average_heartrate)} bpm` : "",
          activity.max_heartrate ? `max ${Math.round(activity.max_heartrate)} bpm` : "",
          activity.average_watts ? `gem. ${Math.round(activity.average_watts)} W` : "",
          activity.max_watts ? `max ${Math.round(activity.max_watts)} W` : "",
          activity.total_elevation_gain ? `${Math.round(activity.total_elevation_gain)} m klimmen` : "",
          activity.average_speed ? `${(Number(activity.average_speed) * 3.6).toFixed(1)} km/u gemiddeld` : "",
          activity.max_speed ? `max ${(Number(activity.max_speed) * 3.6).toFixed(1)} km/u` : ""
        ].filter(Boolean).join(" · ");
      const details = h("div", { class: "activity-details stack" },
        detailMetrics ? h("p", { class: "muted", text: detailMetrics }) : null,
        routeMap,
        charts.length ? charts : h("p", { class: "hint", text: "Geen detailmetingen beschikbaar in dit bestand." })
      );
      let detailsOpen = false;
      const toggleDetails = h("button", { class: "btn ghost small activity-toggle", type: "button", "aria-expanded": "false", text: "Bekijk details", onclick: () => {
        detailsOpen = !detailsOpen;
        details.hidden = !detailsOpen;
        if (detailsOpen) details.removeAttribute("hidden");
        else details.setAttribute("hidden", "");
        toggleDetails.setAttribute("aria-expanded", String(detailsOpen));
        toggleDetails.textContent = detailsOpen ? "Verberg details" : "Bekijk details";
      }});
      details.setAttribute("hidden", "");
      const nameHeading = h("h2", { text: activity.name || "Training" });
      const heading = h("div", { class: "activity-item-heading" },
        h("div", { class: "activity-title-main" }, nameHeading),
        h("time", { class: "muted", datetime: activity.start_date_local || activity.date, text: activityDateLabel(activity.start_date_local || activity.date) }));
      const editName = h("input", { class: "activity-name-input", type: "text", maxlength: 100, value: activity.name || "Training", hidden: true });
      let savedName = activity.name || "Training";
      const finishNameEdit = async () => {
        const name = editName.value.trim().slice(0, 100);
        if (!name || name === savedName) {
          editName.hidden = true;
          nameHeading.hidden = false;
          return;
        }
        try {
          await api("PATCH", `/api/activities/${encodeURIComponent(activity.id)}`, { name });
          savedName = name;
          status.textContent = "Naam opgeslagen.";
          editName.hidden = true;
          nameHeading.hidden = false;
          await loadActivities();
        } catch (error) { status.textContent = error.message; }
      };
      editName.addEventListener("blur", finishNameEdit);
      editName.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); editName.blur(); }
        if (event.key === "Escape") { editName.value = savedName; editName.blur(); }
      });
      const editNameButton = h("button", { class: "activity-edit", type: "button", text: "✎", "aria-label": `Wijzig naam van ${activity.name || "deze activiteit"}`, title: "Naam wijzigen", onclick: () => {
        nameHeading.hidden = true;
        editName.hidden = false;
        editName.focus();
        editName.select();
      }});
      const deleteButton = h("button", { class: "btn ghost small danger-button", type: "button", text: "Verwijderen", onclick: async () => {
        if (!window.confirm("Deze activiteit verwijderen?")) return;
        try {
          await api("DELETE", `/api/activities/${encodeURIComponent(activity.id)}`);
          status.textContent = "Activiteit verwijderd.";
          await loadActivities();
        } catch (error) { status.textContent = error.message; }
      }});
      deleteButton.textContent = "🗑";
      deleteButton.setAttribute("aria-label", `Verwijder ${activity.name || "deze activiteit"}`);
      deleteButton.setAttribute("title", "Activiteit verwijderen");
      deleteButton.className = "activity-delete";
      heading.children[0].append(editNameButton, deleteButton);
      const summaryMetrics = [
        Number.isFinite(duration) && duration > 0 ? minutesText(Math.round(duration / 60)) : "",
        Number.isFinite(distance) && distance > 0 ? `${(distance / 1000).toFixed(1)} km` : "",
        activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm gemiddeld` : "",
        activity.average_watts ? `${Math.round(activity.average_watts)} W gemiddeld` : ""
      ].filter(Boolean);
      const metric = (label, value) => value ? h("div", { class: "activity-metric" }, h("span", { text: label }), h("strong", { text: value })) : null;
      list.appendChild(h("article", { class: "card activity-item" },
        heading,
        h("div", { class: "activity-metrics", "aria-label": "Kerngegevens" },
          metric("Tijd", summaryMetrics.find(value => value.includes("min") || value.includes(" u "))),
          metric("Afstand", summaryMetrics.find(value => value.endsWith(" km")))),
        editName,
        toggleDetails, details
      ));
    }
  };
  function drawActivityChart(canvas, samples, key, label, unit, color) {
    const context = canvas.getContext("2d");
    if (!context || !samples.length) return;
    const width = canvas.width;
    const height = canvas.height;
    const values = samples.map(sample => Number(sample[key])).filter(Number.isFinite);
    if (!values.length) return;
    const min = Math.max(0, Math.min(...values) - 5);
    const max = Math.max(min + 10, Math.max(...values) + 5);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#eef4eb";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.beginPath();
    samples.forEach((sample, index) => {
      const value = Number(sample[key]);
      if (!Number.isFinite(value)) return;
      const x = index / Math.max(1, samples.length - 1) * width;
      const y = height - (value - min) / (max - min) * (height - 20) - 10;
      index ? context.lineTo(x, y) : context.moveTo(x, y);
    });
    context.stroke();
    context.fillStyle = "#65736a";
    context.font = "12px system-ui";
    const format = value => key === "speed" ? `${(value * 3.6).toFixed(1)} ${unit}` : `${Math.round(value)} ${unit}`;
    context.fillText(`${label}: ${format(max)}`, 8, 16);
    context.fillText(format(min), 8, height - 4);
  }
  function drawRouteMap(canvas, points) {
    const width = 720, height = 360, tileSize = 256;
    const project = (latitude, longitude, zoom) => {
      const scale = 2 ** zoom;
      const x = (longitude + 180) / 360 * scale * tileSize;
      const sine = Math.sin(latitude * Math.PI / 180);
      const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale * tileSize;
      return { x, y };
    };
    let zoom = 16;
    while (zoom > 10) {
      const projected = points.map(point => project(Number(point.latitude), Number(point.longitude), zoom));
      const rangeX = Math.max(...projected.map(point => point.x)) - Math.min(...projected.map(point => point.x));
      const rangeY = Math.max(...projected.map(point => point.y)) - Math.min(...projected.map(point => point.y));
      if (rangeX < width * .8 && rangeY < height * .8) break;
      zoom--;
    }
    const projected = points.map(point => project(Number(point.latitude), Number(point.longitude), zoom));
    const centerX = (Math.min(...projected.map(point => point.x)) + Math.max(...projected.map(point => point.x))) / 2;
    const centerY = (Math.min(...projected.map(point => point.y)) + Math.max(...projected.map(point => point.y))) / 2;
    clear(canvas);
    const left = Math.floor((centerX - width / 2) / tileSize);
    const top = Math.floor((centerY - height / 2) / tileSize);
    for (let tileX = left; tileX <= left + 3; tileX++) {
      for (let tileY = top; tileY <= top + 2; tileY++) {
        const image = h("img", { class: "activity-map-tile", src: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`, alt: "", draggable: false });
        image.style.left = `${tileX * tileSize - (centerX - width / 2)}px`;
        image.style.top = `${tileY * tileSize - (centerY - height / 2)}px`;
        canvas.appendChild(image);
      }
    }
    const route = h("canvas", { width, height, class: "activity-map-route", "aria-hidden": "true" });
    canvas.appendChild(route);
    const context = route.getContext("2d");
    if (!context) return;
    const position = point => ({ x: point.x - (centerX - width / 2), y: point.y - (centerY - height / 2) });
    context.strokeStyle = "#ffffff";
    context.lineWidth = 8;
    context.lineJoin = "round";
    context.beginPath();
    projected.forEach((point, index) => { const p = position(point); index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y); });
    context.stroke();
    context.strokeStyle = "#d84b3e";
    context.lineWidth = 4;
    context.stroke();
    for (const [point, color] of [[projected[0], "#287a45"], [projected.at(-1), "#d84b3e"]]) {
      const p = position(point);
      context.fillStyle = color;
      context.beginPath(); context.arc(p.x, p.y, 7, 0, Math.PI * 2); context.fill();
    }
    canvas.appendChild(h("a", { class: "activity-map-attribution", href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noreferrer", text: "Kaartgegevens © OpenStreetMap" }));
  }
  const loadActivities = async () => {
    try { renderActivities((await api("GET", "/api/activities")).activities || []); }
    catch (error) { status.textContent = error.message; }
  };
  const importForm = h("form", { class: "card stack fit-upload-card", onsubmit: uploadFit },
    h("h2", { text: "FIT-bestand importeren" }),
    h("p", { class: "muted", text: "Upload een training uit je fietscomputer of sportapp. Het bestand blijft aan jouw account gekoppeld." }),
    field("Naam van de training (optioneel)", activityName, "Laat leeg om de bestandsnaam te gebruiken."),
    field("FIT-bestand", file, "Maximaal 10 MB."), status,
    h("button", { class: "btn", type: "submit", text: "Activiteit importeren" }));
  renderActivities([]);
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "JOUW TRAININGEN" }),
      h("h1", { text: "Activiteiten" }),
      h("p", { class: "muted", text: "Importeer trainingen rechtstreeks uit een FIT-bestand of gebruik een automatische koppeling." })),
    importForm,
    h("section", { class: "stack" }, h("h2", { text: "Recente activiteiten" }), list)
  );
  loadActivities();
}

function viewConnections() {
  state.page = "connections";
  renderNav("connections");
  const status = h("p", { class: "integration-status", role: "status", text: "Status laden…" });
  const connect = h("button", { class: "btn", type: "button", text: "Koppel Intervals.icu" });
  const sync = h("button", { class: "btn ghost", type: "button", text: "Gegevens nu ophalen", hidden: true });
  const disconnect = h("button", { class: "btn ghost", type: "button", text: "Koppeling verbreken", hidden: true });
  const details = h("p", { class: "hint" });
  const refresh = async () => {
    try {
      const data = await api("GET", "/api/intervals/status");
      if (!data.configured) {
        status.textContent = "Intervals.icu is nog niet geconfigureerd.";
        details.textContent = "De beheerder moet eerst OAuth-instellingen toevoegen.";
        connect.disabled = true;
        return;
      }
      if (!data.connected) {
        status.textContent = "Nog niet gekoppeld.";
        details.textContent = "Koppel je account om activiteiten en herstel- en slaapgegevens te gebruiken.";
        connect.hidden = false; sync.hidden = true; disconnect.hidden = true;
        return;
      }
      status.textContent = `Verbonden met ${data.athlete_name || "Intervals.icu"}.`;
      details.textContent = `${data.activities} activiteiten en ${data.wellness} herstel-/slaapmetingen opgeslagen.`;
      connect.hidden = true; sync.hidden = false; disconnect.hidden = false;
    } catch (e) { status.textContent = e.message; }
  };
  connect.onclick = () => { window.location.href = "/api/intervals/connect"; };
  sync.onclick = async () => {
    sync.disabled = true; status.textContent = "Gegevens ophalen…";
    try { await api("POST", "/api/intervals/sync", {}); await refresh(); }
    catch (e) { status.textContent = e.message; sync.disabled = false; }
  };
  disconnect.onclick = async () => {
    disconnect.disabled = true;
    try { await api("POST", "/api/intervals/disconnect", {}); await refresh(); }
    catch (e) { status.textContent = e.message; disconnect.disabled = false; }
  };
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "ACTIVITEITEN AUTOMATISEREN" }),
      h("h1", { text: "Koppelingen" }),
      h("p", { class: "muted", text: "Bekijk hier de status van koppelingen voor het automatisch ophalen van je trainingen." })),
    h("section", { class: "card garmin-card stack" },
      h("div", { class: "garmin-heading" },
        h("span", { class: "garmin-mark", "aria-hidden": "true" }, "G"),
        h("div", {},
          h("p", { class: "eyebrow", text: "GARMIN CONNECT" }),
          h("h2", { text: "Automatische synchronisatie" }))),
      h("p", { text: "Zodra Garmin de benodigde API-toegang verleent, kan WielerSchema je activiteiten en beschikbare trainings- en herstelgegevens automatisch ophalen." }),
      h("ul", { class: "garmin-points" },
        h("li", { text: "Recente activiteiten in je Activiteiten-tab." }),
        h("li", { text: "Trainingscontext voor reflectie in de AI-coach." }),
        h("li", { text: "Alleen gegevens die nodig zijn en waarvoor jij toestemming geeft." })),
      h("p", { class: "integration-status" },
        h("span", { class: "status-dot", "aria-hidden": "true" }),
        "Koppeling nog niet actief — wacht op Garmin API-toegang."),
      h("button", { class: "btn", type: "button", disabled: true, text: "Garmin binnenkort koppelen" }),
      h("p", { class: "hint", text: "Er wordt nog geen Garmin-login gevraagd en er worden geen gegevens gesynchroniseerd." })),
    h("section", { class: "card garmin-card stack" },
      h("div", { class: "garmin-heading" },
        h("span", { class: "wahoo-mark", "aria-hidden": "true", text: "I" }),
        h("div", {}, h("p", { class: "eyebrow", text: "INTERVALS.ICU" }), h("h2", { text: "Activiteiten en herstel" }))),
      h("p", { text: "Haal je recente ritten en herstelgegevens op. De coach kan slaap, HRV en rusthartslag als trainingscontext gebruiken." }),
      status, details, h("div", { class: "row" }, connect, sync, disconnect))
    , h("section", { class: "card garmin-card stack" },
      h("div", { class: "garmin-heading" },
        h("span", { class: "wahoo-mark", "aria-hidden": "true", text: "W" }),
        h("div", {},
          h("p", { class: "eyebrow", text: "WAHOO" }),
          h("h2", { text: "Automatische synchronisatie" }))),
      h("p", { text: "Zodra Wahoo de benodigde API-toegang verleent, kan WielerSchema je activiteiten automatisch ophalen en als context voor je trainingsschema gebruiken." }),
      h("p", { class: "integration-status" },
        h("span", { class: "status-dot", "aria-hidden": "true" }),
        "Koppeling nog niet actief — wacht op officiële Wahoo API-toegang."),
      h("button", { class: "btn", type: "button", disabled: true, text: "Wahoo binnenkort koppelen" }),
      h("p", { class: "hint", text: "Er wordt nog geen Wahoo-login gevraagd en er worden geen gegevens gesynchroniseerd." }))
  );
  refresh();
}

function viewQuestions(intake, vragen) {
  state.page = "plan";
  renderNav("plan");
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });
  const messages = [];
  let index = 0;
  let waiting = false;
  const render = () => {
    const answer = h("textarea", { rows: 2, maxlength: 300, placeholder: "Typ je antwoord…" });
    const last = index >= vragen.length - 1;
    const submit = h("button", { class: "btn", type: "submit", text: last ? "Maak mijn schema" : "Verstuur antwoord" });
    const chat = h("div", { class: "chat", "aria-live": "polite" },
      ...messages.map(message => h("div", { class: `chat-message ${message.role}` },
        h("span", { class: "chat-label", text: message.role === "coach" ? "Coach" : "Jij" }),
        h("p", { class: "chat-bubble", text: message.text }))),
      index < vragen.length && !waiting ? h("div", { class: "chat-message coach" },
        h("span", { class: "chat-label", text: "Coach" }),
        h("p", { class: "chat-bubble", text: vragen[index].vraag })) : null,
      waiting ? h("div", { class: "chat-message coach", role: "status" },
        h("span", { class: "chat-label", text: "Coach" }),
        h("div", { class: "chat-bubble coach-thinking" }, coachWheel(), h("span", { text: "De coach denkt mee…" }))) : null
    );
    const form = h("form", {
      class: "card stack",
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        messages.push(
          { role: "coach", text: vragen[index].vraag },
          { role: "user", text: answer.value.trim() || "Vraag overgeslagen." }
        );
        const answers = messages.filter(message => message.role === "user").map((message, answerIndex) => ({
          vraag: vragen[answerIndex].vraag, antwoord: message.text === "Vraag overgeslagen." ? "" : message.text
        })).filter(item => item.antwoord);
        if (!last) {
          waiting = true;
          submit.disabled = true;
          render();
          await new Promise(resolve => setTimeout(resolve, 3000));
          index++;
          waiting = false;
          render();
          return;
        }
        submit.disabled = true;
        try { await createPlan(intake, answers, error, status); }
        catch (e) { messages.splice(-2); error.textContent = e.message; submit.disabled = false; }
      }
    },
    h("h2", { text: "Vragen van de coach" }),
    h("p", { class: "muted", text: "Beantwoord de vragen één voor één. Je mag een vraag overslaan." }),
    chat,
    index < vragen.length ? field("Jouw antwoord", answer) : null,
    error, status,
    h("div", { class: "row" },
      submit,
      h("button", { class: "btn ghost", type: "button", text: "Terug", onclick: () => viewIntake(intake) }))
    );
    show(h("h1", { text: "Nieuw schema" }), form);
  };
  render();
}

async function createPlan(intake, answers, errorEl, statusEl) {
  setCoachWaiting(statusEl, "De coach maakt je schema. Dit duurt ongeveer een halve minuut…");
  const data = await api("POST", "/api/plan/create", { intake, answers });
  state.data = data;
  state.week = data.weeks[data.weeks.length - 1].week_no;
  viewPlan();
}

// ---------- schema ----------
function icsEscape(text) { return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function downloadIcs(plan, week) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WielerSchema//NL", "CALSCALE:GREGORIAN"];
  for (const dag of week.dagen) {
    if (dag.type === "rust") continue;
    const date = addDays(plan.start_date, (week.week_no - 1) * 7 + dag.dag);
    const compact = (s) => s.replace(/-/g, "");
    const desc = `${TYPE_LABEL[dag.type] || dag.type}, ${minutesText(dag.minuten)}${dag.zone ? ", " + dag.zone : ""}. ${dag.beschrijving}`;
    lines.push("BEGIN:VEVENT", `UID:wielerschema-${compact(date)}-${week.week_no}-${dag.dag}@wielerschema`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      `SUMMARY:${icsEscape("Fietstraining: " + dag.titel)}`, `DESCRIPTION:${icsEscape(desc)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `wielerschema-week-${week.week_no}.ics` });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, y);
      y += lineHeight;
      lines++;
      if (lines >= maxLines) return;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line && lines < maxLines) context.fillText(line, x, y);
}

function workoutZoneBlocks(workout, intake) {
  const zone = Number((workout.zone || "").slice(1));
  const hasIntervalStructure = ["drempel", "vo2max", "sprint"].includes(workout.type) ||
    /interval|\b\d+\s*[x×]\s*\d+/i.test(`${workout.titel || ""} ${workout.beschrijving || ""}`);
  const supplied = workout.blokken;
  if (hasIntervalStructure && Array.isArray(supplied) && supplied.length &&
      supplied.reduce((total, block) => total + block.minuten, 0) === workout.minuten) return supplied;
  if (!zone) return [{ minuten: workout.minuten, zone: "", label: "Zone niet opgegeven" }];
  return [{ minuten: workout.minuten, zone: workout.zone, label: "Gelijkmatig" }];
}

function maxVisibleZone(intake, blocks) {
  const highestZone = Math.max(0, ...blocks.map(block => Number((block.zone || "").slice(1))));
  return ["power", "both"].includes(intake.meter) &&
    (intake.meter === "power" || highestZone > 5)
    ? (intake.power_zone_count === 5 ? 5 : 7) : 5;
}

function drawWeekImage(plan, week) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1240;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Je browser kan de afbeelding niet maken.");

  const margin = 52;
  const gap = 18;
  const cardWidth = (canvas.width - margin * 2 - gap) / 2;
  const cardHeight = 218;
  const headerBottom = 220;
  const colors = { ink: "#202b25", muted: "#65736a", line: "#e2e8e2", green: "#587d3e", pale: "#f5f7f5", white: "#ffffff" };
  context.fillStyle = colors.pale;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = colors.green;
  context.font = "700 24px system-ui, sans-serif";
  context.fillText("WIELERSCHEMA", margin, 56);
  context.fillStyle = colors.ink;
  context.font = "700 42px system-ui, sans-serif";
  context.fillText(`Trainingsschema · week ${week.week_no}`, margin, 112);
  context.fillStyle = colors.muted;
  context.font = "20px system-ui, sans-serif";
  drawWrappedText(context, plan.intake.doel || "Jouw trainingsweek", margin, 151, canvas.width - margin * 2, 23, 2);
  context.fillText(`Totaal ${minutesText(week.totaal_minuten)}`, margin, 203);

  week.dagen.forEach((day, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + col * (cardWidth + gap);
    const y = headerBottom + row * (cardHeight + gap);
    const date = addDays(plan.start_date, (week.week_no - 1) * 7 + day.dag);
    context.fillStyle = colors.white;
    context.strokeStyle = colors.line;
    context.lineWidth = 2;
    context.beginPath();
    if (context.roundRect) context.roundRect(x, y, cardWidth, cardHeight, 18);
    else context.rect(x, y, cardWidth, cardHeight);
    context.fill();
    context.stroke();
    context.fillStyle = colors.green;
    context.font = "700 20px system-ui, sans-serif";
    context.fillText(`${DAGEN_KORT[day.dag]} · ${dateLabel(date)}`, x + 20, y + 34);
    context.fillStyle = colors.ink;
    context.font = "700 26px system-ui, sans-serif";
    drawWrappedText(context, day.type === "rust" ? "Rustdag" : day.titel || TYPE_LABEL[day.type] || day.type,
      x + 20, y + 72, cardWidth - 40, 31, 2);
    context.fillStyle = colors.muted;
    context.font = "20px system-ui, sans-serif";
    const descriptionY = y + 126;
    context.fillText(day.type === "rust" ? "Rust" :
      `${TYPE_LABEL[day.type] || day.type} · ${minutesText(day.minuten)}${day.zone ? ` · ${day.zone}` : ""}`,
      x + 20, descriptionY);
    drawWrappedText(context, day.beschrijving, x + 20, descriptionY + 30, cardWidth - 40, 23, 2);

    if (day.type !== "rust") {
      const blocks = workoutZoneBlocks(day, plan.intake);
      const barX = x + 20;
      const barY = y + cardHeight - 24;
      const barWidth = cardWidth - 40;
      let offset = 0;
      for (const block of blocks) {
        const width = barWidth * block.minuten / day.minuten;
        const level = Number((block.zone || "").slice(1));
        context.fillStyle = level ? ["#8da981", "#587d3e", "#315f35", "#224c2b", "#173b22", "#102e1a", "#0a2413"][level - 1] : "#87949a";
        context.fillRect(barX + offset, barY, width, 10);
        offset += width;
      }
    }
  });
  context.fillStyle = colors.muted;
  context.font = "16px system-ui, sans-serif";
  context.fillText("Gemaakt met WielerSchema", margin, canvas.height - 18);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("De schema-afbeelding kon niet worden gemaakt.")), "image/png");
  });
}

async function shareWeekAsImage(plan, week, status) {
  status.textContent = "Schema-afbeelding maken…";
  const blob = await drawWeekImage(plan, week);
  const filename = `wielerschema-week-${week.week_no}.png`;
  if (navigator.share && typeof File === "function") {
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `WielerSchema · week ${week.week_no}` });
      status.textContent = "Schema gedeeld.";
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL?.(url), 1000);
  status.textContent = "Afbeelding gedownload.";
}

function trainingPeaksPrompt(plan, dag) {
  const meter = plan.intake.meter;
  const intensity = meter === "heart_rate" ? "Heart Rate (gebruik mijn ingestelde hartslagzones)"
    : meter === "both" ? "Gebruik de zones die per trainingsblok zijn genoemd; verzin geen extra doelen"
      : meter === "power" && plan.intake.ftp ? `Vermogen volgens mijn FTP van ${plan.intake.ftp} W en ingestelde zones`
        : "Geen vermogens- of hartslagdoel; volg duur en trainingsbeschrijving";
  const zoneTarget = meter === "power" ? "mijn ingestelde vermogenszones"
    : ["heart_rate", "both"].includes(meter) ? "mijn ingestelde hartslagzones"
      : "de genoemde trainingszone";
  const description = cleanWorkoutDescription(dag.beschrijving);
  const target = dag.zone ? `${dag.zone} volgens ${zoneTarget}${description ? `; ${description}` : ""}` : description;
  const blocks = Array.isArray(dag.blokken) && dag.blokken.length
    ? `\nTrainingsblokken:\n${dag.blokken.map(block =>
      `- ${block.minuten} min${block.zone ? ` ${block.zone}` : ""}${block.label ? `: ${block.label}` : ""}`).join("\n")}`
    : "";
  return [
    "Maak hiervan een gestructureerde wielertraining in TrainingPeaks.",
    "Sport Type: Bike",
    `Intensity: ${intensity}`,
    "Build Intervals By: Duration",
    "Maak alleen blokken die hieronder zijn opgegeven; verzin geen intervalstructuur.",
    `Duration: ${dag.minuten} minuten`,
    `Target: ${target || "Volg de trainingsbeschrijving en houd het tempo beheerst."}`,
    `Training: ${dag.titel}. ${description}${blocks}`,
    "Behoud exact de totale duur, zones en opgegeven blokken. Verzin geen FTP, wattages, hartslagwaarden of intervallen."
  ].join("\n");
}

function dayCard(plan, week, dag) {
  const date = addDays(plan.start_date, (week.week_no - 1) * 7 + dag.dag);
  const article = h("article", { class: `day ${dag.type === "rust" ? "rest" : `t-${dag.type}`}` },
    h("h4", { text: `${DAGEN_KORT[dag.dag]} ${dateLabel(date).split(" ").slice(1).join(" ")}` }),
    dag.type === "rust" ? h("p", { class: "muted", text: "Rust" }) : h("div", {},
      h("p", { class: "badge", text: `${TYPE_LABEL[dag.type] || dag.type}${dag.zone ? " · " + dag.zone : ""}` }),
      h("p", { class: "dur", text: minutesText(dag.minuten) }),
      h("p", { class: "dtitle", text: dag.titel })),
    h("button", {
      class: "btn ghost small day-details-button", type: "button", text: "Details / aanpassen",
      "aria-label": `Bekijk details van ${DAGEN_KORT[dag.dag]}: ${dag.titel || "rust"}`,
      onclick: () => openWorkoutDetails(plan, week, dag)
    }));
  return article;
}

function workoutProfileBlocks(workout, intake) {
  const suppliedBlocks = workoutZoneBlocks(workout, intake);
  const maxZone = maxVisibleZone(intake, suppliedBlocks);
  if (suppliedBlocks.length !== 1 || suppliedBlocks[0].label !== "Gelijkmatig") return suppliedBlocks;

  const zone = Number((workout.zone || "").slice(1));
  if (!zone) return suppliedBlocks;
  const interval = ["drempel", "vo2max", "sprint"].includes(workout.type) ||
    /interval|\b\d+\s*[x×]\s*\d+/i.test(`${workout.titel || ""} ${workout.beschrijving || ""}`);
  if (!interval) return suppliedBlocks;
  const target = Math.min(zone, maxZone);
  const recovery = Math.max(1, target - 1);
  const warmup = Math.max(2, Math.round(workout.minuten * 0.15));
  const cooldown = Math.max(2, Math.round(workout.minuten * 0.10));
  const mainMinutes = Math.max(1, workout.minuten - warmup - cooldown);
  const repetitions = Math.min(4, Math.max(2, Math.floor(mainMinutes / 5)));
  const workTotal = Math.round(mainMinutes * 0.65);
  const recoveryTotal = mainMinutes - workTotal;
  const distribute = (total, count) => Array.from({ length: count }, (_, index) =>
    Math.floor(total / count) + (index < total % count ? 1 : 0));
  const efforts = distribute(workTotal, repetitions);
  const recoveries = distribute(recoveryTotal, repetitions - 1);
  const blocks = [{ minuten: warmup, zone: "Z1", label: "Warming-up" }];
  efforts.forEach((minutes, index) => {
    blocks.push({ minuten: minutes, zone: `Z${target}`, label: "Interval" });
    if (recoveries[index] !== undefined) blocks.push({ minuten: recoveries[index], zone: `Z${recovery}`, label: "Herstel" });
  });
  blocks.push({ minuten: cooldown, zone: "Z1", label: "Cooling-down" });
  const difference = workout.minuten - blocks.reduce((total, block) => total + block.minuten, 0);
  if (difference) blocks[0].minuten += difference;
  return blocks.filter(block => block.minuten > 0);
}

function workoutProfile(workout, intake) {
  const blocks = workoutProfileBlocks(workout, intake);
  const maxZone = maxVisibleZone(intake, blocks);
  const chart = h("div", {
    class: "workout-profile-chart",
    role: "img",
    "aria-label": `Trainingsverloop: ${blocks.map(block => `${block.label}, ${block.minuten} minuten${block.zone ? ` in ${block.zone}` : ""}`).join("; ")}`
  }, ...blocks.map(block => {
    const level = Number((block.zone || "").slice(1));
    const height = level ? Math.max(16, Math.round(level / maxZone * 100)) : 16;
    return h("div", {
      class: `profile-segment${level ? ` profile-${block.zone.toLowerCase()}` : " profile-zone-unknown"}`,
      style: `flex-grow:${block.minuten};height:${height}%`,
      title: `${block.label}: ${block.minuten} min${block.zone ? `, ${block.zone}` : ""}`
    }, h("span", { class: "profile-zone-label", text: block.zone || "—" }));
  }));
  const description = workout.blokken?.length
    && blocks.length > 1
    ? "De blokken volgen de trainingsopbouw uit het schema."
    : workout.zone ? `Gelijkmatige training in ${workout.zone}.` : "Trainingszone niet opgegeven.";
  return h("figure", { class: "workout-profile" },
    h("figcaption", {},
      h("strong", { text: "Trainingsverloop" }),
      h("span", { class: "hint", text: description })),
    chart,
    h("div", { class: "profile-time-axis", "aria-hidden": "true" },
      h("span", { text: "0 min" }), h("span", { text: `${Math.round(workout.minuten / 2)} min` }),
      h("span", { text: `${workout.minuten} min` })));
}

function openWorkoutDetails(plan, week, dag) {
  const date = addDays(plan.start_date, (week.week_no - 1) * 7 + dag.dag);
  const modal = h("div", { class: "modal-backdrop" });
  const close = () => modal.remove();
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });
  let editor = null;
  const closeButton = h("button", { class: "btn ghost small", type: "button", text: "Sluiten", onclick: close });
  const editButton = plan.intake.dagen.includes(dag.dag) ? h("button", {
    class: "btn ghost", type: "button", text: "Training aanpassen",
    onclick: () => {
      if (editor) return;
      editor = workoutEditor(plan, week, dag, error, status, () => { editor = null; });
      detail.appendChild(editor);
    }
  }) : null;
  const detail = h("section", { class: "workout-details stack", role: "dialog", "aria-modal": "true", "aria-labelledby": "workout-details-title" },
    h("div", { class: "row between" },
      h("div", {},
        h("p", { class: "eyebrow", text: dateLabel(date) }),
        h("h2", { id: "workout-details-title", text: dag.type === "rust" ? "Rustdag" : dag.titel })),
      closeButton),
    dag.type === "rust" ? h("p", { class: "muted", text: "Een rustdag om te herstellen en je volgende training fris te beginnen." }) :
      h("div", { class: "workout-detail-summary" },
        h("span", { class: "badge", text: `${TYPE_LABEL[dag.type] || dag.type}${dag.zone ? " · " + dag.zone : ""}` }),
        h("strong", { text: minutesText(dag.minuten) }),
        h("p", { text: dag.beschrijving || "Geen extra beschrijving." }),
        workoutProfile(dag, plan.intake)),
    editButton,
    dag.type !== "rust" ? h("details", { class: "optional-trainingpeaks" },
      h("summary", { text: "Optioneel: gebruiken in TrainingPeaks AI" }),
      h("p", { class: "hint", text: "Kopieer de training inclusief je zones en eventuele intervalblokken." }),
      h("button", {
        class: "btn ghost small", type: "button", text: "Kopieer prompt voor TrainingPeaks AI",
        onclick: async () => {
          try {
            const currentPlan = state.data?.plan || plan;
            const currentWeek = state.data?.weeks.find(item => item.week_no === week.week_no);
            const currentWorkout = currentWeek?.dagen.find(item => item.dag === dag.dag) || dag;
            await navigator.clipboard.writeText(trainingPeaksPrompt(currentPlan, currentWorkout));
            status.textContent = "Prompt gekopieerd.";
          } catch {
            error.textContent = "Kopiëren lukte niet. Controleer of je browser klembordtoegang toestaat.";
          }
        }
      })) : null,
    error, status);
  modal.appendChild(detail);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  modal.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  app.appendChild(modal);
  closeButton.focus();
}

function workoutEditor(plan, week, dag, error, status, onCancel) {
  const type = h("select", {}, Object.entries(TYPE_LABEL).map(([value, label]) =>
    h("option", { value, selected: dag.type === value, text: label })));
  const minutes = h("input", { type: "number", min: 20, max: 360, step: 1, value: dag.minuten || 60 });
  const maxZone = ["power", "both"].includes(plan.intake.meter)
    ? (plan.intake.power_zone_count === 5 ? 5 : 7) : 5;
  const zone = h("select", {}, ZONE_OPTIONS.filter(value => !value || Number(value.slice(1)) <= maxZone).map(value =>
    h("option", { value, selected: (dag.zone || "") === value, text: value || "Geen zone" })));
  const title = h("input", { type: "text", maxlength: 80, value: dag.type === "rust" ? "" : dag.titel });
  const description = h("textarea", { rows: 3, maxlength: 500 }, dag.type === "rust" ? "" : dag.beschrijving);
  const blockRows = h("div", { class: "workout-block-rows stack" });
  const blocks = Array.isArray(dag.blokken) ? dag.blokken.map(block => ({
    minuten: String(block.minuten), zone: block.zone || "", label: block.label || ""
  })) : [];
  const renderBlocks = () => {
    for (const block of blocks) {
      if (block.inputs) {
        block.minuten = block.inputs.blockMinutes.value;
        block.zone = block.inputs.blockZone.value;
        block.label = block.inputs.label.value;
      }
    }
    clear(blockRows);
    for (const [index, block] of blocks.entries()) {
      const blockMinutes = h("input", { type: "number", min: 1, max: 360, step: 1, required: true, value: block.minuten });
      const blockZone = h("select", {}, ZONE_OPTIONS.filter(value => !value || Number(value.slice(1)) <= maxZone).map(value =>
        h("option", { value, selected: block.zone === value, text: value || "Geen zone" })));
      const label = h("input", { type: "text", maxlength: 50, placeholder: "Bijv. warming-up, interval, herstel", value: block.label });
      blockRows.appendChild(h("div", { class: "workout-block-row" },
        field("Minuten", blockMinutes),
        field("Zone", blockZone),
        field("Onderdeel", label),
        h("button", {
          class: "btn ghost small", type: "button", text: "Verwijderen",
          "aria-label": `Verwijder trainingsblok ${index + 1}`,
          onclick: () => { blocks.splice(index, 1); renderBlocks(); }
        })));
      block.inputs = { blockMinutes, blockZone, label };
    }
  };
  const addBlock = h("button", {
    class: "btn ghost small", type: "button", text: "Intervalblok toevoegen",
    onclick: () => {
      blocks.push({ minuten: "1", zone: zone.value, label: "Interval" });
      renderBlocks();
    }
  });
  renderBlocks();
  const save = h("button", { class: "btn small", type: "submit", text: "Wijziging opslaan" });
  const updateRequirements = () => {
    const resting = type.value === "rust";
    minutes.required = !resting;
    title.required = !resting;
    description.required = !resting;
    minutes.disabled = resting;
    zone.disabled = resting;
    title.disabled = resting;
    description.disabled = resting;
    for (const block of blocks) {
      for (const input of Object.values(block.inputs || {})) input.disabled = resting;
    }
    addBlock.disabled = resting;
  };
  type.addEventListener("change", updateRequirements);
  updateRequirements();
  let editor;
  const cancel = h("button", {
    class: "btn ghost small", type: "button", text: "Annuleren",
    onclick: () => { editor.remove(); onCancel(); }
  });
  editor = h("form", {
    class: "workout-editor stack",
    onsubmit: async event => {
      event.preventDefault();
      error.textContent = "";
      const editedBlocks = blocks.map(block => ({
        minuten: Number(block.inputs.blockMinutes.value),
        zone: block.inputs.blockZone.value,
        label: block.inputs.label.value
      }));
      if (type.value !== "rust" && editedBlocks.length &&
          editedBlocks.reduce((total, block) => total + block.minuten, 0) !== Number(minutes.value)) {
        error.textContent = "De minuten van je trainingsblokken moeten samen de totale trainingsduur zijn.";
        return;
      }
      const done = busyButton(save, "Schema opslaan…", status);
      try {
        await api("POST", "/api/plan/workout", {
          week_no: week.week_no, day_no: dag.dag,
          workout: {
            type: type.value, minuten: minutes.value ? Number(minutes.value) : 0,
            zone: zone.value, titel: title.value, beschrijving: description.value,
            blokken: editedBlocks.length ? editedBlocks : null
          }
        });
        state.data = await api("GET", "/api/plan");
        viewPlan();
      } catch (e) {
        error.textContent = e.message;
        done();
      }
    }
  },
  h("h3", { text: "Training aanpassen" }),
  field("Trainingstype", type),
  h("div", { class: "grid2" }, field("Duur in minuten", minutes), field("Trainingszone", zone)),
  field("Titel", title), field("Beschrijving", description),
  h("details", { class: "workout-block-editor" },
    h("summary", { text: "Interval- en herstelblokken aanpassen (optioneel)" }),
    h("p", { class: "hint", text: "Voeg de blokken toe als je een intervaltraining wilt uitschrijven. De blokminuten moeten samen de totale trainingsduur zijn." }),
    blockRows, addBlock),
  h("div", { class: "row" }, save, cancel));
  return editor;
}

function checkinIsDue(plan, week) {
  return week.week_no < plan.total_weeks && !week.checkin &&
    todayIso() >= addDays(plan.start_date, week.week_no * 7);
}

function coachChat(plan, currentWeek) {
  const defaultDay = (new Date(`${todayIso()}T00:00:00Z`).getUTCDay() + 6) % 7;
  const checkinDue = checkinIsDue(plan, currentWeek);
  const messages = h("div", { class: "chat", "aria-live": "polite", "aria-relevant": "additions text" });
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });
  const input = h("textarea", { id: "coach-input", rows: 2, maxlength: 1000, required: true, placeholder: "Typ een bericht…" }, state.coachDraft);
  input.addEventListener("input", () => { state.coachDraft = input.value; });
  let form;
  const submit = h("button", { class: "chat-send", type: "submit", "aria-label": "Verstuur bericht", text: "➤", onclick: () => form?.requestSubmit() });
  let loadId = 0;
  let conversation = [];
  const renderMessages = (items, thinking = false) => {
    clear(messages);
    if (!items.length && !thinking && !checkinDue) messages.appendChild(h("div", { class: "chat-empty" },
      h("span", { class: "coach-avatar", "aria-hidden": "true", text: "W" }),
      h("p", { text: "Hoi! Ik ben je wielercoach. Vraag me iets over je schema, trainingen of herstel." }),
      h("p", { class: "hint", text: "Je kunt in je eigen woorden vragen om iets aan je schema toe te voegen of te veranderen." })));
    for (const item of items) {
      messages.appendChild(h("div", { class: `chat-message ${item.role === "assistant" ? "coach" : "user"}` },
        h("span", { class: "chat-label", text: item.role === "assistant" ? "WielerSchema-coach" : "Jij" }),
        h("p", { class: "chat-bubble" }, coachRichText(item.content)),
        item.updated ? h("span", { class: "hint", text: "Training bijgewerkt" }) : null,
        item.suggestion ? item.suggestion.workout.kind === "event"
          ? h("section", { class: "suggestion-card event-suggestion" },
            h("strong", { text: "Evenement en schema-aanpassing" }),
            h("h3", { text: item.suggestion.workout.title }),
            h("p", { text: `${dateLabel(item.suggestion.workout.event_date)} · ${item.suggestion.workout.event_type}` }),
            item.suggestion.workout.description ? h("p", { class: "muted", text: item.suggestion.workout.description }) : null,
            h("p", { class: "hint", text: `Dit evenement komt in week ${item.suggestion.workout.week_no}. De coach past de opbouw en herstelweken in het schema hierop aan.` }),
            h("p", { class: "muted", text: item.suggestion.workout.plan_summary }),
            h("ul", { class: "event-outline-changes" },
              ...item.suggestion.workout.plan_outline
                .filter(row => {
                  const current = state.data.plan.outline.find(old => old.week === row.week);
                  return !current || current.focus !== row.focus || current.fase !== row.fase || current.uren !== row.uren;
                })
                .slice(0, 4)
                .map(row => h("li", { text: `Week ${row.week}: ${FASE_LABEL[row.fase] || row.fase} · ${row.focus} · ${row.uren} u` }))),
            item.suggestion.status === "pending"
              ? h("div", { class: "row" },
                h("button", { class: "btn small", type: "button", text: "Evenement en schema toepassen", onclick: () => resolveSuggestion(item.suggestion.id, "apply") }),
                h("button", { class: "btn ghost small", type: "button", text: "Niet toepassen", onclick: () => resolveSuggestion(item.suggestion.id, "dismiss") }))
              : h("p", { class: "hint", text: item.suggestion.status === "applied" ? "Evenement en schema bijgewerkt" : "Voorstel niet toegepast" }))
          : h("section", { class: "suggestion-card" },
            h("strong", { text: `Voorstel voor ${DAGEN_KORT[item.suggestion.workout.dag] || "training"}` }),
            item.suggestion.workout.huidige ? h("div", { class: "suggestion-comparison" },
              h("p", { class: "hint", text: "Huidige training" }),
              h("p", { text: `${TYPE_LABEL[item.suggestion.workout.huidige.type] || "Training"}${item.suggestion.workout.huidige.type === "rust" ? "" : ` · ${minutesText(item.suggestion.workout.huidige.minuten)}`}` }),
              h("p", { text: item.suggestion.workout.huidige.titel }),
              item.suggestion.workout.huidige.zone ? h("p", { class: "muted", text: item.suggestion.workout.huidige.zone }) : null,
              item.suggestion.workout.huidige.beschrijving ? h("p", { class: "muted", text: item.suggestion.workout.huidige.beschrijving }) : null,
              h("p", { class: "suggestion-arrow", "aria-hidden": "true", text: "↓" })) : null,
            h("p", { class: "hint", text: "Voorgestelde training" }),
            h("strong", { text: `${TYPE_LABEL[item.suggestion.workout.type] || "Training"}${item.suggestion.workout.type === "rust" ? "" : ` · ${minutesText(item.suggestion.workout.minuten)}`}` }),
            h("p", { text: item.suggestion.workout.titel }),
            item.suggestion.workout.zone ? h("p", { class: "muted", text: item.suggestion.workout.zone }) : null,
            h("p", { class: "muted", text: item.suggestion.workout.beschrijving }),
            item.suggestion.workout.weekbelasting_waarschuwing ? h("p", { class: "load-warning", role: "status", text: item.suggestion.workout.weekbelasting_waarschuwing }) : null,
            item.suggestion.status === "pending"
              ? h("div", { class: "row" },
                h("button", { class: "btn small", type: "button", text: "Voorstel toepassen", onclick: () => resolveSuggestion(item.suggestion.id, "apply") }),
                h("button", { class: "btn ghost small", type: "button", text: "Niet toepassen", onclick: () => resolveSuggestion(item.suggestion.id, "dismiss") }))
              : h("p", { class: "hint", text: item.suggestion.status === "applied" ? "Training aangepast" : "Voorstel niet toegepast" })) : null));
    }
    if (checkinDue && !thinking) messages.appendChild(h("div", { class: "chat-message coach" },
      h("span", { class: "chat-label", text: "WielerSchema-coach" }),
      h("p", { class: "chat-bubble checkin-bubble", text: `Hoe ging week ${currentWeek.week_no}? Heb je kunnen trainen, en hoe voelde het? Vertel het gewoon in je eigen woorden; dan maak ik je volgende week passend.` })));
    if (thinking) messages.appendChild(h("div", { class: "chat-message coach", role: "status" },
      h("span", { class: "chat-label", text: "WielerSchema-coach" }),
      h("div", { class: "chat-bubble coach-thinking" },
        coachWheel(), h("span", { text: "De coach denkt mee…" }))));
    messages.scrollTop = messages.scrollHeight;
  };
  const resolveSuggestion = async (id, action) => {
    error.textContent = "";
    status.textContent = action === "apply" ? "Training wordt aangepast…" : "Voorstel wordt gesloten…";
    try {
      await api("POST", "/api/coach/suggestions", { id, action });
      state.data = await api("GET", "/api/plan");
      viewCoach();
    } catch (e) {
      error.textContent = e.message;
      status.textContent = "";
    }
  };
  const loadThread = async () => {
    const requestId = ++loadId;
    error.textContent = "";
    renderMessages([]);
    status.textContent = "Je gesprek laden…";
    try {
      const thread = await api("GET", "/api/coach/chat?global=1");
      if (requestId === loadId) {
        conversation = thread.messages;
        renderMessages(conversation);
      }
    } catch (e) {
      if (requestId === loadId) error.textContent = e.message;
    } finally {
      if (requestId === loadId) status.textContent = "";
    }
  };
  form = h("form", {
    class: "stack coach-chat-form",
    onsubmit: async event => {
      event.preventDefault();
      const bericht = input.value.trim();
      if (!bericht) return;
      error.textContent = "";
      submit.disabled = true;
      submit.textContent = "…";
      const startedAt = Date.now();
      renderMessages([...conversation, {
        role: "user", content: bericht
      }], true);
      status.textContent = "Je bericht wordt verwerkt. Dit kan even duren…";
      try {
        const reply = await api("POST", "/api/coach/chat", {
          week_no: currentWeek.week_no, day_no: defaultDay, bericht, global: true
        });
        const remaining = 3000 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        input.value = "";
        state.coachDraft = "";
        state.data = await api("GET", "/api/plan");
        state.week = state.data.weeks[state.data.weeks.length - 1].week_no;
        if (reply.plan_updated) status.textContent = "Je volgende trainingsweek staat klaar.";
        viewCoach(true);
      } catch (e) {
        error.textContent = e.message;
        submit.disabled = false;
        submit.textContent = "➤";
        renderMessages(conversation);
        status.textContent = "Bericht niet verzonden. Controleer je verbinding en probeer opnieuw.";
      }
    }
  },
  messages,
  h("div", { class: "quick-prompts", "aria-label": "Voorbeeldvragen" },
    ...["Leg deze training uit", "Maak deze training lichter"].map(text =>
      h("button", { class: "prompt-chip", type: "button", text, onclick: () => { input.value = `${text}.`; input.focus(); } }))),
  h("div", { class: "chat-composer" }, input, submit),
  h("p", { class: "hint", text: "Je berichten worden bewaard. De coach laat een wijzigingsvoorstel eerst zien; je schema verandert pas als je het toepast." }),
  error, status);
  loadThread();
  return h("section", { id: "coach-chat", class: "card stack coach-panel", "aria-labelledby": "coach-chat-title" },
    h("div", { class: "coach-heading" },
      h("span", { class: "coach-avatar", "aria-hidden": "true", text: "W" }),
      h("div", {},
        h("p", { class: "eyebrow", text: "ALTIJD IN JOUW HOEK" }),
        h("h2", { id: "coach-chat-title", text: "Praat met je coach" })),
      h("span", { class: "coach-presence" }, h("i", { "aria-hidden": "true" }), "Persoonlijke coach")),
    form);
}

function viewCoach(preserveScroll = false) {
  const scrollY = preserveScroll ? window.scrollY : 0;
  markCoachRead();
  state.page = "coach";
  renderNav("coach");
  if (!state.data?.plan) return viewIntake();
  const offset = dateOffset(state.data.plan.start_date, todayIso());
  const currentWeekNo = Math.min(state.data.plan.total_weeks, Math.max(1, Math.floor(offset / 7) + 1));
  const week = state.data.weeks.find(item => item.week_no === currentWeekNo) ||
    (offset < 0 ? state.data.weeks[0] : state.data.weeks[state.data.weeks.length - 1]);
  state.week = week.week_no;
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "PERSOONLIJKE BEGELEIDING" }),
      h("h1", { text: "Coach" }),
      h("p", { class: "muted", text: "Eén doorlopend gesprek over je schema, trainingen en herstel." })),
    coachChat(state.data.plan, week)
  );
  if (preserveScroll) window.scrollTo(0, scrollY);
}

function viewPlan() {
  state.page = "plan";
  renderNav("plan");
  if (!state.data || !state.data.plan) return viewIntake();
  const { plan, weeks } = state.data;
  const week = weeks.find(w => w.week_no === state.week) || weeks[weeks.length - 1];
  const last = weeks[weeks.length - 1];

  const outline = h("ol", { class: "outline", "aria-label": "Overzicht van alle weken" },
    ...plan.outline.map(o => {
      const available = weeks.some(w => w.week_no === o.week);
      const el = h("li", { class: `chip ph-${o.fase}${o.week === week.week_no ? " current" : ""}${available ? "" : " future"}` },
        h("strong", { text: `Week ${o.week}` }), h("span", { text: FASE_LABEL[o.fase] || o.fase }), h("span", { text: `${o.uren} u` }));
      if (o.focus) el.setAttribute("title", o.focus);
      if (available) {
        el.classList.add("clickable");
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        const go = () => { state.week = o.week; viewPlan(); };
        el.addEventListener("click", go);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      }
      return el;
    }));

  const outlineItem = plan.outline.find(o => o.week === week.week_no);
  const isLast = week.week_no === last.week_no;
  const finished = isLast && week.week_no >= plan.total_weeks;
  const shareStatus = h("p", { class: "muted", role: "status", "aria-live": "polite" });
  const shareButton = h("button", {
    class: "btn ghost small", type: "button", text: "Deel schema als afbeelding",
    onclick: async () => {
      shareButton.disabled = true;
      try {
        await shareWeekAsImage(plan, week, shareStatus);
      } catch (error) {
        if (error.name !== "AbortError") shareStatus.textContent = error.message || "De schema-afbeelding kon niet worden gemaakt.";
      } finally {
        shareButton.disabled = false;
      }
    }
  });

  show(
    h("div", { class: "dashboard-heading" },
      h("p", { class: "eyebrow", text: "JOUW TRAININGSDASHBOARD" }),
      h("h1", { text: plan.intake.doel })),
    raceHeader(plan, week),
    h("section", { class: "card stack" },
      h("p", { text: plan.summary }),
      h("p", { class: "muted", text: `${plan.total_weeks} weken, start ${dateLabel(plan.start_date)}. Je ziet steeds één week in detail; de volgende week maakt de coach nadat je hebt teruggemeld hoe het ging.` }),
      outline),
    plan.events?.length ? h("section", { class: "card stack plan-events" },
      h("h2", { text: "Aankomende evenementen" }),
      ...plan.events.map(event => h("div", { class: "plan-event" },
        h("strong", { text: event.title }),
        h("span", { class: "muted", text: `${dateLabel(event.event_date)} · ${event.event_type}` }),
        event.description ? h("p", { class: "muted", text: event.description }) : null))) : null,
    week.waarschuwing ? h("p", { class: "warn", role: "alert", text: week.waarschuwing }) : null,
    week.weekbelasting_waarschuwing ? h("p", { class: "load-warning", role: "status", text: week.weekbelasting_waarschuwing }) : null,
    h("section", { class: "stack" },
      h("div", { class: "row between" },
        h("h2", { text: `Week ${week.week_no}${outlineItem && outlineItem.focus ? ": " + outlineItem.focus : ""}` }),
        h("div", { class: "row week-actions" },
          h("button", { class: "btn ghost small", type: "button", text: "Download agenda (.ics)", onclick: () => downloadIcs(plan, week) }),
          shareButton)),
      shareStatus,
      week.uitleg ? h("p", { class: "muted", text: week.uitleg }) : null,
      h("p", { class: "muted", text: `Totaal ${minutesText(week.totaal_minuten)}` }),
      h("div", { class: "days-grid" }, ...week.dagen.map(d => dayCard(plan, week, d))),
      week.tips ? h("p", { class: "tip", text: "Tip: " + week.tips }) : null),
    isLast && !finished && checkinIsDue(plan, week) ? h("section", { class: "card stack week-checkin-prompt" },
      h("p", { class: "eyebrow", text: "WEEKTERUGBLIK" }),
      h("h3", { text: `Hoe ging week ${week.week_no}?` }),
      h("p", { class: "muted", text: "Vertel je coach in de chat wat je hebt getraind en hoe het voelde. Dan maakt die je volgende week." }),
      h("button", { class: "btn", type: "button", text: "Vertel het aan je coach", onclick: viewCoach })) : null,
    finished ? h("p", { class: "card", text: "Dit was de laatste week van je schema. Veel succes met je doel!" }) : null,
    h("p", { class: "muted" },
      h("button", { class: "link", type: "button", text: "Nieuw schema beginnen",
        onclick: async () => {
          if (!confirm("Weet je het zeker? Je huidige schema wordt verwijderd.")) return;
          await api("DELETE", "/api/plan");
          state.data = { plan: null, weeks: [] };
          viewIntake(plan.intake);
        } }))
  );
}

// ---------- racekop op de planpagina ----------
function raceHeader(plan, week) {
  const intake = plan.intake;
  const item = plan.outline.find(o => o.week === week.week_no);
  const daysOut = intake.datum ? dateOffset(todayIso(), intake.datum) : null;
  const stat = (label, value, sub) => h("div", { class: "race-stat" },
    h("span", { class: "race-stat-label", text: label }),
    h("strong", { text: value }),
    sub ? h("span", { class: "muted", text: sub }) : null);
  return h("section", { class: "card race-header" },
    h("div", { class: "row between" },
      h("div", { class: "stack race-title" },
        h("div", { class: "row" },
          h("span", { class: "tag tag-accent", text: daysOut !== null && daysOut >= 0 ? "Doel" : "Schema" }),
          item ? h("span", { class: "tag", text: FASE_LABEL[item.fase] || item.fase }) : null),
        h("h2", { text: intake.doel }),
        intake.datum ? h("p", { class: "muted", text: dateLabel(intake.datum) }) : null),
      daysOut !== null && daysOut >= 0 ? h("div", { class: "race-countdown" },
        h("strong", { text: String(daysOut) }), h("span", { text: daysOut === 1 ? "dag te gaan" : "dagen te gaan" })) : null),
    h("div", { class: "meter", role: "progressbar", "aria-label": "Voortgang van het schema", "aria-valuemin": 0, "aria-valuemax": plan.total_weeks, "aria-valuenow": week.week_no },
      h("span", { style: `width:${Math.round(week.week_no / plan.total_weeks * 100)}%` })),
    h("div", { class: "race-stats" },
      stat("Week", `${week.week_no} van ${plan.total_weeks}`, item?.focus || null),
      stat("Fase", item ? (FASE_LABEL[item.fase] || item.fase) : "–", item ? `${item.uren} u gepland` : null),
      stat("Nog te gaan", daysOut !== null && daysOut >= 0 ? `${(daysOut / 7).toFixed(1).replace(".", ",")} weken` : "–"),
      stat("Trainingsdagen", `${intake.dagen.length} per week`, intake.dagen.slice().sort((a, b) => a - b).map(d => DAGEN_KORT[d]).join(" · "))));
}

// ---------- analyse ----------
const nl = (n, digits = 0) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const signed = (n, digits = 1) => (n === null || n === undefined ? "–" : `${n > 0 ? "+" : ""}${nl(n, digits)}`);
const hoursText = hours => { const m = Math.round(hours * 60); return `${Math.floor(m / 60)} u ${String(m % 60).padStart(2, "0")} min`; };
function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
  kids.flat().forEach(kid => kid && el.appendChild(kid));
  return el;
}
function analyticsStat(label, value, sub) {
  return h("div", { class: "stat-card" },
    h("span", { class: "muted", text: label }), h("strong", { text: value }), h("span", { class: "muted small-text", text: sub || "" }));
}
function meterBar(score, tone) {
  return h("div", { class: `meter ${tone || ""}`, role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": score },
    h("span", { style: `width:${score}%` }));
}
function performanceChart(reeks) {
  const W = 900, H = 260, pad = { l: 38, r: 12, t: 12, b: 26 };
  const n = reeks.length;
  const x = i => pad.l + (n > 1 ? i * (W - pad.l - pad.r) / (n - 1) : 0);
  const maxLine = Math.max(10, ...reeks.map(p => Math.max(p.ctl || 0, p.atl || 0))) * 1.1;
  const maxLoad = Math.max(10, ...reeks.map(p => p.load || 0)) * 2.2;
  const plotH = H - pad.t - pad.b;
  const yLine = v => H - pad.b - (v / maxLine) * plotH;
  const yBar = v => H - pad.b - (v / maxLoad) * plotH;
  const barW = Math.max(1, (W - pad.l - pad.r) / n * 0.7);
  const path = key => reeks.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${yLine(p[key] || 0).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = H - pad.b - f * plotH;
    return svgEl("g", null,
      svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: "chart-grid" }),
      svgEl("text", { x: pad.l - 6, y: y + 4, class: "chart-label", "text-anchor": "end" }, document.createTextNode(String(Math.round(maxLine * f)))));
  });
  const labelAt = i => svgEl("text", { x: x(i), y: H - 6, class: "chart-label", "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" },
    document.createTextNode(dateLabel(reeks[i].d)));
  const last = reeks[n - 1];
  return svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img",
    "aria-label": `Prestatiegrafiek: fitness ${nl(last.ctl)}, vermoeidheid ${nl(last.atl)}, vorm ${signed(last.tsb, 0)}`
  },
    ...grid,
    ...reeks.map((p, i) => p.load > 0 ? svgEl("rect", { x: x(i) - barW / 2, y: yBar(p.load), width: barW, height: H - pad.b - yBar(p.load), class: "chart-bar" }) : null),
    svgEl("path", { d: path("ctl"), class: "chart-line chart-ctl" }),
    svgEl("path", { d: path("atl"), class: "chart-line chart-atl" }),
    labelAt(0), n > 2 ? labelAt(Math.floor((n - 1) / 2)) : null, n > 1 ? labelAt(n - 1) : null);
}

function viewAnalytics(days = 84) {
  state.page = "analytics";
  renderNav("analytics");
  const body = h("div", { class: "stack" }, h("p", { class: "muted", text: "Analyse laden…" }));
  const ranges = [[7, "1w"], [28, "4w"], [84, "12w"], [182, "6m"], [365, "1j"]];
  show(
    h("div", { class: "page-heading row between" },
      h("div", null,
        h("p", { class: "eyebrow", text: "ANALYSE" }),
        h("h1", { text: "Training en herstel" }),
        h("p", { class: "muted", text: "Berekend uit je activiteiten en, met een gekoppeld horloge, je nachtgegevens." })),
      h("div", { class: "analytics-range", role: "group", "aria-label": "Periode" },
        ...ranges.map(([value, label]) => h("button", { type: "button", class: `range-btn${value === days ? " active" : ""}`, text: label, onclick: () => viewAnalytics(value) })))),
    body);
  api("GET", `/api/analytics?dagen=${days}`)
    .then(data => renderAnalytics(body, data))
    .catch(error => { clear(body); body.appendChild(h("p", { class: "error", text: error.message })); });
}

function renderAnalytics(body, a) {
  clear(body);
  const k = a.kaarten;
  const hasLoad = a.bronnen.activiteiten > 0 || k.ctl > 0;
  const readiness = a.gereedheid, risk = a.belastingsrisico, balance = a.belastingsverhouding, night = a.nacht;

  const readinessCard = h("section", { class: "card stack" },
    h("div", { class: "row between" }, h("span", { class: "muted", text: "Gereedheid om te trainen" }),
      readiness ? h("span", { class: "tag tag-accent", text: readiness.label }) : null),
    readiness ? [
      h("p", { class: "big-number" }, h("strong", { text: String(readiness.score) }), h("span", { class: "muted", text: " / 100" })),
      meterBar(readiness.score),
      h("div", { class: "mini-stats" },
        h("div", null, h("span", { class: "muted", text: "HRV" }), h("strong", { text: readiness.hrv?.waarde != null ? `${nl(readiness.hrv.waarde)} ms` : "–" }), h("span", { class: "muted", text: readiness.hrv ? `${signed(readiness.hrv.verschil)} t.o.v. 14 dagen` : "geen data" })),
        h("div", null, h("span", { class: "muted", text: "Rusthartslag" }), h("strong", { text: readiness.rhr?.waarde != null ? `${nl(readiness.rhr.waarde)} bpm` : "–" }), h("span", { class: "muted", text: readiness.rhr ? `${signed(readiness.rhr.verschil)} t.o.v. 14 dagen` : "geen data" })),
        h("div", null, h("span", { class: "muted", text: "Slaapschuld" }), h("strong", { text: readiness.slaapschuld_uren != null ? `${nl(readiness.slaapschuld_uren, 1)} u` : "–" }), h("span", { class: "muted", text: "laatste 4 nachten" })))
    ] : h("p", { class: "muted", text: "Nog te weinig gegevens. Importeer een rit of koppel je horloge." }));

  const riskCard = h("section", { class: "card stack" },
    h("div", { class: "row between" }, h("span", { class: "muted", text: "Belastingsrisico" }), risk ? h("span", { class: "muted", text: `${risk.score}/100` }) : null),
    risk ? [
      h("p", { class: "big-number" }, h("strong", { text: String(risk.score) }), h("span", { class: "muted", text: ` ${risk.label}` })),
      meterBar(risk.score, "meter-risk"),
      h("p", { class: "muted small-text", text: `Fitnessgroei afgelopen 7 dagen: ${signed(risk.groei_ctl_7d)}. Hoog risico betekent: bouw rustiger op of neem een lichtere dag.` })
    ] : h("p", { class: "muted", text: "Je hebt minstens een paar weken aan ritten nodig." }));

  const balanceCard = h("section", { class: "card stack" },
    h("div", { class: "row between" }, h("span", { class: "muted", text: "Belastingsverhouding" }), balance ? h("span", { class: "tag", text: balance.label }) : null),
    balance ? [
      h("p", { class: "big-number" }, h("strong", { text: nl(balance.acwr, 2) }), h("span", { class: "muted", text: " ACWR" })),
      h("p", { class: "muted small-text", text: "0,8 tot 1,3 is veilig: laatste 7 dagen tegenover de laatste 28 dagen." }),
      h("div", { class: "mini-stats" },
        h("div", null, h("span", { class: "muted", text: "Eentonigheid" }), h("strong", { text: nl(balance.eentonigheid, 1) })),
        h("div", null, h("span", { class: "muted", text: "Weekspanning" }), h("strong", { text: nl(balance.spanning) })))
    ] : h("p", { class: "muted", text: "Nog geen belasting om te vergelijken." }));

  const nightCard = h("section", { class: "card stack" },
    h("div", { class: "row between" }, h("h2", { text: "Je nacht" }),
      night ? h("span", { class: "muted", text: dateLabel(night.laatste.d) }) : null),
    night ? [
      h("div", { class: "stats-grid" },
        analyticsStat("Slaapduur", hoursText(night.laatste.uren), `doel ${night.slaapdoel_uren} u`),
        analyticsStat("Slaapscore", night.laatste.score != null ? nl(night.laatste.score) : "–", "van je horloge"),
        analyticsStat("HRV", night.hrv?.waarde != null ? `${nl(night.hrv.waarde)} ms` : "–", night.hrv ? `${signed(night.hrv.verschil)} t.o.v. gemiddeld` : ""),
        analyticsStat("Rusthartslag", night.rhr?.waarde != null ? `${nl(night.rhr.waarde)} bpm` : "–", night.rhr ? `${signed(night.rhr.verschil)} t.o.v. gemiddeld` : ""),
        analyticsStat("Slaapschuld", `${nl(night.slaapschuld_uren, 1)} u`, "laatste 4 nachten")),
      h("div", { class: "night-bars", role: "img", "aria-label": "Slaapduur van de laatste nachten" },
        ...night.nachten.map(n => h("div", { class: "night-bar" },
          h("div", { class: "night-bar-fill", style: `height:${Math.min(100, Math.round(n.uren / 10 * 100))}%`, title: `${hoursText(n.uren)}` }),
          h("span", { class: "muted small-text", text: DAGEN_KORT[(new Date(`${n.d}T00:00:00Z`).getUTCDay() + 6) % 7] }))))
    ] : h("p", { class: "muted", text: "Nog geen slaapgegevens. Draag je horloge ’s nachts en koppel het via Koppelingen (Intervals.icu): dan zie je hier slaap, HRV en rusthartslag." }));

  body.append(
    h("div", { class: "stats-grid analytics-top" },
      analyticsStat("Fitness · CTL", hasLoad ? nl(k.ctl) : "–", "belasting 42 dagen"),
      analyticsStat("Vermoeidheid · ATL", hasLoad ? nl(k.atl) : "–", "belasting 7 dagen"),
      analyticsStat("Vorm · TSB", hasLoad ? signed(k.tsb, 0) : "–", k.vorm_label || ""),
      analyticsStat("Volume · 7d", `${nl(k.volume.uren, 1)} u`, `${k.volume.sessies} ${k.volume.sessies === 1 ? "rit" : "ritten"}`),
      analyticsStat("Gewicht", k.gewicht ? `${nl(k.gewicht.kg, 1)} kg` : "–", k.gewicht ? "laatste meting" : "geen data")),
    h("div", { class: "analytics-panels" }, readinessCard, riskCard, balanceCard),
    h("section", { class: "card stack" },
      h("div", { class: "row between" }, h("h2", { text: "Prestatiebeheer" }),
        h("div", { class: "chart-legend muted small-text" },
          h("span", { class: "legend-dot legend-bar" }), "belasting per dag",
          h("span", { class: "legend-dot legend-ctl" }), "fitness",
          h("span", { class: "legend-dot legend-atl" }), "vermoeidheid")),
      hasLoad ? performanceChart(a.reeks) : h("p", { class: "muted", text: "Importeer een rit bij Activiteiten om je fitness en vermoeidheid te zien." })),
    nightCard,
    h("p", { class: "muted small-text", text: `Gebaseerd op ${a.bronnen.activiteiten} activiteiten en ${a.bronnen.nachten} nachten. Belasting komt uit Intervals.icu en anders uit een schatting met je FTP of maximale hartslag (${a.bronnen.vermogen} op vermogen, ${a.bronnen.hartslag} op hartslag, ${a.bronnen.schatting} grof geschat). Gereedheid en risico zijn indicatief en geen medisch advies.` }));
}

// ---------- account ----------
function viewAccount() {
  state.page = "account";
  renderNav("account");
  const profile = state.profile || { birth_date: "", meter: "none" };
  const profileError = h("p", { class: "error", role: "alert" });
  const profileStatus = h("p", { class: "muted", role: "status" });
  const birthDate = birthDateInput(profile.birth_date || "");
  const meter = h("select", {}, [
    ["power", "Vermogensmeter"], ["heart_rate", "Hartslagmeter"],
    ["both", "Beide"], ["none", "Geen van beide"]
  ].map(([value, label]) => h("option", { value, selected: (profile.meter || "none") === value, text: label })));
  const equipment = measurementSettings(profile, meter);
  const saveProfile = h("button", { class: "btn", type: "submit", text: "Profiel opslaan" });
  const username = h("input", { type: "text", required: true, minlength: 3, maxlength: 30, autocapitalize: "none", value: state.user });
  const currentPassword = h("input", { type: "password", autocomplete: "current-password", required: true });
  const newPassword = h("input", { type: "password", autocomplete: "new-password", minlength: 10, maxlength: 200 });
  const credentialsError = h("p", { class: "error", role: "alert" });
  const credentialsStatus = h("p", { class: "muted", role: "status" });
  const saveCredentials = h("button", { class: "btn", type: "submit", text: "Accountgegevens opslaan" });
  const deleteError = h("p", { class: "error", role: "alert" });
  const deletePassword = h("input", { type: "password", autocomplete: "current-password", required: true });
  const deleteSubmit = h("button", { class: "btn danger", type: "submit", text: "Account en gegevens verwijderen" });
  const chatDeleteStatus = h("p", { class: "muted", role: "status" });
  const chatDeleteButton = h("button", { class: "btn ghost", type: "button", text: "Chatberichten verwijderen", onclick: async () => {
    if (!confirm("Alle chatberichten van je coach verwijderen? Je profiel en schema blijven behouden.")) return;
    chatDeleteButton.disabled = true;
    chatDeleteStatus.textContent = "Chatberichten verwijderen…";
    try {
      await api("DELETE", "/api/account/chat");
      state.unreadCoach = 0;
      markCoachRead();
      chatDeleteStatus.textContent = "Alle chatberichten zijn verwijderd.";
    } catch (error) {
      chatDeleteStatus.textContent = error.message;
      chatDeleteButton.disabled = false;
    }
  }});
  const loggedInName = h("strong", { text: state.user });
  show(
    h("h1", { text: "Account" }),
    h("section", { class: "card stack" },
      h("p", {}, "Ingelogd als ", loggedInName),
      h("p", {}, h("a", { class: "btn ghost", href: "/api/account/export", download: "wielerschema-gegevens.json", text: "Download mijn gegevens (JSON)" }))),
    h("form", {
      class: "card stack",
      onsubmit: async event => {
        event.preventDefault();
        profileError.textContent = "";
        profileStatus.textContent = "Profiel opslaan…";
        saveProfile.disabled = true;
        try {
          const result = await api("POST", "/api/account/profile", {
            profile: { geboortedatum: parseDutchDate(birthDate.value), meter: meter.value, ...equipment.values() }
          });
          state.profile = result.profile;
          if (result.plan_updated) state.data = await api("GET", "/api/plan");
          profileStatus.textContent = result.plan_updated ? "Profiel opgeslagen en je huidige schema bijgewerkt." : "Profiel opgeslagen.";
        } catch (error) {
          profileError.textContent = error.message;
          profileStatus.textContent = "";
        } finally {
          saveProfile.disabled = false;
        }
      }
    },
    h("h2", { text: "Trainingsprofiel" }),
    h("p", { class: "muted", text: "Pas je geboortedatum en meetapparatuur aan. Alleen je leeftijd wordt gebruikt bij de AI-coach." }),
    field("Geboortedatum (DD-MM-JJJJ)", birthDate),
    field("Welke meetapparatuur gebruik je?", meter),
    equipment.element,
    profileError, profileStatus, saveProfile),
    h("form", {
      class: "card stack",
      onsubmit: async event => {
        event.preventDefault();
        credentialsError.textContent = "";
        credentialsStatus.textContent = "";
        const done = busyButton(saveCredentials);
        try {
          const result = await api("POST", "/api/account/credentials", {
            username: username.value, current_password: currentPassword.value, new_password: newPassword.value
          });
          state.user = result.username;
          username.value = result.username;
          loggedInName.textContent = result.username;
          renderNav("account");
          currentPassword.value = "";
          newPassword.value = "";
          credentialsStatus.textContent = "Accountgegevens opgeslagen.";
        } catch (error) {
          credentialsError.textContent = error.message;
        } finally {
          done();
        }
      }
    },
    h("h2", { text: "Gebruikersnaam en wachtwoord" }),
    field("Inloggebruikersnaam", username),
    field("Huidig wachtwoord (verplicht om wijzigingen op te slaan)", currentPassword),
    field("Nieuw wachtwoord (optioneel, minstens 10 tekens)", newPassword),
    credentialsError, credentialsStatus, saveCredentials),
    h("form", {
      class: "card stack",
      onsubmit: async (event) => {
        event.preventDefault();
        deleteError.textContent = "";
        if (!confirm("Weet je het zeker? Dit verwijdert je account en je schema definitief.")) return;
        const done = busyButton(deleteSubmit);
        try { await api("POST", "/api/account/delete", { password: deletePassword.value }); state.user = null; state.data = null; start(); }
        catch (e) { deleteError.textContent = e.message; done(); }
      }
    },
    h("h2", { text: "Account verwijderen" }),
    h("p", { class: "muted", text: "Dit verwijdert je account, schema en chat. Dat kan niet ongedaan worden gemaakt." }),
    field("Wachtwoord ter bevestiging", deletePassword), deleteError, deleteSubmit)
    , h("section", { class: "card stack" },
      h("h2", { text: "Coachgesprekken" }),
      h("p", { class: "muted", text: "Verwijder je opgeslagen chatberichten met de coach. Je trainingsschema blijft staan." }),
      chatDeleteButton, chatDeleteStatus)
  );
}

// ---------- start ----------
async function start() {
  try {
    if (!state.user) {
      const me = await api("GET", "/api/me");
      state.user = me.username;
    }
    state.data = await api("GET", "/api/plan");
    state.profile = (await api("GET", "/api/account/profile")).profile;
    try {
      const chat = await api("GET", "/api/coach/chat?global=1");
      const readAt = getCoachReadAt();
      state.unreadCoach = chat.messages.filter(message =>
        message.role === "assistant" && Number(message.created_at) > readAt
      ).length;
    } catch {}
    if (state.data.plan) {
      state.week = state.data.weeks[state.data.weeks.length - 1].week_no;
      state.page = "plan";
      viewPlan();
    } else viewIntake();
  } catch (e) {
    if (e.status === 401) { state.user = null; state.data = null; viewHome(); }
    else show(h("p", { class: "error", text: e.message }));
  }
}

start();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}