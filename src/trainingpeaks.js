import FitParser from "fit-file-parser";
import { Unzip, UnzipInflate } from "fflate";

const DAY_MS = 86400000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_CSV_ROWS = 10000;

function csvRows(text) {
  const rows = [];
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  let commas = 0, semicolons = 0, tabs = 0, quotedHeader = false;
  for (let i = 0; i < firstLine.length; i++) {
    if (firstLine[i] === '"' && firstLine[i + 1] === '"') i++;
    else if (firstLine[i] === '"') quotedHeader = !quotedHeader;
    else if (!quotedHeader && firstLine[i] === ",") commas++;
    else if (!quotedHeader && firstLine[i] === ";") semicolons++;
    else if (!quotedHeader && firstLine[i] === "\t") tabs++;
  }
  const delimiter = tabs > commas && tabs > semicolons ? "\t" : semicolons > commas ? ";" : ",";
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell); cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  if (rows.length > MAX_CSV_ROWS + 1) throw new Error("Een CSV-bestand bevat te veel regels.");
  return rows;
}

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dateValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let date;
  const euro = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+.*)?$/);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  else if (euro) {
    const first = Number(euro[1]), second = Number(euro[2]), year = Number(euro[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    date = new Date(Date.UTC(year, month - 1, day));
  } else date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberValue(value) {
  const text = String(value || "").trim().replace(/\s/g, "");
  if (!text) return null;
  const normalizedNumber = text.includes(",") && !text.includes(".")
    ? text.replace(",", ".")
    : text.replace(/,(?=\d{3}(?:\D|$))/g, "");
  const number = Number(normalizedNumber.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function durationMinutes(value, header) {
  const text = String(value || "").trim();
  const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const hours = Number(clock[1]), minutes = Number(clock[2]), seconds = Number(clock[3] || 0);
    return hours * 60 + minutes + seconds / 60;
  }
  const number = numberValue(text);
  if (number === null) return 0;
  const column = normalized(header);
  if (column.includes("minute")) return number;
  if (column.includes("hour")) return number * 60;
  if (column.includes("second") || number > 180) return number / 60;
  if (number > 0 && number < 1) return number * 1440;
  return number;
}

function columnIndex(headers, candidates) {
  const normalizedHeaders = headers.map(normalized);
  for (const candidate of candidates) {
    const index = normalizedHeaders.indexOf(candidate);
    if (index >= 0) return index;
  }
  return normalizedHeaders.findIndex(header => candidates.some(candidate => candidate.length > 4 && header.includes(candidate)));
}

function parseWorkoutCsv(bytes, cutoff, now) {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dateCol = columnIndex(headers, ["date", "workoutdate", "workoutday", "startdate", "starttime", "workoutstarttime", "activitydate", "datetime", "timestamp"]);
  if (dateCol < 0) throw new Error("De datumkolom in Workout Summary CSV is niet herkend.");
  const durationCol = columnIndex(headers, ["durationseconds", "durationminutes", "totaltimertime", "movingtime", "workoutduration", "elapsedtime", "duration"]);
  const distanceCol = columnIndex(headers, ["distancekm", "totaldistance", "distance"]);
  const powerCol = columnIndex(headers, ["averagepower", "avgpower", "normalizedpower", "avgwatts"]);
  const heartCol = columnIndex(headers, ["averageheartrate", "avgheartrate", "averagehr", "avghr"]);
  const nameCol = columnIndex(headers, ["activityname", "workoutname", "workouttitle", "activitytitle", "title", "name"]);
  const sportCol = columnIndex(headers, ["sport", "sporttype", "activitytype", "workouttype"]);
  const activities = [];
  for (const row of rows.slice(1)) {
    const date = dateValue(row[dateCol]);
    if (!date || date < cutoff || date > now) continue;
    const duration = durationCol >= 0 ? durationMinutes(row[durationCol], headers[durationCol]) : 0;
    const rawDistance = distanceCol >= 0 ? numberValue(row[distanceCol]) : null;
    const distanceHeader = normalized(headers[distanceCol]);
    const distance = rawDistance === null ? 0
      : distanceHeader.includes("mile") || distanceHeader.includes("distancemi") ? rawDistance * 1.60934
        : distanceHeader.includes("km") || rawDistance < 1000 ? rawDistance : rawDistance / 1000;
    activities.push({
      date: date.toISOString().slice(0, 10),
      name: nameCol < 0 ? "" : String(row[nameCol] || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").trim().slice(0, 80),
      sport: sportCol < 0 ? "cycling" : normalizeSport(row[sportCol]),
      minutes: Math.min(1440, Math.max(0, duration)),
      distance_km: Math.min(1000, Math.max(0, distance)),
      power: powerCol < 0 ? null : numberValue(row[powerCol]),
      heart_rate: heartCol < 0 ? null : numberValue(row[heartCol])
    });
  }
  return activities;
}

function normalizeSport(value) {
  const sport = normalized(value);
  if (/run|lopen|hardlopen/.test(sport)) return "running";
  if (/swim|zwem/.test(sport)) return "swimming";
  if (/ski|skate|schaats/.test(sport)) return "skating";
  if (/bike|cycl|fiets|mtb|ride/.test(sport)) return "cycling";
  return "other";
}

function parseMetricsCsv(bytes, cutoff, now) {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dateCol = columnIndex(headers, ["date", "metricdate", "datetime", "timestamp", "day"]);
  if (dateCol < 0) throw new Error("De datumkolom in Custom Metrics CSV is niet herkend.");
  const metricCols = headers.map((header, index) => ({
    index, name: String(header).replace(/[^a-zA-Z0-9 _()-]/g, "").trim().slice(0, 50)
  }))
    .filter(col => col.index !== dateCol && col.name && !["id", "username", "athlete", "notes", "comment"].includes(normalized(col.name)))
    .slice(0, 30);
  const values = [];
  for (const row of rows.slice(1)) {
    const date = dateValue(row[dateCol]);
    if (!date || date < cutoff || date > now) continue;
    const metrics = {};
    for (const col of metricCols) {
      const value = numberValue(row[col.index]);
      if (value !== null && Math.abs(value) <= 100000) metrics[col.name] = value;
    }
    if (Object.keys(metrics).length) values.push({ date: date.toISOString().slice(0, 10), metrics });
  }
  return values;
}

async function unzipEntries(bytes, budget) {
  return new Promise((resolve, reject) => {
    const entries = [];
    let pending = 0;
    let inputDone = false;
    let settled = false;
    const finish = () => {
      if (!settled && inputDone && pending === 0) { settled = true; resolve(entries); }
    };
    const fail = error => {
      if (!settled) { settled = true; reject(error instanceof Error ? error : new Error("Een ZIP-bestand kon niet worden gelezen.")); }
    };
    const unzip = new Unzip(file => {
      if (settled || file.name.endsWith("/")) return;
      budget.files++;
      if (budget.files > MAX_FILES) return fail(new Error("De export bevat te veel bestanden."));
      if (file.originalSize > MAX_FILE_BYTES || budget.total + file.originalSize > MAX_UNZIPPED_BYTES) {
        return fail(new Error("De uitgepakte export is te groot."));
      }
      pending++;
      let size = 0;
      const chunks = [];
      file.ondata = (error, chunk, final) => {
        if (error) return fail(error);
        size += chunk.length;
        budget.total += chunk.length;
        if (size > MAX_FILE_BYTES || budget.total > MAX_UNZIPPED_BYTES) return fail(new Error("De uitgepakte export is te groot."));
        chunks.push(chunk);
        if (final) {
          const contents = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) { contents.set(part, offset); offset += part.length; }
          entries.push({ name: file.name, contents });
          pending--;
          finish();
        }
      };
      try { file.start(); } catch (error) { fail(error); }
    });
    unzip.register(UnzipInflate);
    try { unzip.push(bytes, true); inputDone = true; finish(); } catch (error) { fail(error); }
  });
}

async function flattenArchive(bytes, budget, depth = 0) {
  if (depth > 2) throw new Error("De ZIP-export is te diep genest.");
  const entries = await unzipEntries(bytes, budget);
  const files = [];
  for (const entry of entries) {
    if (/\.zip$/i.test(entry.name)) files.push(...await flattenArchive(entry.contents, budget, depth + 1));
    else files.push(entry);
  }
  return files;
}

function weekStart(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function addActivity(bucket, activity, source) {
  const prefix = source === "fit" ? "fit" : "csv";
  bucket[`${prefix}_rides`] = (bucket[`${prefix}_rides`] || 0) + 1;
  bucket[`${prefix}_minutes`] = (bucket[`${prefix}_minutes`] || 0) + activity.minutes;
  bucket[`${prefix}_distance_km`] = (bucket[`${prefix}_distance_km`] || 0) + activity.distance_km;
  if (activity.power > 0) {
    bucket[`${prefix}_power_total`] = (bucket[`${prefix}_power_total`] || 0) + activity.power * Math.max(activity.minutes, 1);
    bucket[`${prefix}_power_minutes`] = (bucket[`${prefix}_power_minutes`] || 0) + Math.max(activity.minutes, 1);
  }
  if (activity.heart_rate > 0) {
    bucket[`${prefix}_hr_total`] = (bucket[`${prefix}_hr_total`] || 0) + activity.heart_rate * Math.max(activity.minutes, 1);
    bucket[`${prefix}_hr_minutes`] = (bucket[`${prefix}_hr_minutes`] || 0) + Math.max(activity.minutes, 1);
  }
}

export async function parseTrainingPeaks(files, now = new Date()) {
  const cutoff = new Date(now.getTime() - 365 * DAY_MS);
  const budget = { files: 0, total: 0 };
  const activities = [];
  const metrics = [];
  let uploadedBytes = 0;
  for (const file of files) {
    if (!file) continue;
    if (!/\.zip$/i.test(file.name)) throw new Error("Upload de ZIP-exportbestanden uit TrainingPeaks.");
    uploadedBytes += file.bytes.length;
    if (uploadedBytes > MAX_UPLOAD_BYTES) throw new Error("De totale ZIP-upload mag maximaal 20 MB zijn.");
    const entries = await flattenArchive(file.bytes, budget);
    for (const entry of entries) {
      if (/\.fit$/i.test(entry.name) && file.kind === "workouts") {
        const parsed = await new FitParser({ force: false }).parseAsync(entry.contents);
        const session = parsed.sessions?.[0] || {};
        const date = dateValue(session.start_time || session.timestamp);
        if (!date || date < cutoff || date > now) continue;
        activities.push({
          date: date.toISOString().slice(0, 10),
          name: "",
          sport: normalizeSport(session.sport),
          minutes: Math.min(1440, Math.max(0, Number(session.total_timer_time || session.total_elapsed_time || 0) / 60)),
          distance_km: Math.min(1000, Math.max(0, Number(session.total_distance || 0) / 1000)),
          power: Number(session.avg_power) || null,
          heart_rate: Number(session.avg_heart_rate) || null,
          source: "fit"
        });
      } else if (/\.csv$/i.test(entry.name)) {
        if (file.kind === "metrics") metrics.push(...parseMetricsCsv(entry.contents, cutoff, now));
        else if (file.kind === "summary") activities.push(...parseWorkoutCsv(entry.contents, cutoff, now).map(activity => ({ ...activity, source: "csv" })));
      }
    }
  }
  if (!budget.files) throw new Error("Er zijn geen bestanden in de ZIP-exports gevonden.");
  const weeks = new Map();
  const getWeek = date => {
    const key = weekStart(date);
    if (!weeks.has(key)) weeks.set(key, { week_start: key });
    return weeks.get(key);
  };
  for (const activity of activities) addActivity(getWeek(activity.date), activity, activity.source || "csv");
  const metricTotals = new Map();
  for (const item of metrics) {
    const week = getWeek(item.date);
    for (const [name, value] of Object.entries(item.metrics)) {
      const current = metricTotals.get(`${week.week_start}|${name}`) || { total: 0, count: 0 };
      current.total += value; current.count++;
      metricTotals.set(`${week.week_start}|${name}`, current);
    }
  }
  const metricNames = new Set();
  for (const [key, values] of metricTotals) {
    const [weekStartDate, name] = key.split("|");
    const week = weeks.get(weekStartDate);
    if (!week.metrics) week.metrics = {};
    week.metrics[name] = Math.round(values.total / values.count * 10) / 10;
    metricNames.add(name);
  }
  const summaries = [...weeks.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)).map(week => {
    const fit = (week.fit_rides || 0) > 0;
    const rides = Math.max(week.fit_rides || 0, week.csv_rides || 0);
    const minutes = Math.max(week.fit_minutes || 0, week.csv_minutes || 0);
    const distance = Math.max(week.fit_distance_km || 0, week.csv_distance_km || 0);
    const powerSource = fit && week.fit_power_minutes ? "fit" : "csv";
    const hrSource = fit && week.fit_hr_minutes ? "fit" : "csv";
    const average = (source, kind) => {
      const duration = week[`${source}_${kind}_minutes`] || 0;
      return duration ? Math.round(week[`${source}_${kind}_total`] / duration) : null;
    };
    const metricsForWeek = week.metrics && Object.keys(week.metrics).length ? week.metrics : null;
    return {
      week_start: week.week_start,
      rides,
      hours: Math.round(minutes / 60 * 10) / 10,
      distance_km: Math.round(distance * 10) / 10,
      avg_power: average(powerSource, "power"),
      avg_heart_rate: average(hrSource, "hr"),
      ...(metricsForWeek ? { metrics: metricsForWeek } : {})
    };
  });
  return {
    imported_at: now.toISOString(),
    period_start: cutoff.toISOString().slice(0, 10),
    period_end: now.toISOString().slice(0, 10),
    activities: summaries.reduce((total, week) => total + week.rides, 0),
    recent_activities: activities,
    metric_names: [...metricNames].sort(),
    weeks: summaries.slice(-52)
  };
}
