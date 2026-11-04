"use strict";

/* WielerSchema frontend. Bewust zonder innerHTML: alle tekst gaat via textContent (veilig tegen XSS). */

const DAGEN_KORT = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const TYPE_LABEL = {
  rust: "Rust", duurrit: "Duurrit", tempo: "Tempo", drempel: "Drempel", vo2max: "VO2max", sprint: "Sprint",
  kracht: "Kracht", techniek: "Techniek", herstelrit: "Herstelrit", race: "Wedstrijd"
};
const FASE_LABEL = { basis: "Basis", opbouw: "Opbouw", piek: "Piek", afbouw: "Afbouw", herstel: "Herstel" };

const app = document.getElementById("app");
const nav = document.getElementById("nav");
const sidebarAccount = document.getElementById("sidebar-account");
const coachLauncher = document.getElementById("coach-launcher");

const state = { user: null, data: null, week: 1, training: null, wellness: [], page: "plan" };

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
  if (!state.user) return;
  const pages = [
    ["plan", "Plan", () => state.data?.plan ? viewPlan() : viewIntake()],
    ["coach", "Coach", viewCoach],
    ["analytics", "Analyse", viewAnalytics],
    ["import", "TrainingPeaks-import", viewImport],
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
        state.wellness = [];
        state.training = null;
        viewAuth("login");
      }
    })
  );
  if (state.data?.plan) coachLauncher.appendChild(h("button", {
    class: "coach-launcher-button",
    type: "button",
    text: "Chat met je coach",
    "aria-label": "Open de coachchat",
    onclick: viewCoach
  }));
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
    ? h("label", { class: "check" }, consent, h("span", {}, "Ik ga akkoord met de ", h("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "privacyverklaring"), ". Mijn trainingsgegevens en eventuele gezondheidsgegevens mogen met een AI-dienst (Groq) worden verwerkt om mijn schema te maken."))
    : null,
  error,
  submit,
  h("p", { class: "muted" },
    mode === "login" ? "Nog geen account? " : "Heb je al een account? ",
    h("button", { class: "link", type: "button", text: mode === "login" ? "Maak er een" : "Log in", onclick: () => viewAuth(mode === "login" ? "register" : "login") }))
  );

  show(
    h("section", { class: "hero" },
      h("h1", { text: "Een trainingsschema dat met je meegroeit" }),
      h("p", { text: "Vertel wat je wilt bereiken. De AI-coach stelt eerst gerichte vragen, maakt een schema voor je beschikbare dagen en stuurt elke week bij op basis van hoe het ging." })),
    form
  );
}

// ---------- intake ----------
function viewIntake(prefill) {
  state.page = "plan";
  renderNav("plan");
  const p = prefill || {};
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });

  const doel = h("input", { type: "text", maxlength: 200, required: true, placeholder: "Bijvoorbeeld: toertocht van 120 km, of fitter worden", value: p.doel || "" });
  const datum = h("input", { type: "date", min: addDays(todayIso(), 7), value: p.datum || "" });
  const niveau = h("select", {}, ...[["beginner", "Beginner"], ["gevorderd", "Gevorderd"], ["ervaren", "Ervaren"], ["wedstrijd", "Wedstrijdrenner"]]
    .map(([v, t]) => h("option", { value: v, selected: (p.niveau || "gevorderd") === v, text: t })));
  const uren = h("input", { type: "number", min: 2, max: 25, step: 0.5, required: true, value: p.uren_per_week ?? 6 });
  const defaultMeter = p.meter !== undefined ? p.meter : prefill ? "none" : "";
  const meter = h("select", { required: true }, [
    ["", "Maak een keuze"],
    ["power", "Vermogensmeter"],
    ["heart_rate", "Hartslagmeter"],
    ["both", "Beide"],
    ["none", "Geen van beide"]
  ].map(([value, label]) => h("option", { value, selected: defaultMeter === value, text: label })));
  const dagenChecks = DAGEN_KORT.map((naam, i) => ({
    i, box: h("input", { type: "checkbox", checked: (p.dagen || [1, 3, 5, 6]).includes(i) }), naam
  }));
  const ftp = h("input", { type: "number", min: 80, max: 600, placeholder: "Optioneel", value: p.ftp ?? "" });
  const jaren = h("input", { type: "number", min: 0, max: 60, placeholder: "Optioneel", value: p.ervaring_jaren ?? "" });
  const beperkingen = h("textarea", { rows: 2, maxlength: 300, placeholder: "Optioneel, bijvoorbeeld een oude blessure. Vul alleen in wat je kwijt wilt." }, p.beperkingen || "");
  const opmerkingen = h("textarea", { rows: 2, maxlength: 400, placeholder: "Optioneel, bijvoorbeeld: ik werk onregelmatig of train vooral buiten." }, p.opmerkingen || "");
  const submit = h("button", { class: "btn", type: "submit", text: "Volgende: vragen van de coach" });

  function collect() {
    return {
      doel: doel.value, datum: datum.value || null, niveau: niveau.value, uren_per_week: Number(uren.value),
      dagen: dagenChecks.filter(d => d.box.checked).map(d => d.i),
      meter: meter.value,
      ftp: ftp.value ? Number(ftp.value) : null, ervaring_jaren: jaren.value ? Number(jaren.value) : null,
      beperkingen: beperkingen.value, opmerkingen: opmerkingen.value
    };
  }

  const form = h("form", {
    class: "card stack",
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = "";
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
  h("h2", { text: "Jouw doel en situatie" }),
  field("Wat is je doel?", doel),
  field("Datum van je doel", datum, "Optioneel. Zonder datum maak ik een schema van 8 weken."),
  h("div", { class: "grid2" }, field("Niveau", niveau), field("Uren per week (maximaal)", uren)),
  field("Welke meetapparatuur gebruik je?", meter),
  h("fieldset", { class: "days" }, h("legend", { text: "Op welke dagen kun je trainen?" }),
    ...dagenChecks.map(d => h("label", { class: "daybox" }, d.box, h("span", { text: d.naam })))),
  h("div", { class: "grid2" }, field("FTP in watt", ftp, "Alleen invullen als je een vermogensmeter gebruikt."), field("Jaren ervaring", jaren)),
  field("Beperkingen of klachten", beperkingen),
  field("Overige opmerkingen", opmerkingen),
  h("p", { class: "tip", text: "Wil je je eerdere ritten gebruiken? Je kunt TrainingPeaks-gegevens importeren via de zijbalk." }),
  error, status, submit
  );

  show(h("h1", { text: "Nieuw schema" }), form);
}

