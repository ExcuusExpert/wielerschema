/* Rekenregels van de WielerSchema-rekentools. Dezelfde grenzen als in de app, zodat de uitkomst overeenkomt. */
(function (root) {
  "use strict";
  const round = Math.round;
  const HR_FACTORS = [0.6, 0.7, 0.8, 0.9, 1];
  const POWER_FACTORS = { 5: [0.55, 0.75, 0.9, 1.05], 7: [0.55, 0.75, 0.9, 1.05, 1.2, 1.5] };
  const HR_ZONES = [
    ["Herstel", "Heel rustig trappen: herstel, warming-up en cooling-down."],
    ["Duur", "Basisconditie. Je kunt makkelijk een gesprek voeren."],
    ["Tempo", "Stevig doorrijden. Praten lukt nog in korte zinnen."],
    ["Drempel", "Hard, maar vol te houden. Voor intervallen."],
    ["Maximaal", "Zeer zwaar. Alleen voor korte inspanningen."]
  ];
  const POWER_ZONES = {
    7: [
      ["Actief herstel", "Heel licht trappen om te herstellen."],
      ["Duur", "Lange, rustige ritten voor basisconditie."],
      ["Tempo", "Stevig en constant tempo."],
      ["Drempel", "Rond je FTP. Lange intervallen van 8 tot 20 minuten."],
      ["VO2max", "Zware intervallen van 3 tot 8 minuten."],
      ["Anaeroob", "Korte, zeer zware inspanningen van 30 seconden tot 3 minuten."],
      ["Neuromusculair", "Sprints en maximale starts van enkele seconden."]
    ],
    5: [
      ["Herstel", "Heel licht trappen om te herstellen."],
      ["Duur", "Lange, rustige ritten voor basisconditie."],
      ["Tempo", "Stevig en constant tempo."],
      ["Drempel", "Rond je FTP. Lange intervallen."],
      ["Boven drempel", "Alles boven je FTP: zware, korte inspanningen."]
    ]
  };

  // Bovengrenzen per zone. Karvonen rekent met de hartslagreserve (maximum min rust).
  function hrLimits(max, rest, method) {
    const at = method === "karvonen" ? factor => round(rest + factor * (max - rest)) : factor => round(max * factor);
    return HR_FACTORS.map(at);
  }
  function powerLimits(ftp, count) { return POWER_FACTORS[count].map(factor => round(ftp * factor)); }
  // Bereik per zone: eerste zone "tot", laatste zone bij vermogen "boven", de rest "van–tot"
  function ranges(limits, count) {
    return Array.from({ length: count }, (_, index) => {
      const upper = limits[index];
      if (index === 0) return { from: null, to: upper };
      return upper === undefined ? { from: limits[index - 1] + 1, to: null } : { from: limits[index - 1] + 1, to: upper };
    });
  }
  function rangeText(range, unit) {
    if (range.from === null) return "≤ " + range.to + " " + unit;
    if (range.to === null) return "> " + (range.from - 1) + " " + unit;
    return range.from + "–" + range.to + " " + unit;
  }
  const tanaka = age => round(208 - 0.7 * age);
  const TEST_FACTORS = { twenty: 0.95, eight: 0.9, ramp: 0.75 };
  const ftpFromTest = (kind, value) => round(value * TEST_FACTORS[kind]);
  const wattsPerKg = (ftp, kg) => round(ftp / kg * 100) / 100;

  const api = { HR_ZONES, POWER_ZONES, hrLimits, powerLimits, ranges, rangeText, tanaka, ftpFromTest, wattsPerKg };
  if (typeof module === "object" && module.exports) module.exports = api; else root.WSZones = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
