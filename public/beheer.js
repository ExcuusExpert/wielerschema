"use strict";
/* Beheerpagina: inloggen met een gewoon account dat in ADMIN_USERS staat. Alle tekst gaat via textContent. */
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const date = iso => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  let accounts = [];

  async function call(method, path, body) {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.message || "Mislukt."); err.status = res.status; throw err; }
    return data;
  }
  function view(name) { ["login", "denied", "dash"].forEach(id => { $(id).hidden = id !== name; }); $("logout").hidden = name === "login"; }

  async function start() {
    let me;
    try { me = await call("GET", "/api/me"); } catch { view("login"); $("who").textContent = ""; return; }
    $("who").textContent = me.username;
    if (!me.beheerder) { view("denied"); return; }
    view("dash");
    await load();
  }
  async function load() {
    try {
      const data = await call("GET", "/api/admin/users");
      accounts = data.accounts;
      $("n-total").textContent = String(data.totaal);
      $("n-pas").textContent = String(data.met_pas);
      $("n-new").textContent = String(accounts.filter(a => Date.now() - new Date(a.aangemaakt) < 7 * 86400000).length);
      render();
    } catch (e) { $("msg").textContent = e.message; }
  }
  function status(a) {
    if (a.pas_tot) return { text: "Pas tot " + date(a.pas_tot), cls: "ok" };
    if (a.pas_verlopen) return { text: "Pas verlopen", cls: "off" };
    return { text: "Gratis", cls: "free" };
  }
  function render() {
    const q = $("q").value.trim().toLowerCase(), only = $("only-pas").checked, list = $("list");
    list.replaceChildren();
    const shown = accounts.filter(a => (!q || a.gebruiker.includes(q)) && (!only || a.pas_tot));
    if (!shown.length) { list.appendChild(el("p", "muted", "Geen accounts gevonden.")); return; }
    shown.forEach(a => {
      const row = el("article", "admin-row");
      const info = el("div", "admin-info");
      const name = el("strong", "", a.gebruiker);
      if (a.beheerder) name.appendChild(el("span", "admin-tag", "beheerder"));
      const st = status(a);
      info.append(name,
        el("span", "admin-status " + st.cls, st.text),
        el("span", "muted small-text", "Aangemaakt " + date(a.aangemaakt) + (a.schema ? ` · schema van ${a.schema.weken} weken` : " · nog geen schema") + (a.koppeling ? " · Intervals.icu gekoppeld" : "")));
      const actions = el("div", "admin-actions");
      const weeks = el("select"); weeks.setAttribute("aria-label", "Aantal weken pas voor " + a.gebruiker);
      [[8, "8 weken"], [4, "4 weken"], [16, "16 weken"]].forEach(([v, t]) => { const o = el("option", "", t); o.value = String(v); weeks.appendChild(o); });
      const grant = el("button", "btn small", a.pas_tot ? "Verlengen" : "Pas aanzetten"); grant.type = "button";
      grant.addEventListener("click", () => act(grant, "/api/admin/pass", { username: a.gebruiker, weeks: Number(weeks.value) }, `Pas voor ${a.gebruiker} bijgewerkt.`));
      actions.append(weeks, grant);
      if (a.pas_tot) {
        const revoke = el("button", "btn ghost small", "Intrekken"); revoke.type = "button";
        revoke.addEventListener("click", () => { if (confirm(`Pas van ${a.gebruiker} intrekken?`)) act(revoke, "/api/admin/pass", { username: a.gebruiker, intrekken: true }, `Pas van ${a.gebruiker} ingetrokken.`); });
        actions.appendChild(revoke);
      }
      if (!a.beheerder) {
        const del = el("button", "btn ghost small danger", "Verwijderen"); del.type = "button";
        del.addEventListener("click", () => {
          const typed = prompt(`Account en alle gegevens van ${a.gebruiker} verwijderen? Dit kan niet ongedaan worden gemaakt.\n\nTyp de gebruikersnaam ter bevestiging:`);
          if (typed !== null) act(del, "/api/admin/delete", { username: a.gebruiker, bevestig: typed.trim().toLowerCase() }, `${a.gebruiker} is verwijderd.`);
        });
        actions.appendChild(del);
      }
      row.append(info, actions);
      list.appendChild(row);
    });
  }
  async function act(button, path, body, done) {
    button.disabled = true; $("msg").textContent = "";
    try { await call("POST", path, body); $("msg").textContent = done; await load(); }
    catch (e) { $("msg").textContent = e.message; button.disabled = false; }
  }

  $("login-form").addEventListener("submit", async event => {
    event.preventDefault(); $("login-msg").textContent = "";
    try { await call("POST", "/api/login", { username: $("u").value, password: $("p").value }); $("p").value = ""; await start(); }
    catch (e) { $("login-msg").textContent = e.message || "Inloggen mislukt."; }
  });
  $("logout").addEventListener("click", async () => { try { await call("POST", "/api/logout"); } catch { /* al uitgelogd */ } accounts = []; $("who").textContent = ""; view("login"); });
  $("q").addEventListener("input", render);
  $("only-pas").addEventListener("change", render);
  $("refresh").addEventListener("click", load);
  start();
})();