function viewImport() {
  state.page = "import";
  renderNav("import");
  const workouts = h("input", { type: "file", accept: ".zip,application/zip" });
  const summary = h("input", { type: "file", accept: ".zip,application/zip" });
  const metrics = h("input", { type: "file", accept: ".zip,application/zip" });
  const consent = h("input", { type: "checkbox" });
  const status = h("p", { class: "muted", role: "status" });
  const submit = h("button", {
    class: "btn", type: "button", text: "Bestanden importeren",
    onclick: async () => {
      status.textContent = "";
      const selected = [["workouts", workouts], ["summary", summary], ["metrics", metrics]]
        .filter(([, input]) => input.files && input.files.length)
        .map(([name, input]) => [name, input.files[0]]);
      if (!selected.length) { status.textContent = "Kies eerst minstens één ZIP-exportbestand."; return; }
      if (!consent.checked) { status.textContent = "Geef eerst toestemming om deze trainingsgegevens met Groq te verwerken."; return; }
      const formData = new FormData();
      for (const [name, file] of selected) formData.append(name, file);
      formData.append("ai_consent", "yes");
      submit.disabled = true;
      status.textContent = "De exports worden verwerkt…";
      try {
        const response = await fetch("/api/trainingpeaks/import", { method: "POST", credentials: "same-origin", body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "De exports konden niet worden geïmporteerd.");
        state.training = result.summary;
        state.page = "import";
        viewImport();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    }
  });
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "GEGEVENS" }),
      h("h1", { text: "TrainingPeaks importeren" }),
      h("p", { class: "muted", text: "Voeg maximaal één jaar aan workout- en Custom Metrics-exports toe. Dit is een bestandsimport, geen live koppeling." })),
    state.training ? h("section", { class: "card import-summary-card stack" },
      h("h2", { text: "Import beschikbaar voor je coach" }),
      h("p", { text: `${state.training.activities} ritten in ${state.training.weeks.length} weken.` }),
      h("p", { class: "muted", text: `Periode: ${state.training.period_start} t/m ${state.training.period_end}.` })) : null,
    h("section", { class: "card stack" },
      h("h2", { text: "Kies je ZIP-exporten" }),
      h("p", { class: "muted", text: "Ruwe bestanden worden alleen in het geheugen verwerkt. We bewaren weektotalen en gemiddelden zodat je coach ze kan gebruiken." }),
      field("Workout Files — ZIP met FIT-bestanden", workouts),
      field("Workout Summary — ZIP met CSV", summary),
      field("Custom Metrics — ZIP met CSV", metrics),
      h("p", { class: "hint", text: "Upload maximaal 20 MB tegelijk. Gegevens ouder dan 365 dagen worden genegeerd." }),
      h("label", { class: "check" }, consent, h("span", { text: "Ik geef toestemming om de geïmporteerde trainingsgegevens, inclusief eventuele gezondheidswaarden, met Groq te verwerken." })),
      status, submit)
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
  if (dag.type === "rust") {
    return h("article", { class: "day rest" }, h("h4", { text: `${DAGEN_KORT[dag.dag]} ${dateLabel(date).split(" ").slice(1).join(" ")}` }), h("p", { class: "muted", text: "Rust" }));
  }
  const copyStatus = h("span", { class: "hint", role: "status" });
  return h("article", { class: `day t-${dag.type}` },
    h("h4", { text: `${DAGEN_KORT[dag.dag]} ${dateLabel(date).split(" ").slice(1).join(" ")}` }),
    h("p", { class: "badge", text: `${TYPE_LABEL[dag.type] || dag.type}${dag.zone ? " · " + dag.zone : ""}` }),
    h("p", { class: "dur", text: minutesText(dag.minuten) }),
    h("p", { class: "dtitle", text: dag.titel }),
    dag.beschrijving ? h("p", { class: "muted", text: dag.beschrijving }) : null,
    h("button", {
      class: "btn ghost small", type: "button", text: "Kopieer prompt voor TrainingPeaks AI",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(trainingPeaksPrompt(plan, dag));
          copyStatus.textContent = "Prompt gekopieerd. Plak deze in TrainingPeaks.";
        } catch {
          copyStatus.textContent = "Kopiëren lukte niet. Controleer of je browser klembordtoegang toestaat.";
        }
      }
    }),
    copyStatus);
}

