"use strict";

/* WielerSchema frontend. Bewust zonder innerHTML: alle tekst gaat via textContent (veilig tegen XSS). */

const DAGEN_KORT = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const TYPE_LABEL = {
  rust: "Rust", duurrit: "Duurrit", tempo: "Tempo", drempel: "Drempel", vo2max: "VO2max", sprint: "Sprint",
  kracht: "Kracht", techniek: "Techniek", herstelrit: "Herstelrit", race: "Wedstrijd", mtb: "MTB"
};
const ZONE_OPTIONS = ["", "Z1", "Z2", "Z3", "Z4", "Z5", "Z6"];
const FASE_LABEL = { basis: "Basis", opbouw: "Opbouw", piek: "Piek", afbouw: "Afbouw", herstel: "Herstel" };

const app = document.getElementById("app");
const nav = document.getElementById("nav");
const sidebarAccount = document.getElementById("sidebar-account");
const coachLauncher = document.getElementById("coach-launcher");

const state = { user: null, data: null, week: 1, page: "plan", coachDraft: "" };

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

function defaultHrZones(threshold, maximum) {
  const upper = [0.81, 0.89, 0.93, 0.99, 1.05].map(factor => Math.min(maximum - 1, Math.round(threshold * factor)));
  upper.push(maximum);
  for (let i = 4; i >= 0; i--) upper[i] = Math.min(upper[i], upper[i + 1] - 1);
  for (let i = 0; i < 5; i++) upper[i] = Math.max(upper[i], i ? upper[i - 1] + 1 : 30);
  return upper;
}

function defaultPowerZones(ftp) {
  return [0.55, 0.75, 0.90, 1.05, 1.20, 1.50].map(factor => Math.round(ftp * factor));
}

function zoneEditor(title, unit, initial, calculate) {
  const inputs = Array.from({ length: 6 }, (_, index) => h("input", {
    type: "number", min: unit === "bpm" ? 30 : 20, max: unit === "bpm" ? 250 : 2000, step: 1,
    name: `${unit === "bpm" ? "hr" : "power"}_z${index + 1}`, placeholder: "—",
    value: initial?.[index] ?? ""
  }));
  const calculateButton = h("button", {
    class: "btn ghost small", type: "button", text: "Zones uit drempel berekenen",
    onclick: () => {
      const values = calculate();
      if (!values) return;
      values.forEach((value, index) => { inputs[index].value = value; });
    }
  });
  return {
    element: h("details", { class: "zone-editor" },
      h("summary", { text: `${title} aanpassen` }),
      h("p", { class: "hint", text: `Vul desgewenst de bovengrens per zone in ${unit}. Leeg laten gebruikt de berekende standaardzones.` }),
      h("div", { class: "zone-grid" }, ...inputs.map((input, index) => field(`Z${index + 1} tot`, input))),
      calculateButton),
    values: () => {
      if (inputs.every(input => input.value === "")) return null;
      return inputs.map(input => input.value === "" ? "" : Number(input.value));
    }
  };
}

