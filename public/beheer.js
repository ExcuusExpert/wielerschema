"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const fmt = iso => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  async function call(method, body) {
    const res = await fetch("/api/admin/pass", {
      method, headers: { Authorization: "Bearer " + $("token").value, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error("Token klopt niet.");
    if (!res.ok) throw new Error(data.message || "Mislukt.");
    return data;
  }
  async function refresh() {
    const list = $("list");
    try {
      const data = await call("GET");
      list.replaceChildren();
      if (!data.passen.length) { const li = document.createElement("li"); li.textContent = "Geen actieve passen."; list.appendChild(li); }
      data.passen.forEach(p => { const li = document.createElement("li"); li.textContent = p.gebruiker + " tot " + fmt(p.verloopt); list.appendChild(li); });
    } catch (e) { $("msg").textContent = e.message; }
  }
  async function act(button, body, text) {
    const name = $("user").value.trim().toLowerCase();
    if (!name) { $("msg").textContent = "Vul een gebruikersnaam in."; return; }
    button.disabled = true; $("msg").textContent = "";
    try {
      const data = await call("POST", { username: name, note: $("note").value, ...body });
      $("msg").textContent = data.verloopt ? `${text} ${name}: pas actief tot ${fmt(data.verloopt)}.` : `${text} ${name}.`;
      await refresh();
    } catch (e) { $("msg").textContent = e.message; }
    button.disabled = false;
  }
  $("grant").addEventListener("click", () => act($("grant"), { weeks: 8 }, "Gelukt voor"));
  $("revoke").addEventListener("click", () => { if (confirm("Pas van deze gebruiker intrekken?")) act($("revoke"), { intrekken: true }, "Pas ingetrokken voor"); });
  $("refresh").addEventListener("click", refresh);
})();