function checkinForm(plan, week) {
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });
  const pct = h("select", {}, ...[[100, "Alles"], [75, "Ongeveer driekwart"], [50, "De helft"], [25, "Een kwart"], [0, "Bijna niets"]]
    .map(([v, t]) => h("option", { value: v, text: t })));
  const uren = h("input", { type: "number", min: 0, max: 40, step: 0.5, placeholder: "Optioneel" });
  const gevoel = h("select", {}, ...[[1, "1. Heel zwaar of uitgeput"], [2, "2. Zwaar"], [3, "3. Prima"], [4, "4. Goed"], [5, "5. Heel goed"]]
    .map(([v, t]) => h("option", { value: v, text: t, selected: v === 3 })));
  const klachten = h("input", { type: "checkbox" });
  const opmerking = h("textarea", { rows: 2, maxlength: 300, placeholder: "Optioneel: wat ging goed, wat niet?" });
  const submit = h("button", { class: "btn", type: "submit", text: `Maak week ${week.week_no + 1}` });
  return h("form", {
    class: "card stack",
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = "";
      const done = busyButton(submit);
      status.textContent = "De coach past je volgende week aan…";
      try {
        const data = await api("POST", "/api/plan/checkin", {
          week_no: week.week_no, gedaan_pct: Number(pct.value), uren_gedaan: uren.value ? Number(uren.value) : null,
          gevoel: Number(gevoel.value), klachten: klachten.checked, opmerking: opmerking.value
        });
        state.data = data;
        state.week = data.weeks[data.weeks.length - 1].week_no;
        viewPlan();
      } catch (e) { error.textContent = e.message; status.textContent = ""; done(); }
    }
  },
  h("h3", { text: `Hoe ging week ${week.week_no}?` }),
  h("p", { class: "muted", text: "Op basis hiervan maakt de coach de volgende week." }),
  h("div", { class: "grid2" }, field("Hoeveel van het schema heb je gedaan?", pct), field("Uren getraind", uren)),
  field("Hoe voelde de week?", gevoel),
  h("label", { class: "check" }, klachten, h("span", { text: "Ik heb pijn, een blessure of ben ziek" })),
  field("Opmerking", opmerking),
  error, status, submit);
}