function measurementSettings(initial, meter) {
  const container = h("div", { class: "stack equipment-settings" });
  const hrMax = h("input", { type: "number", name: "hr_max", min: 60, max: 240, step: 1, required: true, value: initial.hr_max ?? "" });
  const hrThreshold = h("input", { type: "number", name: "hr_threshold", min: 60, max: 230, step: 1, required: true, value: initial.hr_threshold ?? "" });
  const ftp = h("input", { type: "number", name: "ftp", min: 50, max: 1000, step: 1, required: true, value: initial.ftp ?? "" });
  const hrEditor = zoneEditor("Hartslagzones", "bpm", initial.hr_zones, () =>
    hrMax.value && hrThreshold.value ? defaultHrZones(Number(hrThreshold.value), Number(hrMax.value)) : null);
  const powerEditor = zoneEditor("Vermogenszones", "W", initial.power_zones, () =>
    ftp.value ? defaultPowerZones(Number(ftp.value)) : null);
  const render = () => {
    clear(container);
    const usesHr = ["heart_rate", "both"].includes(meter.value);
    const usesPower = ["power", "both"].includes(meter.value);
    hrMax.required = usesHr;
    hrThreshold.required = usesHr;
    ftp.required = usesPower;
    if (usesHr) {
      container.append(
        h("h3", { text: "Hartslaggegevens" }),
        h("div", { class: "grid2" },
          field("Maximale hartslag (bpm)", hrMax),
          field("Drempelhartslag (bpm)", hrThreshold)),
        hrEditor.element);
    }
    if (usesPower) {
      container.append(
        h("h3", { text: "Vermogensgegevens" }),
        field("FTP / drempelvermogen (watt)", ftp),
        powerEditor.element);
    }
  };
  meter.addEventListener("change", render);
  render();
  return {
    element: container,
    values: () => ({
      hr_max: hrMax.value ? Number(hrMax.value) : null,
      hr_threshold: hrThreshold.value ? Number(hrThreshold.value) : null,
      hr_zones: hrEditor?.values() || null,
      ftp: ftp.value ? Number(ftp.value) : null,
      power_zones: powerEditor?.values() || null
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
    ["activities", "Activiteiten", viewActivities],
    ["garmin", "Garmin koppelen", viewGarmin],
    ["account", "Account", viewAccount]
  ];
  for (const [page, label, action] of pages) {
    nav.appendChild(h("button", {
      class: `nav-item${activePage === page ? " active" : ""}`,
      type: "button",
      "aria-current": activePage === page ? "page" : null,
      text: label,
      onclick: action
    }));
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
        h("label", { class: "check" }, consent, h("span", {}, "Ik heb de ", h("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "privacyverklaring"), " gelezen en ga akkoord met verwerking van mijn gegevens voor deze dienst, waaronder verwerking van trainingsgegevens door de AI-coach.")),
        h("p", { class: "hint" }, "Ben je jonger dan 18? Bespreek je schema en trainingsbelasting met je ouder/verzorger en jeugdtrainer. De coach is geen vervanging voor begeleiding."))
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
        h("p", { text: "De coach maakt een weekschema op basis van jouw informatie en beschikbare trainingsdagen." })),
      h("article", { class: "landing-card" },
        h("span", { class: "landing-number", text: "03" }),
        h("h2", { text: "Blijf bijsturen" }),
        h("p", { text: "Gebruik de chat om vragen te stellen en bekijk coachvoorstellen voordat je ze toepast." }))),
    h("section", { class: "youth-notice" },
      h("h2", { text: "Jeugdrenner?" }),
      h("p", { text: "WielerSchema is een hulpmiddel en geen medische of professionele begeleiding. Ben je jonger dan 18, bespreek je schema en trainingsbelasting met je ouder/verzorger en een gekwalificeerde jeugdtrainer." })),
    h("section", { class: "landing-integrations" },
      h("h2", { text: "Koppelingen" }),
      h("p", { text: "Een Garmin-koppeling wordt voorbereid. Strava en Wahoo zijn nog niet gekoppeld; automatische synchronisatie werkt pas zodra officiële toegang beschikbaar is." }))
  );
}

// ---------- intake ----------
function viewIntake(prefill) {
  state.page = "plan";
  renderNav("plan");
  const p = prefill || {};
  const savedProfile = state.profile || {};
  const youthNotice = h("p", { class: "youth-inline-note", text: "Ben je jonger dan 18? Bespreek je schema en trainingsbelasting met je ouder/verzorger en jeugdtrainer." });
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });

  const doel = h("input", { type: "text", name: "goal", maxlength: 200, required: true, placeholder: "Bijvoorbeeld: mijn eerste wedstrijd rijden", value: p.doel || "" });
  const birthDate = h("input", {
    type: "date", name: "geboortedatum", min: "1900-01-01", max: todayIso(), required: true,
    value: savedProfile.birth_date || ""
  });
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
      field("Geboortedatum", birthDate, "Je leeftijd helpt de coach het schema af te stemmen. Alleen je leeftijd, niet je geboortedatum, wordt met de AI gedeeld."),
      youthNotice,
      field("Heb je een datum voor je doel?", datum, "Optioneel. Zonder datum maakt de coach een schema van ongeveer 8 weken."),
      field("Hoe zou je je niveau omschrijven?", niveau)),
    h("section", { class: "wizard-panel stack", hidden: true },
      h("h2", { text: "2. Jouw tijd" }),
      h("p", { class: "muted", text: "Kies alleen dagen en uren die echt in je week passen. Rust hoort ook bij trainen." }),
      field("Hoeveel uur per week kun je meestal trainen?", uren, "Dit is een bovengrens, geen doel dat je moet halen."),
      h("fieldset", { class: "days" }, h("legend", { text: "Op welke dagen kun je meestal trainen? (minimaal 2)" }),
        ...dagenChecks.map(d => h("label", { class: "daybox" }, d.box, h("span", { text: d.naam })))),
      h("p", { class: "youth-inline-note", text: "Voor jeugdrenners: laat een ouder/verzorger en jeugdtrainer meekijken naar de trainingsweek." })),
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
      geboortedatum: birthDate.value,
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
      if (!birthDate.value || birthDate.value >= todayIso()) {
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
      if (["heart_rate", "both"].includes(meter.value) && (!equipment.values().hr_max || !equipment.values().hr_threshold)) {
        error.textContent = "Vul je maximale en drempelhartslag in.";
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
      status.textContent = "De coach bekijkt je gegevens…";
      try {
        const res = await api("POST", "/api/intake/questions", { intake });
        if (res.vragen.length === 0) await createPlan(intake, [], error, status);
        else viewQuestions(intake, res.vragen);
      } catch (e) { error.textContent = e.message; done(); }
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
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "JOUW TRAININGEN" }),
      h("h1", { text: "Activiteiten" }),
      h("p", { class: "muted", text: "Je trainingen verschijnen hier zodra een officiële activiteitkoppeling beschikbaar is." })),
    h("section", { class: "card stack activity-empty" },
      h("span", { class: "activity-empty-icon", "aria-hidden": "true", text: "↗" }),
      h("h2", { text: "Nog geen activiteiten gekoppeld" }),
      h("p", { class: "muted", text: "We bouwen aan een veilige Garmin-koppeling. Als Garmin toegang verleent, kunnen je recente ritten hier verschijnen en kun je ze met je coach bespreken." }),
      h("button", { class: "btn", type: "button", text: "Bekijk Garmin-koppeling", onclick: viewGarmin })),
    h("section", { class: "card integration-card stack" },
      h("div", { class: "integration-mark strava-mark", "aria-hidden": "true", text: "S" }),
      h("div", {},
        h("h2", { text: "Strava" }),
        h("p", { class: "muted", text: "Een koppeling met Strava is nog niet beschikbaar." })))
  );
}