function coachChat(plan, weeks, currentWeek) {
  const contextWeek = h("select", {}, ...weeks.map(item =>
    h("option", { value: item.week_no, selected: item.week_no === currentWeek.week_no, text: `Week ${item.week_no}` })));
  const defaultDay = currentWeek.dagen.find(item => plan.intake.dagen.includes(item.dag) && item.type !== "rust")?.dag ?? plan.intake.dagen[0];
  const day = h("select", {}, ...plan.intake.dagen.map(index =>
    h("option", { value: index, selected: index === defaultDay, text: DAGEN_KORT[index] })));
  const messages = h("div", { class: "chat", "aria-live": "polite", "aria-relevant": "additions text" });
  const error = h("p", { class: "error", role: "alert" });
  const status = h("p", { class: "muted", role: "status" });
  const input = h("textarea", { id: "coach-input", rows: 3, maxlength: 1000, required: true, placeholder: "Vraag iets over je schema, training of herstel…" });
  const submit = h("button", { class: "btn", type: "submit", text: "Stuur naar de coach" });
  let loadId = 0;
  let conversation = [];
  const renderMessages = (items, thinking = false) => {
    clear(messages);
    if (!items.length && !thinking) messages.appendChild(h("div", { class: "chat-empty" },
      h("span", { class: "coach-avatar", "aria-hidden": "true", text: "W" }),
      h("p", { text: "Hoi! Ik ben je wielercoach. Vraag me iets over je schema, je trainingen of hoe je je voelt." }),
      h("p", { class: "hint", text: "Dit is één doorlopend gesprek. Kies een training als context wanneer je die wilt bespreken of aanpassen." })));
    for (const item of items) {
      messages.appendChild(h("div", { class: `chat-message ${item.role === "assistant" ? "coach" : "user"}` },
        h("div", { class: "chat-meta" },
          h("span", { class: "chat-label", text: item.role === "assistant" ? "WielerSchema-coach" : "Jij" }),
          item.week_no ? h("span", { class: "chat-context", text: `Week ${item.week_no} · ${DAGEN_KORT[item.day_no] || ""}` }) : null),
        h("p", { class: "chat-bubble", text: item.content }),
        item.updated ? h("span", { class: "hint", text: "Training bijgewerkt" }) : null,
        item.suggestion ? h("section", { class: "suggestion-card" },
          h("strong", { text: `${TYPE_LABEL[item.suggestion.workout.type] || "Training"} · ${minutesText(item.suggestion.workout.minuten)}` }),
          h("p", { text: item.suggestion.workout.titel }),
          h("p", { class: "muted", text: item.suggestion.workout.beschrijving }),
          item.suggestion.status === "pending"
            ? h("div", { class: "row" },
              h("button", { class: "btn small", type: "button", text: "Pas training aan", onclick: () => resolveSuggestion(item.suggestion.id, "apply") }),
              h("button", { class: "btn ghost small", type: "button", text: "Niet toepassen", onclick: () => resolveSuggestion(item.suggestion.id, "dismiss") }))
            : h("p", { class: "hint", text: item.suggestion.status === "applied" ? "Training aangepast" : "Voorstel niet toegepast" })) : null));
    }
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
      state.wellness = (await api("GET", "/api/wellness")).entries;
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
      submit.textContent = "De coach denkt na…";
      const startedAt = Date.now();
      renderMessages([...conversation, {
        role: "user", content: bericht, week_no: Number(contextWeek.value), day_no: Number(day.value)
      }], true);
      status.textContent = "Je bericht wordt verwerkt. Dit kan even duren…";
      try {
        await api("POST", "/api/coach/chat", {
          week_no: Number(contextWeek.value), day_no: Number(day.value), bericht, global: true
        });
        const remaining = 800 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        input.value = "";
        state.data = await api("GET", "/api/plan");
        state.wellness = (await api("GET", "/api/wellness")).entries;
        state.week = Number(contextWeek.value);
        viewCoach();
      } catch (e) {
        error.textContent = e.message;
        submit.disabled = false;
        submit.textContent = "Stuur naar de coach";
        renderMessages(conversation);
        status.textContent = "";
      }
    }
  },
  h("div", { class: "grid2 coach-context" },
    field("Week als context", contextWeek),
    field("Training als context", day)),
  h("p", { class: "hint", text: "Stel gerust een algemene vraag. Wil je iets aanpassen? Kies dan hierboven de training; alleen die training kan worden gewijzigd." }),
  messages,
  h("div", { class: "quick-prompts", "aria-label": "Voorbeeldvragen" },
    ...["Leg deze training uit", "Maak deze training lichter"].map(text =>
      h("button", { class: "prompt-chip", type: "button", text, onclick: () => { input.value = `${text}.`; input.focus(); } }))),
  field("Bericht aan de coach", input),
  h("p", { class: "hint", text: "De coach past geen andere trainingen aan. Voor TrainingPeaks kun je per workout een prompt kopiëren." }),
  error, status, h("div", { class: "row between coach-submit-row" },
    h("span", { class: "hint", text: "Je chat wordt bewaard bij je schema." }), submit));
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
  const week = state.data.weeks.find(item => item.week_no === state.week) || state.data.weeks[state.data.weeks.length - 1];
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "PERSOONLIJKE BEGELEIDING" }),
      h("h1", { text: "Coach" }),
      h("p", { class: "muted", text: "Eén doorlopend gesprek. De coach ziet je schema en je meest recente dagelijkse meetwaarden." })),
    coachChat(state.data.plan, state.data.weeks, week)
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
      h("div", { class: "days-grid" }, ...week.dagen.map(d => dayCard(plan, week, d))),
      h("p", { class: "muted", text: "De prompt wordt naar je klembord gekopieerd; plak hem daarna in TrainingPeaks AI. De hartslagdoelen gebruiken je daar ingestelde zones; er worden geen bpm-waarden verzonnen." }),
      week.tips ? h("p", { class: "tip", text: "Tip: " + week.tips }) : null),
    isLast && !finished ? checkinForm(plan, week) : null,
    h("section", { class: "card stack daily-metrics-promo" },
      h("h2", { text: "Hoe herstel je?" }),
      h("p", { class: "muted", text: "Vul je slaap, rusthartslag of Garmin Body Battery in. Je coach kan die gegevens meenemen in het gesprek." }),
      h("button", { class: "btn ghost", type: "button", text: "Dagmetingen en analyse bekijken", onclick: viewAnalytics })),
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

const WELLNESS_LABELS = {
  resting_hr: "Rusthartslag",
  sleep_hours: "Slaap",
  deep_sleep_hours: "Diepe slaap",
  light_sleep_hours: "Lichte slaap",
  rem_sleep_hours: "REM-slaap",
  awake_hours: "Wakker",
  body_battery_low: "Body Battery laag",
  body_battery_high: "Body Battery hoog",
  stress_avg: "Gemiddelde stress",
  hrv_ms: "HRV"
};
const WELLNESS_UNITS = {
  resting_hr: "bpm", sleep_hours: "u", deep_sleep_hours: "u", light_sleep_hours: "u",
  rem_sleep_hours: "u", awake_hours: "u", body_battery_low: "/100", body_battery_high: "/100",
  stress_avg: "/100", hrv_ms: "ms"
};

function viewAnalytics() {
  state.page = "analytics";
  renderNav("analytics");
  const entries = state.wellness || [];
  const todayEntry = entries.find(entry => entry.date === todayIso());
  const todayMetrics = todayEntry || {};
  const metricInputs = {};
  const metricField = (key, min, max, step = 1) => {
    const input = h("input", {
      type: "number", min, max, step, name: key, placeholder: "Optioneel",
      value: todayMetrics[key] ?? ""
    });
    metricInputs[key] = input;
    return field(`${WELLNESS_LABELS[key]} (${WELLNESS_UNITS[key]})`, input);
  };
  const date = h("input", { type: "date", max: todayIso(), min: addDays(todayIso(), -365), value: todayIso(), required: true });
  const note = h("textarea", { rows: 2, maxlength: 300, placeholder: "Optioneel" }, todayMetrics.note || "");
  const saveStatus = h("p", { class: "muted", role: "status" });
  const save = h("button", { class: "btn", type: "submit", text: todayEntry ? "Metingen bijwerken" : "Dagmetingen opslaan" });
  date.addEventListener("change", () => {
    const entry = entries.find(item => item.date === date.value);
    for (const [key, input] of Object.entries(metricInputs)) input.value = entry?.[key] ?? "";
    note.value = entry?.note || "";
    save.textContent = entry ? "Metingen bijwerken" : "Dagmetingen opslaan";
  });
  const form = h("form", {
    class: "card stack",
    onsubmit: async event => {
      event.preventDefault();
      save.disabled = true;
      saveStatus.textContent = "Dagmetingen opslaan…";
      const metrics = Object.fromEntries(Object.entries(metricInputs)
        .filter(([, input]) => input.value !== "")
        .map(([key, input]) => [key, Number(input.value)]));
      metrics.note = note.value;
      try {
        state.wellness = (await api("POST", "/api/wellness", { date: date.value, metrics })).entries;
        viewAnalytics();
      } catch (error) {
        saveStatus.textContent = error.message;
        save.disabled = false;
      }
    }
  },
  h("h2", { text: "Dagmetingen toevoegen" }),
  h("p", { class: "muted", text: "Vul waarden van je horloge over, bijvoorbeeld Garmin Health. Lege velden worden niet opgeslagen. Dit is handmatige invoer, geen Garmin-koppeling." }),
  field("Datum", date),
  h("div", { class: "metrics-form-grid" },
    metricField("resting_hr", 25, 250),
    metricField("sleep_hours", 0, 24, 0.01),
    metricField("deep_sleep_hours", 0, 24, 0.01),
    metricField("light_sleep_hours", 0, 24, 0.01),
    metricField("rem_sleep_hours", 0, 24, 0.01),
    metricField("awake_hours", 0, 24, 0.01),
    metricField("body_battery_low", 0, 100),
    metricField("body_battery_high", 0, 100),
    metricField("stress_avg", 0, 100),
    metricField("hrv_ms", 0, 500, 0.1)),
  field("Notitie", note),
  h("p", { class: "hint", text: "Herstelwaarden zijn persoonlijke signalen. Ze stellen geen diagnose; bespreek zorgen met een zorgprofessional." }),
  saveStatus, save);

  const weeks = (state.training?.weeks || []).slice(-12);
  const recent = weeks.slice(-4);
  const sum = key => recent.reduce((total, item) => total + (Number(item[key]) || 0), 0);
  const weightedAverage = key => {
    const values = recent.filter(item => Number.isFinite(item[key]) && item.hours > 0);
    const hours = values.reduce((total, item) => total + item.hours, 0);
    return hours ? Math.round(values.reduce((total, item) => total + item[key] * item.hours, 0) / hours) : null;
  };
  const maxHours = Math.max(1, ...weeks.map(item => Number(item.hours) || 0));
  const bars = weeks.length ? h("div", { class: "volume-chart", role: "img", "aria-label": "Trainingsuren per week" },
    ...weeks.map(item => h("div", { class: "volume-column", title: `${dateLabel(item.week_start)}: ${item.hours} uur` },
      h("span", { class: "volume-value", text: `${item.hours}u` }),
      h("div", { class: "volume-track" },
        h("div", { class: "volume-bar", style: `height:${Math.max(3, Math.round((Number(item.hours) || 0) / maxHours * 100))}%` })),
      h("span", { class: "volume-date", text: dateLabel(item.week_start).slice(0, 6) })))) : null;
  const customNames = [...new Set((state.training?.weeks || []).flatMap(item => Object.keys(item.metrics || {})))];
  const customRows = customNames.map(name => {
    const latest = [...(state.training?.weeks || [])].reverse().find(item => item.metrics && item.metrics[name] !== undefined);
    return latest ? h("div", { class: "metric-row" },
      h("span", { text: name }), h("strong", { text: `${latest.metrics[name]} · week ${dateLabel(latest.week_start)}` })) : null;
  });
  show(
    h("div", { class: "page-heading" },
      h("p", { class: "eyebrow", text: "JOUW TRENDS" }),
      h("h1", { text: "Analyse" }),
      h("p", { class: "muted", text: "Gebaseerd op je geïmporteerde TrainingPeaks-weektotalen en handmatige dagmetingen." })),
    h("section", { class: "stats-grid" },
      ...[
        ["Trainingsuren · 4 weken", `${sum("hours").toFixed(1)} u`],
        ["Ritten · 4 weken", String(sum("rides"))],
        ["Afstand · 4 weken", `${Math.round(sum("distance_km"))} km`],
        ["Gemiddeld vermogen", weightedAverage("avg_power") === null ? "—" : `${weightedAverage("avg_power")} W`],
        ["Gemiddelde hartslag", weightedAverage("avg_heart_rate") === null ? "—" : `${weightedAverage("avg_heart_rate")} bpm`]
      ].map(([label, value]) => h("article", { class: "stat-card" },
        h("span", { class: "hint", text: label }), h("strong", { text: value })))),
    h("section", { class: "card stack" },
      h("div", { class: "row between" }, h("h2", { text: "Trainingsvolume" }), h("span", { class: "hint", text: "Uren per week · laatste 12 weken" })),
      bars || h("p", { class: "muted", text: "Importeer TrainingPeaks-gegevens om je trainingsvolume te zien." })),
    customNames.length ? h("section", { class: "card stack" },
      h("h2", { text: "Eigen TrainingPeaks-metrics" }),
      ...customRows) : null,
    form,
    h("section", { class: "card stack" },
      h("h2", { text: "Recente dagmetingen" }),
      entries.length ? h("div", { class: "wellness-list" },
        ...entries.slice(0, 10).map(entry => h("article", { class: "wellness-entry" },
          h("strong", { text: dateLabel(entry.date) }),
          h("div", { class: "wellness-values" },
            ...Object.entries(WELLNESS_LABELS).filter(([key]) => entry[key] !== undefined)
              .map(([key, label]) => h("span", { class: "wellness-value" }, `${label}: `, h("strong", { text: `${entry[key]} ${WELLNESS_UNITS[key]}` }))),
            entry.note ? h("span", { class: "wellness-value", text: entry.note }) : null)))) :
        h("p", { class: "muted", text: "Nog geen dagmetingen ingevoerd." })),
    h("p", { class: "hint", text: "Dit dashboard toont meetwaarden, geen diagnose. De coach kan mogelijke veranderingen bespreken maar kan overtraining niet vaststellen." })
  );
}