function viewGarmin() {
  state.page = "garmin";
  renderNav("garmin");
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "ACTIVITEITEN AUTOMATISEREN" }),
      h("h1", { text: "Koppel Garmin" }),
      h("p", { class: "muted", text: "We bereiden de koppeling voor. Je Garmin-account is nog niet verbonden." })),
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
      h("p", { class: "hint", text: "Er wordt nog geen Garmin-login gevraagd en er worden geen gegevens gesynchroniseerd." }))
  );
}

function viewQuestions(intake, vragen) {
  state.page = "plan";
  renderNav("plan");
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });
  const messages = [];
  let index = 0;
  const render = () => {
    const answer = h("textarea", { rows: 2, maxlength: 300, placeholder: "Typ je antwoord…" });
    const last = index >= vragen.length - 1;
    const submit = h("button", { class: "btn", type: "submit", text: last ? "Maak mijn schema" : "Verstuur antwoord" });
    const chat = h("div", { class: "chat", "aria-live": "polite" },
      ...messages.map(message => h("div", { class: `chat-message ${message.role}` },
        h("span", { class: "chat-label", text: message.role === "coach" ? "Coach" : "Jij" }),
        h("p", { class: "chat-bubble", text: message.text }))),
      index < vragen.length ? h("div", { class: "chat-message coach" },
        h("span", { class: "chat-label", text: "Coach" }),
        h("p", { class: "chat-bubble", text: vragen[index].vraag })) : null
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
        if (!last) { index++; render(); return; }
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
  statusEl.textContent = "De coach maakt je schema. Dit duurt ongeveer een halve minuut…";
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

function trainingPeaksPrompt(plan, dag) {
  const meter = plan.intake.meter;
  const intensity = meter === "heart_rate" ? "Heart Rate (gebruik mijn ingestelde hartslagzones)"
    : meter === "both" ? "Heart Rate als primair doel; gebruik vermogen alleen als dit bij de training staat"
      : meter === "power" && plan.intake.ftp ? `percentOfFtp (FTP ${plan.intake.ftp} W)`
        : "RPE/gevoel (geen meterdoel verzinnen)";
  const zoneTarget = meter === "power" ? "mijn ingestelde vermogenszones"
    : ["heart_rate", "both"].includes(meter) ? "mijn ingestelde hartslagzones"
      : "de genoemde trainingszone en RPE";
  const target = dag.zone ? `${dag.zone} volgens ${zoneTarget}, ${dag.beschrijving}` : dag.beschrijving;
  return [
    "Maak hiervan een gestructureerde wielertraining in TrainingPeaks.",
    "Sport Type: Bike",
    `Intensity: ${intensity}`,
    "Build Intervals By: Duration",
    "Block Type: warming-up, hoofdset, herstelblokken en cooling-down waar passend",
    `Duration: ${dag.minuten} minuten`,
    `Target: ${target || "rustig, RPE 3-4/10"}`,
    `Training: ${dag.titel}. ${dag.beschrijving}`,
    "Behoud de totale duur en de genoemde intervallen. Verzin geen FTP, wattages of hartslag in bpm."
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
      class: "btn ghost small day-details-button", type: "button", text: "Details bekijken",
      "aria-label": `Bekijk details van ${DAGEN_KORT[dag.dag]}: ${dag.titel || "rust"}`,
      onclick: () => openWorkoutDetails(plan, week, dag)
    }));
  return article;
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
        h("p", { text: dag.beschrijving || "Geen extra beschrijving." })),
    editButton,
    dag.type !== "rust" ? h("details", { class: "optional-trainingpeaks" },
      h("summary", { text: "Optioneel: gebruiken in TrainingPeaks AI" }),
      h("p", { class: "hint", text: "Kopieer de training als je TrainingPeaks gebruikt." }),
      h("button", {
        class: "btn ghost small", type: "button", text: "Kopieer trainingsprompt",
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
  const zone = h("select", {}, ZONE_OPTIONS.map(value =>
    h("option", { value, selected: (dag.zone || "") === value, text: value || "Geen zone" })));
  const title = h("input", { type: "text", maxlength: 80, value: dag.type === "rust" ? "" : dag.titel });
  const description = h("textarea", { rows: 3, maxlength: 500 }, dag.type === "rust" ? "" : dag.beschrijving);
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
      const done = busyButton(save, "Schema opslaan…", status);
      try {
        await api("POST", "/api/plan/workout", {
          week_no: week.week_no, day_no: dag.dag,
          workout: {
            type: type.value, minuten: minutes.value ? Number(minutes.value) : 0,
            zone: zone.value, titel: title.value, beschrijving: description.value
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
  h("div", { class: "row" }, save, cancel));
  return editor;
}

function weekVisual(plan, week) {
  const maxMinutes = Math.max(1, ...week.dagen.map(day => day.minuten || 0));
  return h("div", { class: "week-visual", role: "group", "aria-label": `Visueel weekoverzicht week ${week.week_no}` },
    ...week.dagen.map(day => {
      const date = addDays(plan.start_date, (week.week_no - 1) * 7 + day.dag);
      const minutes = day.minuten || 0;
      const barLevel = minutes ? Math.max(1, Math.ceil(minutes / maxMinutes * 5)) : 0;
      return h("button", {
        class: `week-visual-day ${day.type === "rust" ? "visual-rest" : `visual-${day.type}`}`,
        type: "button",
        "aria-label": `${DAGEN_KORT[day.dag]}, ${day.type === "rust" ? "rustdag" : `${TYPE_LABEL[day.type] || day.type}, ${minutesText(minutes)}`}. Details bekijken.`,
        onclick: () => openWorkoutDetails(plan, week, day)
      },
      h("span", { class: "visual-day-label", text: DAGEN_KORT[day.dag] }),
      h("span", { class: "visual-day-date", text: dateLabel(date).split(" ").slice(1).join(" ") }),
      h("span", { class: "visual-bar-track" },
        h("span", { class: `visual-bar visual-bar-level-${barLevel}` })),
      h("strong", { class: "visual-duration", text: minutes ? minutesText(minutes) : "Rust" }),
      h("span", { class: "visual-type", text: day.type === "rust" ? "Herstel" : TYPE_LABEL[day.type] || day.type }));
    }));
}

function checkinIsDue(plan, week) {
  return week.week_no < plan.total_weeks && !week.checkin &&
    todayIso() >= addDays(plan.start_date, week.week_no * 7);
}

function coachChat(plan, currentWeek) {
  const defaultDay = currentWeek.dagen.find(item => plan.intake.dagen.includes(item.dag) && item.type !== "rust")?.dag ?? plan.intake.dagen[0];
  const checkinDue = checkinIsDue(plan, currentWeek);
  const messages = h("div", { class: "chat", "aria-live": "polite", "aria-relevant": "additions text" });
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });
  const input = h("textarea", { id: "coach-input", rows: 2, maxlength: 1000, required: true, placeholder: "Typ een bericht…" }, state.coachDraft);
  const submit = h("button", { class: "chat-send", type: "submit", "aria-label": "Verstuur bericht", text: "➤" });
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
        h("p", { class: "chat-bubble", text: item.content }),
        item.updated ? h("span", { class: "hint", text: "Training bijgewerkt" }) : null,
        item.suggestion ? h("section", { class: "suggestion-card" },
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
      h("div", { class: "chat-bubble typing" },
        h("span", { class: "typing-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
        h("span", { class: "sr-only", text: "De coach is je bericht aan het verwerken" }))));
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
  const form = h("form", {
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
        const remaining = 800 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        input.value = "";
        state.coachDraft = "";
        state.data = await api("GET", "/api/plan");
        state.week = state.data.weeks[state.data.weeks.length - 1].week_no;
        if (reply.plan_updated) status.textContent = "Je volgende trainingsweek staat klaar.";
        viewCoach();
      } catch (e) {
        error.textContent = e.message;
        submit.disabled = false;
        submit.textContent = "➤";
        renderMessages(conversation);
        status.textContent = "";
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

function viewCoach() {
  state.page = "coach";
  renderNav("coach");
  if (!state.data?.plan) return viewIntake();
  const week = state.data.weeks[state.data.weeks.length - 1];
  state.week = week.week_no;
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "PERSOONLIJKE BEGELEIDING" }),
      h("h1", { text: "Coach" }),
      h("p", { class: "muted", text: "Eén doorlopend gesprek over je schema, trainingen en herstel." })),
    coachChat(state.data.plan, week)
  );
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

  show(
    h("div", { class: "dashboard-heading" },
      h("p", { class: "eyebrow", text: "JOUW TRAININGSDASHBOARD" }),
      h("h1", { text: plan.intake.doel })),
    plan.intake.leeftijd < 18 ? h("section", { class: "youth-notice" },
      h("h2", { text: "Jeugdrenner: train met begeleiding" }),
      h("p", { text: "Bespreek dit schema en je trainingsbelasting met je ouder/verzorger en een gekwalificeerde jeugdtrainer. De AI-coach is geen vervanging voor professionele begeleiding." })) : null,
    h("section", { class: "card stack" },
      h("p", { text: plan.summary }),
      h("p", { class: "muted", text: `${plan.total_weeks} weken, start ${dateLabel(plan.start_date)}. Je ziet steeds één week in detail; de volgende week maakt de coach nadat je hebt teruggemeld hoe het ging.` }),
      outline),
    week.waarschuwing ? h("p", { class: "warn", role: "alert", text: week.waarschuwing }) : null,
    h("section", { class: "stack" },
      h("div", { class: "row between" },
        h("h2", { text: `Week ${week.week_no}${outlineItem && outlineItem.focus ? ": " + outlineItem.focus : ""}` }),
        h("button", { class: "btn ghost small", type: "button", text: "Download agenda (.ics)", onclick: () => downloadIcs(plan, week) })),
      week.uitleg ? h("p", { class: "muted", text: week.uitleg }) : null,
      h("p", { class: "muted", text: `Totaal ${minutesText(week.totaal_minuten)}` }),
      weekVisual(plan, week),
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

// ---------- account ----------
function viewAccount() {
  state.page = "account";
  renderNav("account");
  const profile = state.profile || { birth_date: "", meter: "none" };
  const profileError = h("p", { class: "error", role: "alert" });
  const profileStatus = h("p", { class: "muted", role: "status" });
  const birthDate = h("input", {
    type: "date", min: "1900-01-01", max: todayIso(), required: true, value: profile.birth_date || ""
  });
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
            profile: { geboortedatum: birthDate.value, meter: meter.value, ...equipment.values() }
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
    field("Geboortedatum", birthDate),
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