// ---------- account ----------
function viewAccount() {
  state.page = "account";
  renderNav("account");
  const error = h("p", { class: "error", role: "alert" });
  const password = h("input", { type: "password", autocomplete: "current-password", required: true });
  const submit = h("button", { class: "btn danger", type: "submit", text: "Account en gegevens verwijderen" });
  show(
    h("h1", { text: "Account" }),
    h("section", { class: "card stack" },
      h("p", {}, "Ingelogd als ", h("strong", { text: state.user })),
      h("p", {}, h("a", { class: "btn ghost", href: "/api/account/export", download: "wielerschema-gegevens.json", text: "Download mijn gegevens (JSON)" }))),
    h("form", {
      class: "card stack",
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        if (!confirm("Weet je het zeker? Dit verwijdert je account en je schema definitief.")) return;
        const done = busyButton(submit);
        try { await api("POST", "/api/account/delete", { password: password.value }); state.user = null; state.data = null; start(); }
        catch (e) { error.textContent = e.message; done(); }
      }
    },
    h("h2", { text: "Account verwijderen" }),
    h("p", { class: "muted", text: "Dit verwijdert je account, schema, chat, TrainingPeaks-samenvatting en dagelijkse metingen. Dat kan niet ongedaan worden gemaakt." }),
    field("Wachtwoord ter bevestiging", password), error, submit)
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
    state.training = (await api("GET", "/api/trainingpeaks")).summary;
    state.wellness = (await api("GET", "/api/wellness")).entries;
    if (state.data.plan) {
      state.week = state.data.weeks[state.data.weeks.length - 1].week_no;
      state.page = "plan";
      viewPlan();
    } else viewIntake();
  } catch (e) {
    if (e.status === 401) { state.user = null; viewAuth("login"); }
    else show(h("p", { class: "error", text: e.message }));
  }
}

start();
