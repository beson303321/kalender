import { createStore, isDemo } from "./store.js";
import { CHANGELOG } from "./changelog.js";
import { SITE_NAME } from "./config.js";
import {
  parseICS, packLesson, unpackLesson, INFOBLATT_EVENTS, SUBJECTS,
  subjectName, teacherNames, SUBJECT_SHORT, SUBJECT_COLORS,
} from "./importer.js";

// ───────────────────────── Helfer ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#8b8d98");

const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const dayDiff = (a, b) => {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
};
const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

const dtf = (o) => new Intl.DateTimeFormat("de-CH", o);
const fmtMonthYear = dtf({ month: "long", year: "numeric" });
const fmtLong = dtf({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = dtf({ day: "numeric", month: "short" });
const fmtWeekday = dtf({ weekday: "short" });
const fmtDate = dtf({ day: "2-digit", month: "2-digit", year: "numeric" });
const weekdayShort = (iso) => fmtWeekday.format(fromISO(iso)).replace(".", "");
const shortDate = (iso) => `${weekdayShort(iso)}, ${fmtShort.format(fromISO(iso))}`;

const evEnd = (e) => (e.endDate && e.endDate > e.date ? e.endDate : e.date);
const covers = (e, iso) => e.date <= iso && iso <= evEnd(e);
const isRange = (e) => evEnd(e) !== e.date;

function relLabel(e) {
  const t = todayISO();
  if (isRange(e) && e.date <= t && t <= evEnd(e)) return `bis ${fmtShort.format(fromISO(evEnd(e)))}`;
  const d = dayDiff(t, e.date);
  if (d === 0) return "Heute";
  if (d === 1) return "Morgen";
  if (d === -1) return "Gestern";
  return d > 0 ? `in ${d} Tagen` : `vor ${-d} Tagen`;
}
const relDays = (iso) => dayDiff(todayISO(), iso);

function dateRangeText(e, long = false) {
  const f = long ? (iso) => fmtLong.format(fromISO(iso)) : shortDate;
  return isRange(e) ? `${f(e.date)} – ${f(evEnd(e))}` : f(e.date);
}
function timeText(e) {
  if (!e.time) return "";
  return e.endTime ? `${e.time}–${e.endTime}` : e.time;
}

const pref = {
  get(k, def) { try { return localStorage.getItem("kal-" + k) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem("kal-" + k, v); } catch { /* egal */ } },
};

// ───────────────────────── Zustand ─────────────────────────
const SUBJECT_NAMES_FOR_LINKS = Object.fromEntries(Object.entries(SUBJECTS).filter(([k]) => !["M", "IDPA"].includes(k)));
const VIEWS = ["calendar", "week", "list", "games", "docs"];
const state = {
  user: null,
  events: [],
  categories: [],
  schedule: null, // { from, to, byDate: Map(date → lessons[]) }
  settings: {},
  links: [],
  docSearch: "",
  view: VIEWS.includes(pref.get("view", "")) ? pref.get("view") : "calendar",
  month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  weekStart: (() => { const d = new Date(); const m = mondayOf(d); if (d.getDay() === 6 || d.getDay() === 0) m.setDate(m.getDate() + 7); return m; })(),
  filter: new Set(),
  search: "",
  showPast: false,
};

let store;
let unsubs = [];
let seeded = false;

init();

async function init() {
  document.title = `${SITE_NAME} – Termine`;
  $$(".site-name").forEach((el) => (el.textContent = SITE_NAME));
  registerServiceWorker();
  try {
    store = await createStore();
  } catch (err) {
    console.error(err);
    $("#boot").innerHTML = `<p class="muted">Die Seite konnte nicht geladen werden. Bitte später nochmals versuchen.</p>`;
    return;
  }
  if (isDemo) $("#demo-banner").hidden = false;
  bindStatic();
  store.onAuth((user) => {
    state.user = user;
    user ? enterApp() : showLogin();
  });
}

// ───────────────────────── Login ─────────────────────────
function showLogin() {
  unsubs.forEach((u) => u());
  unsubs = [];
  state.events = [];
  state.categories = [];
  state.schedule = null;
  state.settings = {};
  state.links = [];
  seeded = false;
  closeModal();
  $("#boot").hidden = true;
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  $("#login-form").reset();
  setTimeout(() => $("#login-form [name=username]").focus(), 50);
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = $("button[type=submit]", form);
  const errEl = $("#login-error");
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Anmelden …";
  try {
    await store.login(form.username.value, form.password.value);
  } catch (err) {
    const code = err?.code || "";
    errEl.textContent =
      code.includes("too-many-requests") ? "Zu viele Versuche. Bitte warte kurz und versuche es nochmals." :
      code.includes("network") ? "Keine Verbindung. Bist du online?" :
      "Benutzername oder Passwort ist falsch.";
    errEl.hidden = false;
    form.password.select();
  } finally {
    btn.disabled = false;
    btn.textContent = "Anmelden";
  }
}

// ───────────────────────── App ─────────────────────────
function enterApp() {
  $("#boot").hidden = true;
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  document.body.classList.toggle("is-admin", state.user.isAdmin);
  $("#role-badge").textContent = state.user.isAdmin ? "Admin" : "Klasse";
  maybeShowInstall();
  updateNewsDot();

  unsubs.forEach((u) => u());
  unsubs = [
    store.watchCategories((cats, meta) => {
      state.categories = cats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name));
      maybeSeedCategories(meta);
      render();
      refreshOpenModal();
    }, onDataError),
    store.watchEvents((evs) => {
      state.events = evs.sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
      render();
      refreshOpenModal();
    }, onDataError),
    store.watchSettings((data) => { state.settings = data || {}; if (state.view === "docs") renderDocs(); },
      (err) => console.warn("Einstellungen:", err)),
    store.watchLinks((links) => {
      state.links = links.sort((a, b) => String(a.title).localeCompare(String(b.title), "de"));
      if (state.view === "docs") renderDocs();
    }, (err) => console.warn("Links:", err)),
    store.watchSchedule((data) => {
      state.schedule = buildSchedule(data);
      render();
    }, (err) => console.warn("Stundenplan:", err)),
  ];
  render();
}

function buildSchedule(data) {
  if (!data?.lessons?.length) return null;
  const byDate = new Map();
  for (const s of data.lessons) {
    const l = unpackLesson(s);
    if (!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date).push(l);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  const dates = [...byDate.keys()].sort();
  return { from: data.from || dates[0], to: data.to || dates.at(-1), byDate };
}
const lessonsOn = (iso) => state.schedule?.byDate.get(iso) || [];

function onDataError(err) {
  console.error(err);
  toast(err?.code === "permission-denied"
    ? "Keine Berechtigung, die Daten zu laden. Bitte ab- und wieder anmelden."
    : "Fehler beim Laden der Daten.", "error");
}

// Beim allerersten Admin-Login die Standard-Kategorien anlegen
async function maybeSeedCategories(meta) {
  if (!state.user?.isAdmin || seeded || state.categories.length || meta?.fromCache) return;
  seeded = true;
  try {
    await store.addCategory({ name: "Prüfung", color: "#e5484d", order: 0 });
    await store.addCategory({ name: "Event", color: "#3e63dd", order: 1 });
  } catch (err) { console.error(err); }
}

const catById = (id) => state.categories.find((c) => c.id === id) || { id: "", name: "Ohne Kategorie", color: "#8b8d98" };
const catName = (e) => String(catById(e.category).name || "").toLowerCase();
const isHoliday = (e) => catName(e) === "ferien";
const isExam = (e) => catName(e).startsWith("prüf");

function filteredEvents() {
  const q = state.search.trim().toLowerCase();
  return state.events.filter((e) => {
    if (state.filter.size && !state.filter.has(e.category)) return false;
    if (q && ![e.title, e.subject, e.note, e.room, catById(e.category).name].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
const holidayOn = (iso) => state.events.find((e) => isHoliday(e) && covers(e, iso));

// ───────────────────────── Rendern ─────────────────────────
function render() {
  if (!state.user) return;
  $$(".view-toggle [data-view]").forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  $("#calendar-view").hidden = state.view !== "calendar";
  $("#week-view").hidden = state.view !== "week";
  $("#list-view").hidden = state.view !== "list";
  $("#games-view").hidden = state.view !== "games";
  $("#docs-view").hidden = state.view !== "docs";
  $(".toolbar").hidden = state.view === "games" || state.view === "docs";
  if (state.view === "games") return showGames();
  if (state.view === "docs") return renderDocs();
  renderFilters();
  if (state.view === "calendar") { renderCalendar(); renderToday(); renderUpcoming(); }
  else if (state.view === "week") renderWeek();
  else renderList();
}

// Spiele erst laden, wenn man den Tab öffnet
let gamesLoaded = false;
async function showGames() {
  if (gamesLoaded) return;
  gamesLoaded = true;
  try {
    const { mountGames } = await import("./games.js");
    mountGames($("#games-view"));
  } catch (err) {
    console.error(err);
    gamesLoaded = false;
    $("#games-view").innerHTML = `<p class="muted">Die Spiele konnten nicht geladen werden.</p>`;
  }
}

function renderFilters() {
  for (const id of state.filter) if (!state.categories.some((c) => c.id === id)) state.filter.delete(id);
  const chips = state.categories.map((c) => `
    <button class="filter-chip ${state.filter.has(c.id) ? "on" : ""}" data-cat="${esc(c.id)}" style="--c:${safeColor(c.color)}">
      <span class="dot"></span>${esc(c.name)}
    </button>`).join("");
  $("#filters").innerHTML = `
    <button class="filter-chip all ${state.filter.size ? "" : "on"}" data-cat="">Alle</button>${chips}`;
}

function chipHTML(e, cont = false) {
  const c = catById(e.category);
  return `<span class="chip ${cont ? "cont" : ""}" style="--c:${safeColor(c.color)}" title="${esc(e.title)}">
    ${!cont && e.time ? `<b>${esc(e.time)}</b> ` : ""}${esc(e.title)}</span>`;
}

// ── Monat ──
function renderCalendar() {
  const m = state.month;
  const year = m.getFullYear(), mon = m.getMonth();
  $("#cal-title").textContent = fmtMonthYear.format(m);

  const offset = (new Date(year, mon, 1).getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const first = toISO(new Date(year, mon, 1 - offset));
  const last = addDays(first, cells - 1);
  const today = todayISO();

  // Einträge auf Tage verteilen (mehrtägige auf jeden Tag)
  const byDate = new Map();
  const push = (iso, item) => { if (!byDate.has(iso)) byDate.set(iso, []); byDate.get(iso).push(item); };
  for (const e of filteredEvents()) {
    if (evEnd(e) < first || e.date > last) continue;
    let iso = e.date < first ? first : e.date;
    const end = evEnd(e) > last ? last : evEnd(e);
    while (iso <= end) { push(iso, { e, cont: iso !== e.date }); iso = addDays(iso, 1); }
  }

  let html = "";
  for (let i = 0; i < cells; i++) {
    const iso = addDays(first, i);
    const d = fromISO(iso);
    const items = byDate.get(iso) || [];
    const holiday = holidayOn(iso);
    // Fortsetzungen mehrtägiger Einträge nur am Montag (neue Zeile) beschriften
    const visible = items.filter(({ cont }) => !cont || i % 7 === 0);
    const cls = ["day"];
    if (d.getMonth() !== mon) cls.push("other");
    if (iso === today) cls.push("today");
    if (iso < today) cls.push("past");
    if (i % 7 >= 5) cls.push("weekend");
    if (holiday) cls.push("holiday");
    const max = 3;
    const real = items.filter(({ cont, e }) => !cont && !isHoliday(e));
    const label = `${fmtLong.format(d)}${holiday ? `, ${holiday.title}` : ""}${real.length ? `, ${real.length} Eintr${real.length === 1 ? "ag" : "äge"}` : ""}`;
    html += `<button class="${cls.join(" ")}" data-date="${iso}" aria-label="${esc(label)}">
      <span class="num">${d.getDate()}</span>
      <span class="chips">${visible.slice(0, max).map(({ e, cont }) => chipHTML(e, cont)).join("")}${visible.length > max ? `<span class="more">+${visible.length - max} weitere</span>` : ""}</span>
      <span class="dots">${real.slice(0, 4).map(({ e }) => `<i style="--c:${safeColor(catById(e.category).color)}"></i>`).join("")}</span>
    </button>`;
  }
  $("#cal-grid").innerHTML = html;
}

function lessonRowHTML(l, iso) {
  const exam = examForLesson(l, iso);
  const color = SUBJECT_COLORS[l.subj] || "#8b8d98";
  return `<div class="lesson-row ${exam ? "has-exam" : ""}" style="--c:${color}">
    <span class="lr-time">${esc(l.start)}<small>${esc(l.end)}</small></span>
    <span class="lr-bar"></span>
    <span class="lr-main"><b>${esc(subjectName(l.subj))}</b><small>${esc(teacherNames(l.teacher))}</small></span>
    ${exam ? `<span class="lr-exam" title="${esc(exam.title)}">Prüfung</span>` : ""}
    <span class="lr-room">${esc(l.room || "–")}</span>
  </div>`;
}

function renderToday() {
  const iso = todayISO();
  const lessons = lessonsOn(iso);
  const card = $("#today-card");
  card.hidden = !lessons.length;
  if (!lessons.length) return;
  const n = nowMin();
  const upcoming = lessons.filter((l) => toMin(l.end) > n);
  $("#today-title").textContent = `Heute · ${shortDate(iso)}`;
  $("#today-list").innerHTML = upcoming.length
    ? upcoming.map((l) => lessonRowHTML(l, iso)).join("")
    : `<p class="empty-small">Schule ist für heute vorbei 🎉</p>`;
}

function renderUpcoming() {
  const today = todayISO();
  const items = filteredEvents().filter((e) => evEnd(e) >= today && !isHoliday(e)).slice(0, 6);
  $("#upcoming-list").innerHTML = items.length
    ? items.map((e) => {
        const c = catById(e.category);
        const d = relDays(e.date);
        return `<button class="up-item" data-id="${esc(e.id)}" style="--c:${safeColor(c.color)}">
          <span class="up-bar"></span>
          <span class="up-main">
            <span class="up-title">${esc(e.title)}</span>
            <span class="up-meta">${esc(dateRangeText(e))}${e.time ? ` · ${esc(timeText(e))}` : ""}</span>
          </span>
          <span class="up-rel ${d >= 0 && d <= 2 ? "soon" : ""}">${esc(relLabel(e))}</span>
        </button>`;
      }).join("")
    : `<p class="empty-small">Keine anstehenden Termine 🎉</p>`;
}

// ── Woche ──
function examForLesson(l, iso) {
  const s = toMin(l.start), en = toMin(l.end);
  const subj = subjectName(l.subj).toLowerCase().slice(0, 4);
  return state.events.find((e) => isExam(e) && e.date === iso && (
    e.time ? toMin(e.time) >= s && toMin(e.time) < en
           : (e.subject || e.title || "").toLowerCase().includes(subj)
  ));
}

function renderWeek() {
  const ws = toISO(state.weekStart);
  const allDays = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const evs = filteredEvents();
  // Samstag/Sonntag nur zeigen, wenn dort etwas los ist
  const hasStuff = (iso) => lessonsOn(iso).length || evs.some((e) => covers(e, iso) && !isHoliday(e));
  const days = allDays.filter((iso, i) => i < 5 || hasStuff(iso));
  const today = todayISO();

  $("#week-title").textContent = `KW ${isoWeek(state.weekStart)}`;
  $("#week-sub").textContent = `${fmtShort.format(fromISO(days[0]))} – ${fmtShort.format(fromISO(days.at(-1)))} ${fromISO(days.at(-1)).getFullYear()}`;

  const weekLessons = days.flatMap((iso) => lessonsOn(iso));
  let start = 7 * 60 + 45, end = 16 * 60 + 45;
  for (const l of weekLessons) { start = Math.min(start, toMin(l.start) - 10); end = Math.max(end, toMin(l.end) + 5); }
  start = Math.floor(start / 15) * 15;

  // Hinweis, wenn für diese Woche kein Stundenplan da ist
  let notice = "";
  const schoolDays = days.filter((iso) => !holidayOn(iso));
  if (!weekLessons.length && schoolDays.length) {
    if (!state.schedule) {
      notice = state.user.isAdmin
        ? `Noch kein Stundenplan importiert. <button class="link-btn" data-open-import>Jetzt importieren</button>`
        : "Der Stundenplan wurde noch nicht importiert.";
    } else if (ws > state.schedule.to) {
      notice = `Der Stundenplan ist erst bis ${esc(fmtDate.format(fromISO(state.schedule.to)))} verfügbar.` +
        (state.user.isAdmin ? ` <button class="link-btn" data-open-import>Neue Datei importieren</button>` : "");
    } else if (ws < state.schedule.from) {
      notice = "Für diese Woche gibt es keinen Stundenplan.";
    }
  }
  $("#week-notice").innerHTML = notice ? `<p class="week-notice">${notice}</p>` : "";

  // Stundenraster
  const hours = [];
  for (let h = Math.ceil(start / 60); h * 60 <= end; h++) hours.push(h);
  const cols = days.map((iso) => {
    const lessons = lessonsOn(iso);
    const holiday = holidayOn(iso);
    const dayEvents = evs.filter((e) => covers(e, iso) && !isHoliday(e));
    const isToday = iso === today;
    const blocks = lessons.map((l) => {
      const top = toMin(l.start) - start, h = toMin(l.end) - toMin(l.start);
      const exam = examForLesson(l, iso);
      const color = SUBJECT_COLORS[l.subj] || "#8b8d98";
      return `<div class="lesson ${h < 60 ? "short" : ""} ${exam ? "has-exam" : ""}" style="--c:${color}; --top:${top}; --h:${h}"
        title="${esc(`${subjectName(l.subj)} · ${l.start}–${l.end} · ${l.room || "kein Zimmer"} · ${teacherNames(l.teacher)}`)}">
        <span class="l-subj"><span class="full">${esc(subjectName(l.subj))}</span><span class="abbr">${esc(SUBJECT_SHORT[l.subj] || l.subj)}</span></span>
        <span class="l-room">${esc(l.room || "")}</span>
        <span class="l-teacher">${esc(teacherNames(l.teacher))}</span>
        ${exam ? `<span class="l-exam" data-id="${esc(exam.id)}">📝 Prüfung</span>` : ""}
      </div>`;
    }).join("");
    const nowLine = isToday && nowMin() >= start && nowMin() <= end
      ? `<div class="now-line" style="--top:${nowMin() - start}"></div>` : "";
    return {
      head: `<div class="wk-head ${isToday ? "today" : ""}" data-date="${iso}">
          <span class="wk-wd">${esc(weekdayShort(iso))}</span><span class="wk-num">${fromISO(iso).getDate()}</span>
        </div>`,
      allday: `<div class="wk-allday" data-date="${iso}">
          ${holiday ? `<span class="chip holiday-chip" style="--c:${safeColor(catById(holiday.category).color)}">${esc(holiday.title)}</span>` : ""}
          ${dayEvents.map((e) => `<button class="chip" data-id="${esc(e.id)}" style="--c:${safeColor(catById(e.category).color)}">${e.time ? `<b>${esc(e.time)}</b> ` : ""}${esc(e.title)}</button>`).join("")}
        </div>`,
      body: `<div class="wk-col ${isToday ? "today" : ""} ${holiday && !lessons.length ? "holiday" : ""}" data-date="${iso}">
          ${holiday && !lessons.length ? `<span class="wk-holiday">${esc(holiday.title)}</span>` : ""}
          ${blocks}${nowLine}
        </div>`,
    };
  });

  $("#week-grid").style.setProperty("--days", days.length);
  $("#week-grid").style.setProperty("--span", end - start);
  $("#week-grid").style.setProperty("--offset", (60 - (start % 60)) % 60);
  $("#week-grid").innerHTML = `
    <div class="wk-corner"></div>${cols.map((c) => c.head).join("")}
    <div class="wk-corner wk-allday-label">Termine</div>${cols.map((c) => c.allday).join("")}
    <div class="wk-times">${hours.map((h) => `<span style="--top:${h * 60 - start}">${pad(h)}:00</span>`).join("")}</div>
    ${cols.map((c) => c.body).join("")}`;
}

// ── Liste ──
function renderList() {
  const today = todayISO();
  const items = filteredEvents().filter((e) => state.showPast || evEnd(e) >= today);
  if (!items.length) {
    $("#event-list").innerHTML = `<div class="empty card">
      <div class="empty-icon">📭</div>
      <p><b>${state.search || state.filter.size ? "Nichts gefunden" : "Noch keine Termine"}</b></p>
      <p class="muted">${state.search || state.filter.size ? "Versuch es mit einem anderen Filter." : "Trag die erste Prüfung ein!"}</p>
    </div>`;
    return;
  }
  const groups = new Map();
  for (const e of items) {
    const key = e.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  let html = "";
  for (const [key, evs] of groups) {
    html += `<h3 class="month-head">${esc(fmtMonthYear.format(fromISO(key + "-01")))}</h3><div class="card list-card">`;
    for (const e of evs) {
      const c = catById(e.category);
      const past = evEnd(e) < today;
      const d = relDays(e.date);
      html += `<button class="list-item ${past ? "past" : ""}" data-id="${esc(e.id)}" style="--c:${safeColor(c.color)}">
        <span class="li-date"><span class="li-wd">${esc(weekdayShort(e.date))}</span><span class="li-day">${fromISO(e.date).getDate()}</span></span>
        <span class="li-main">
          <span class="li-title">${esc(e.title)}</span>
          <span class="li-meta">
            <span class="badge">${esc(c.name)}</span>
            ${isRange(e) ? `<span>bis ${esc(shortDate(evEnd(e)))}</span>` : ""}
            ${e.subject ? `<span>${esc(e.subject)}</span>` : ""}
            ${e.time ? `<span>${esc(timeText(e))} Uhr</span>` : ""}
            ${e.room ? `<span>Zimmer ${esc(e.room)}</span>` : ""}
          </span>
          ${e.note ? `<span class="li-note">${esc(e.note)}</span>` : ""}
        </span>
        <span class="li-rel ${!past && d >= 0 && d <= 2 ? "soon" : ""}">${esc(relLabel(e))}</span>
      </button>`;
    }
    html += `</div>`;
  }
  $("#event-list").innerHTML = html;
}

// ───────────────────────── Modals ─────────────────────────
const modal = $("#modal");
let modalRefresh = null;

function openModal(html, onMount, refresh = null) {
  $("#modal-body").innerHTML = html;
  modalRefresh = refresh;
  if (!modal.open) modal.showModal();
  onMount?.($("#modal-body"));
}
function closeModal() {
  modalRefresh = null;
  if (modal.open) modal.close();
}
function refreshOpenModal() {
  if (modal.open && modalRefresh) modalRefresh();
}

function confirmBox(text, okLabel = "Löschen") {
  const d = $("#confirm");
  $("#confirm-text").textContent = text;
  $("#confirm-ok").textContent = okLabel;
  d.showModal();
  return new Promise((resolve) => {
    const done = (v) => { if (d.open) d.close(); resolve(v); };
    $("#confirm-ok").onclick = () => done(true);
    $("#confirm-cancel").onclick = () => done(false);
    d.oncancel = () => resolve(false);
  });
}

const closeBtn = `<button class="icon-btn modal-close" data-close aria-label="Schliessen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;

// Tag angeklickt: Termine + Stundenplan des Tages
function openDay(iso) {
  if (!filteredEvents().some((e) => covers(e, iso)) && !lessonsOn(iso).length) return openEventForm(null, iso);
  const draw = () => {
    const list = filteredEvents().filter((e) => covers(e, iso));
    const lessons = lessonsOn(iso);
    openModal(`
      ${closeBtn}
      <p class="eyebrow">${esc(relLabel({ date: iso }))}</p>
      <h2>${esc(fmtLong.format(fromISO(iso)))}</h2>
      <div class="day-list">
        ${list.map((e) => {
          const c = catById(e.category);
          return `<button class="day-item" data-id="${esc(e.id)}" style="--c:${safeColor(c.color)}">
            <span class="up-bar"></span>
            <span class="up-main">
              <span class="up-title">${esc(e.title)}</span>
              <span class="up-meta">${esc(c.name)}${isRange(e) ? ` · ${esc(dateRangeText(e))}` : ""}${e.subject ? ` · ${esc(e.subject)}` : ""}${e.time ? ` · ${esc(timeText(e))} Uhr` : ""}</span>
            </span>
            <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
          </button>`;
        }).join("")}
      </div>
      ${lessons.length ? `<h3 class="section-title">Stundenplan</h3><div class="lesson-list">${lessons.map((l) => lessonRowHTML(l, iso)).join("")}</div>` : ""}
      <div class="actions">
        <button class="btn primary" data-add-date="${iso}">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Eintrag an diesem Tag
        </button>
      </div>`, null, draw);
  };
  draw();
}

function openEventDetail(id) {
  const draw = () => {
    const e = state.events.find((x) => x.id === id);
    if (!e) { closeModal(); return; }
    const c = catById(e.category);
    const created = e.createdAt?.toDate ? e.createdAt.toDate() : e.createdAt ? new Date(e.createdAt) : null;
    const who = String(e.createdBy || "").startsWith("admin@") ? "Admin" : "Klasse";
    const origin = e.source === "schulnetz" ? "Aus dem schulNetz-Stundenplan importiert"
      : e.source === "infoblatt" ? "Aus dem BM-Infoblatt 2026/27 importiert"
      : `Eingetragen von ${who}${created ? ` am ${fmtDate.format(created)}` : ""}`;
    openModal(`
      ${closeBtn}
      <span class="badge lg" style="--c:${safeColor(c.color)}"><span class="dot"></span>${esc(c.name)}</span>
      <h2 class="detail-title">${esc(e.title)}</h2>
      <dl class="detail">
        <div><dt>Datum</dt><dd>${esc(dateRangeText(e, true))} <span class="muted">· ${esc(relLabel(e))}</span></dd></div>
        ${e.time ? `<div><dt>Zeit</dt><dd>${esc(timeText(e))} Uhr</dd></div>` : ""}
        ${e.subject ? `<div><dt>Fach</dt><dd>${esc(e.subject)}</dd></div>` : ""}
        ${e.room ? `<div><dt>Zimmer</dt><dd>${esc(e.room)}</dd></div>` : ""}
        ${e.note ? `<div><dt>Notiz</dt><dd class="note">${esc(e.note)}</dd></div>` : ""}
      </dl>
      <p class="meta-line">${esc(origin)}</p>
      <div class="actions">
        ${state.user.isAdmin ? `
          <button class="btn ghost danger-text" data-delete="${esc(e.id)}">Löschen</button>
          <button class="btn ghost" data-edit="${esc(e.id)}">Bearbeiten</button>` : ""}
        <button class="btn primary" data-close>Schliessen</button>
      </div>`, null, draw);
  };
  draw();
}

// ── Doppelte Einträge erkennen ──
const STOP = new Set(["prufung", "pruefung", "test", "exam", "probe", "bmp", "und", "der", "die", "das", "the", "kapitel", "semester"]);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
const similarWord = (a, b) => { const n = Math.min(a.length, b.length, 5); return n >= 3 && a.slice(0, n) === b.slice(0, n); };

function findDuplicates(data, excludeId) {
  const mine = [...tokens(data.title), ...tokens(data.subject)];
  if (!mine.length) return [];
  const end = data.endDate || data.date;
  return state.events.filter((e) => {
    if (e.id === excludeId || isHoliday(e)) return false;
    if (evEnd(e) < data.date || e.date > end) return false; // anderer Tag
    const theirs = [...tokens(e.title), ...tokens(e.subject)];
    return mine.some((a) => theirs.some((b) => similarWord(a, b)));
  });
}

function openEventForm(existing = null, presetDate = null) {
  if (!state.categories.length) {
    openModal(`${closeBtn}<h2>Noch keine Kategorien</h2>
      <p class="muted">${state.user.isAdmin ? "Die Standard-Kategorien werden gerade angelegt. Versuch es gleich nochmals." : "Der Admin muss sich zuerst einmal anmelden, damit die Kategorien angelegt werden."}</p>
      <div class="actions"><button class="btn primary" data-close>OK</button></div>`);
    return;
  }
  const e = existing || {};
  const date = e.date || presetDate || todayISO();
  const selCat = e.category && state.categories.some((c) => c.id === e.category) ? e.category : state.categories[0].id;
  const subjects = [...new Set(state.events.map((x) => x.subject).filter(Boolean))].sort();
  let confirmedDuplicates = false;

  openModal(`
    ${closeBtn}
    <h2>${existing ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h2>
    <form id="event-form" class="form" novalidate>
      <label class="field">
        <span>Titel *</span>
        <input name="title" maxlength="100" required value="${esc(e.title)}" placeholder="z.B. Mathe Prüfung Kapitel 4">
      </label>
      <div class="field">
        <span>Kategorie *</span>
        <div class="cat-pick">
          ${state.categories.map((c) => `
            <label class="cat-opt" style="--c:${safeColor(c.color)}">
              <input type="radio" name="category" value="${esc(c.id)}" ${c.id === selCat ? "checked" : ""}>
              <span><i class="dot"></i>${esc(c.name)}</span>
            </label>`).join("")}
        </div>
      </div>
      <div class="row three">
        <label class="field"><span>Datum *</span><input type="date" name="date" required value="${esc(date)}"></label>
        <label class="field"><span>Bis <small>(mehrtägig)</small></span><input type="date" name="endDate" value="${esc(e.endDate || "")}"></label>
        <label class="field"><span>Uhrzeit</span><input type="time" name="time" value="${esc(e.time)}"></label>
      </div>
      <div class="row">
        <label class="field">
          <span>Fach</span>
          <input name="subject" maxlength="60" list="subject-list" value="${esc(e.subject)}" placeholder="z.B. Mathematik">
          <datalist id="subject-list">${subjects.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
        </label>
        <label class="field"><span>Zimmer</span><input name="room" maxlength="30" value="${esc(e.room || "")}" placeholder="z.B. A113"></label>
      </div>
      <label class="field">
        <span>Notiz</span>
        <textarea name="note" maxlength="1000" rows="3" placeholder="Stoff, Hilfsmittel …">${esc(e.note)}</textarea>
      </label>
      <div class="dup-warning" hidden></div>
      ${state.user.isAdmin ? "" : `<p class="hint">Nur der Admin kann Einträge ändern oder löschen. Bitte prüf alles, bevor du speicherst.</p>`}
      <p class="form-error" hidden></p>
      <div class="actions">
        <button type="button" class="btn ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn primary">Speichern</button>
      </div>
    </form>`, (body) => {
    const form = $("#event-form", body);
    const btn = $("button[type=submit]", form);
    const dupEl = $(".dup-warning", form);
    if (!existing) form.title.focus();
    // Sobald man etwas ändert, Warnung zurücksetzen
    form.addEventListener("input", () => {
      if (!confirmedDuplicates && dupEl.hidden) return;
      confirmedDuplicates = false; dupEl.hidden = true; btn.textContent = "Speichern"; btn.classList.remove("warn");
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const errEl = $(".form-error", form);
      errEl.hidden = true;
      const data = {
        title: form.title.value.trim(),
        category: form.category.value,
        date: form.date.value,
        endDate: form.endDate.value && form.endDate.value > form.date.value ? form.endDate.value : "",
        time: form.time.value || "",
        subject: form.subject.value.trim(),
        room: form.room.value.trim(),
        note: form.note.value.trim(),
      };
      if (existing?.endTime && data.time === existing.time) data.endTime = existing.endTime;
      else if (existing && "endTime" in existing) data.endTime = "";
      const problem = !data.title ? "Bitte gib einen Titel ein." :
        !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ? "Bitte wähle ein Datum." :
        form.endDate.value && form.endDate.value < data.date ? "„Bis“ muss nach dem Datum liegen." :
        !data.category ? "Bitte wähle eine Kategorie." : "";
      if (problem) { errEl.textContent = problem; errEl.hidden = false; return; }

      // Warnung: ähnlicher Eintrag am selben Tag oder Ferien
      if (!confirmedDuplicates) {
        const dups = findDuplicates(data, existing?.id);
        const holiday = !existing && !isHoliday({ category: data.category }) ? holidayOn(data.date) : null;
        if (dups.length || holiday) {
          dupEl.innerHTML = `
            ${dups.length ? `<p><b>⚠️ Gibt es das schon?</b> Am selben Tag ist bereits eingetragen:</p>
              <ul>${dups.map((d) => `<li><b>${esc(d.title)}</b> <span class="muted">· ${esc(catById(d.category).name)}${d.time ? ` · ${esc(d.time)}` : ""}</span></li>`).join("")}</ul>` : ""}
            ${holiday ? `<p><b>🏖️ Achtung:</b> Der ${esc(shortDate(data.date))} liegt in: ${esc(holiday.title)}.</p>` : ""}
            <p class="muted small">Wenn du sicher bist, klick nochmals auf „Trotzdem speichern“.</p>`;
          dupEl.hidden = false;
          confirmedDuplicates = true;
          btn.textContent = "Trotzdem speichern";
          btn.classList.add("warn");
          dupEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
      }

      btn.disabled = true;
      btn.textContent = "Speichern …";
      try {
        if (existing) await store.updateEvent(existing.id, data);
        else await store.addEvent(data);
        closeModal();
        toast(existing ? "Eintrag gespeichert" : "Eintrag hinzugefügt", "success");
        const d = fromISO(data.date);
        state.month = new Date(d.getFullYear(), d.getMonth(), 1);
        state.weekStart = mondayOf(d);
        render();
      } catch (err) {
        console.error(err);
        errEl.textContent = err?.code === "permission-denied"
          ? "Keine Berechtigung. Bitte ab- und wieder anmelden."
          : "Speichern hat nicht geklappt. Bist du online?";
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Speichern";
      }
    });
  });
}

async function deleteEvent(id) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  if (!(await confirmBox(`„${e.title}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`))) return;
  try {
    await store.deleteEvent(id);
    closeModal();
    toast("Eintrag gelöscht", "success");
  } catch (err) {
    console.error(err);
    toast("Löschen hat nicht geklappt.", "error");
  }
}

// ───────────────────────── Verwaltung (Admin) ─────────────────────────
const PALETTE = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#ffb224"];

function openAdmin() {
  if (!state.user.isAdmin) return;
  const draw = () => {
    const used = new Set(state.categories.map((c) => c.color.toLowerCase()));
    const nextColor = PALETTE.find((p) => !used.has(p)) || PALETTE[0];
    const sch = state.schedule;
    openModal(`
      ${closeBtn}
      <h2>Verwaltung</h2>
      <h3 class="section-title">Stundenplan &amp; Schuldaten</h3>
      <div class="import-box">
        <p class="small">${sch
          ? `Stundenplan vorhanden: <b>${esc(fmtDate.format(fromISO(sch.from)))} – ${esc(fmtDate.format(fromISO(sch.to)))}</b>`
          : "Noch kein Stundenplan importiert."}</p>
        <button class="btn ghost sm" data-open-import>Importieren …</button>
      </div>
      <h3 class="section-title">Kategorien</h3>
      <ul class="cat-list">
        ${state.categories.map((c) => {
          const n = state.events.filter((e) => e.category === c.id).length;
          return `<li data-id="${esc(c.id)}">
            <input type="color" value="${safeColor(c.color)}" aria-label="Farbe">
            <input type="text" value="${esc(c.name)}" maxlength="40" aria-label="Name">
            <span class="count" title="Anzahl Einträge">${n}</span>
            <button class="icon-btn danger-text" data-del-cat="${esc(c.id)}" aria-label="Kategorie löschen">
              <svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </li>`;
        }).join("") || `<li class="empty-small">Noch keine Kategorien.</li>`}
      </ul>
      <form id="cat-add" class="cat-add">
        <input type="color" name="color" value="${nextColor}" aria-label="Farbe">
        <input type="text" name="name" maxlength="40" placeholder="Neue Kategorie, z.B. Abgabe" required>
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>
      <div class="actions"><button class="btn ghost" data-close>Fertig</button></div>`, (body) => {
      $$(".cat-list li[data-id]", body).forEach((li) => {
        const id = li.dataset.id;
        const [color, name] = $$("input", li);
        const save = async () => {
          const n = name.value.trim();
          if (!n) { name.value = catById(id).name; return; }
          const cur = catById(id);
          if (n === cur.name && color.value.toLowerCase() === cur.color.toLowerCase()) return;
          try { await store.updateCategory(id, { name: n, color: color.value, order: cur.order ?? 0 }); toast("Kategorie gespeichert", "success"); }
          catch (err) { console.error(err); toast("Speichern hat nicht geklappt.", "error"); }
        };
        color.addEventListener("change", save);
        name.addEventListener("change", save);
        name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } });
      });
      $("#cat-add", body).addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const n = f.name.value.trim();
        if (!n) return;
        const order = Math.max(-1, ...state.categories.map((c) => c.order ?? 0)) + 1;
        try { await store.addCategory({ name: n, color: f.color.value, order }); toast(`„${n}“ hinzugefügt`, "success"); }
        catch (err) { console.error(err); toast("Hinzufügen hat nicht geklappt.", "error"); }
      });
    }, draw);
  };
  draw();
}

async function deleteCategory(id) {
  const c = catById(id);
  const n = state.events.filter((e) => e.category === id).length;
  const msg = n
    ? `Kategorie „${c.name}“ löschen? ${n} Eintr${n === 1 ? "ag wird" : "äge werden"} danach als „Ohne Kategorie“ angezeigt.`
    : `Kategorie „${c.name}“ löschen?`;
  if (!(await confirmBox(msg))) return;
  try { await store.deleteCategory(id); toast("Kategorie gelöscht", "success"); }
  catch (err) { console.error(err); toast("Löschen hat nicht geklappt.", "error"); }
}

// ── Import ──
function openImport() {
  if (!state.user.isAdmin) return;
  let parsed = null;
  openModal(`
    ${closeBtn}
    <h2>Schuldaten importieren</h2>
    <p class="muted small">Die Daten landen geschützt in eurer Datenbank, nur für eingeloggte Personen sichtbar.
      Ein erneuter Import aktualisiert die Einträge, statt sie doppelt anzulegen.</p>
    <div class="field">
      <span>1. Stundenplan-Datei aus schulNetz (.ics)</span>
      <label class="file-drop">
        <input type="file" id="ics-file" accept=".ics,text/calendar">
        <span id="file-label">Datei wählen …</span>
      </label>
    </div>
    <div id="ics-preview" class="import-preview" hidden></div>
    <label class="check">
      <input type="checkbox" id="imp-infoblatt" checked>
      <span><b>2. Termine aus dem BM-Infoblatt 2026/27</b><br>
        <small class="muted">${INFOBLATT_EVENTS.length} Einträge: BMP-Termine, Prüfungsauflage, Diplomfeier, Sprachaufenthalt England</small></span>
    </label>
    <p class="form-error" hidden></p>
    <div class="actions">
      <button class="btn ghost" data-close>Abbrechen</button>
      <button class="btn primary" id="imp-go">Importieren</button>
    </div>`, (body) => {
    const fileInput = $("#ics-file", body);
    const preview = $("#ics-preview", body);
    const errEl = $(".form-error", body);
    fileInput.addEventListener("change", async () => {
      errEl.hidden = true;
      const file = fileInput.files[0];
      if (!file) return;
      $("#file-label", body).textContent = file.name;
      try {
        parsed = parseICS(await file.text());
        const { lessons, exams, holidays } = parsed;
        if (!lessons.length && !exams.length && !holidays.length) throw new Error("leer");
        preview.innerHTML = `
          <div><b>${lessons.length}</b> Lektionen ${lessons.length ? `<span class="muted">(${esc(fmtDate.format(fromISO(lessons[0].date)))} – ${esc(fmtDate.format(fromISO(lessons.at(-1).date)))})</span>` : ""}</div>
          <div><b>${exams.length}</b> angekündigte Prüfungen</div>
          <div><b>${holidays.length}</b> Ferien &amp; Feiertage</div>`;
        preview.hidden = false;
      } catch (err) {
        console.error(err);
        parsed = null;
        preview.hidden = true;
        errEl.textContent = "Die Datei konnte nicht gelesen werden. Ist es die .ics-Datei aus schulNetz?";
        errEl.hidden = false;
      }
    });
    $("#imp-go", body).addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      const withInfo = $("#imp-infoblatt", body).checked;
      if (!parsed && !withInfo) { errEl.textContent = "Bitte wähle eine Datei oder die Infoblatt-Termine."; errEl.hidden = false; return; }
      btn.disabled = true;
      btn.textContent = "Importiere …";
      try {
        const n = await runImport(parsed, withInfo);
        closeModal();
        toast(`Import fertig: ${n} Termine${parsed?.lessons.length ? ` und ${parsed.lessons.length} Lektionen` : ""}`, "success");
        if (parsed?.lessons.length) { state.view = "week"; pref.set("view", "week"); render(); }
      } catch (err) {
        console.error(err);
        errEl.textContent = err?.code === "permission-denied"
          ? "Keine Berechtigung. Sind die neuen Datenbank-Regeln in Firebase veröffentlicht?"
          : "Import hat nicht geklappt. Bist du online?";
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Importieren";
      }
    });
  });
}

async function ensureCategory(name, color) {
  const found = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const order = Math.max(-1, ...state.categories.map((c) => c.order ?? 0)) + 1;
  const id = await store.addCategory({ name, color, order });
  // sofort verfügbar, falls der Snapshot noch nicht da ist
  if (!state.categories.some((c) => c.id === id)) state.categories.push({ id, name, color, order });
  return id;
}

async function runImport(parsed, withInfo) {
  const cat = {
    "Prüfung": await ensureCategory("Prüfung", "#e5484d"),
    "Event": await ensureCategory("Event", "#3e63dd"),
  };
  if (parsed?.holidays.length) cat["Ferien"] = await ensureCategory("Ferien", "#30a46c");
  const base = { endDate: "", time: "", endTime: "", subject: "", room: "", note: "" };
  const events = [];
  if (parsed) {
    for (const x of parsed.exams) {
      events.push({ ...base, id: x.id, title: x.title.slice(0, 100), category: cat["Prüfung"], date: x.date,
        time: x.time, endTime: x.endTime, subject: x.subject.slice(0, 60), room: x.room.slice(0, 30),
        note: x.teacher ? `Lehrperson: ${x.teacher}` : "", source: "schulnetz" });
    }
    for (const x of parsed.holidays) {
      events.push({ ...base, id: x.id, title: x.title.slice(0, 100), category: cat["Ferien"], date: x.date,
        endDate: x.endDate, source: "schulnetz" });
    }
  }
  if (withInfo) {
    for (const x of INFOBLATT_EVENTS) {
      events.push({ ...base, id: x.id, title: x.title, category: cat[x.cat], date: x.date, endDate: x.endDate || "",
        time: x.time || "", endTime: x.endTime || "", subject: x.subject || "", note: x.note || "", source: "infoblatt" });
    }
  }
  let schedule = null;
  if (parsed?.lessons.length) {
    const l = parsed.lessons;
    schedule = { lessons: l.map(packLesson), from: l[0].date, to: l.at(-1).date };
  }
  await store.importSchool({ events, schedule });
  return events.length;
}

// ───────────────────────── Dateien (OneDrive-Ordner + Links) ─────────────────────────
function safeUrl(u) {
  try { const x = new URL(String(u || "").trim()); return x.protocol === "https:" ? x.href : ""; } catch { return ""; }
}
function linkIcon(url) {
  const h = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (/onedrive|sharepoint|1drv\.ms/.test(h)) return "☁️";
  if (/docs\.google|drive\.google/.test(h)) return "📄";
  if (/youtube|youtu\.be/.test(h)) return "▶️";
  if (/ilias|bslenzburg|schulnetz/.test(h)) return "🏫";
  return "🔗";
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

function renderDocs() {
  const root = $("#docs-view");
  const admin = state.user?.isAdmin;
  const drive = safeUrl(state.settings?.driveUrl);
  const q = state.docSearch.trim().toLowerCase();
  const links = state.links.filter((l) => !q || [l.title, l.subject, l.note, l.url].join(" ").toLowerCase().includes(q));
  const groups = new Map();
  for (const l of links) {
    const key = l.subject || "Allgemein";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === "Allgemein") - (b === "Allgemein") || a.localeCompare(b, "de"));
  const hadFocus = document.activeElement?.id === "doc-search";

  root.innerHTML = `
    <div class="docs-hero card">
      <div class="docs-hero-icon">📁</div>
      <div class="docs-hero-text">
        <h2>Klassen-Ordner</h2>
        <p class="muted">Zusammenfassungen, Notizen und Unterlagen an einem Ort. Hochladen geht direkt im OneDrive-Ordner.</p>
      </div>
      <div class="docs-hero-actions">
        ${drive
          ? `<a class="btn primary" href="${esc(drive)}" target="_blank" rel="noopener noreferrer">Ordner öffnen
              <svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>`
          : `<span class="muted small">${admin ? "Noch kein Ordner verknüpft." : "Der Admin hat noch keinen Ordner verknüpft."}</span>`}
        ${admin ? `<button class="btn ghost sm" data-edit-drive>${drive ? "Link ändern" : "Ordner-Link eintragen"}</button>` : ""}
      </div>
    </div>

    ${drive ? `<div class="docs-steps">
      <div><b>1</b> Ordner öffnen</div>
      <div><b>2</b> In den passenden Fach-Ordner gehen</div>
      <div><b>3</b> Datei hineinziehen oder „Hochladen“ tippen</div>
    </div>` : ""}

    <div class="docs-head">
      <h3>Wichtige Links</h3>
      <button class="btn primary sm" data-add-link><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Link</button>
    </div>
    <p class="muted small docs-sub">Direkte Links zu einzelnen Dateien oder Seiten, z.B. Formelsammlung, Lernvideo, Ilias-Kurs.</p>
    ${state.links.length > 4 ? `<label class="search docs-search">
      <svg viewBox="0 0 24 24"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4"/></svg>
      <input id="doc-search" type="search" placeholder="Links durchsuchen" value="${esc(state.docSearch)}">
    </label>` : ""}
    ${keys.length ? keys.map((k) => `
      <h4 class="month-head">${esc(k)}</h4>
      <div class="card list-card">
        ${groups.get(k).map((l) => {
          const url = safeUrl(l.url);
          return `<div class="link-row">
            <a class="link-item" href="${esc(url || "#")}" target="_blank" rel="noopener noreferrer">
              <span class="link-icon">${linkIcon(url)}</span>
              <span class="li-main">
                <span class="li-title">${esc(l.title)}</span>
                <span class="li-meta"><span>${esc(hostOf(url))}</span>${l.note ? `<span>${esc(l.note)}</span>` : ""}</span>
              </span>
              <svg class="chev" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
            </a>
            ${admin ? `<button class="icon-btn danger-text" data-del-link="${esc(l.id)}" aria-label="Link löschen">
              <svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>` : ""}
          </div>`;
        }).join("")}
      </div>`).join("")
      : `<div class="empty card"><div class="empty-icon">🔗</div>
          <p><b>${q ? "Nichts gefunden" : "Noch keine Links"}</b></p>
          <p class="muted">${q ? "Versuch einen anderen Suchbegriff." : "Teile den ersten nützlichen Link mit der Klasse."}</p></div>`}

    <p class="docs-note">Bitte nur teilen, was erlaubt ist: keine eingescannten Lehrbücher und keine Prüfungen, die nicht von der Lehrperson freigegeben wurden.</p>`;

  if (hadFocus) { const i = $("#doc-search"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

function openDriveForm() {
  if (!state.user.isAdmin) return;
  openModal(`
    ${closeBtn}
    <h2>Ordner-Link</h2>
    <form id="drive-form" class="form" novalidate>
      <label class="field">
        <span>Link zum OneDrive-Ordner</span>
        <input name="url" type="url" inputmode="url" value="${esc(state.settings?.driveUrl || "")}" placeholder="https://1drv.ms/f/…">
      </label>
      <p class="hint">In OneDrive: Ordner auswählen → <b>Teilen</b> → <b>Link kopieren</b>. Damit alle hochladen können, muss der Link „Bearbeiten“ erlauben.
        Der Link ist nur für eingeloggte Personen sichtbar.</p>
      <p class="form-error" hidden></p>
      <div class="actions">
        <button type="button" class="btn ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn primary">Speichern</button>
      </div>
    </form>`, (body) => {
    const form = $("#drive-form", body);
    form.url.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = form.url.value.trim();
      const url = raw ? safeUrl(raw) : "";
      const errEl = $(".form-error", form);
      if (raw && !url) { errEl.textContent = "Bitte einen vollständigen Link eingeben, der mit https:// beginnt."; errEl.hidden = false; return; }
      try {
        await store.saveSettings({ driveUrl: url });
        closeModal();
        toast(url ? "Ordner-Link gespeichert" : "Ordner-Link entfernt", "success");
      } catch (err) {
        console.error(err);
        errEl.textContent = err?.code === "permission-denied"
          ? "Keine Berechtigung. Sind die neuen Datenbank-Regeln in Firebase veröffentlicht?"
          : "Speichern hat nicht geklappt. Bist du online?";
        errEl.hidden = false;
      }
    });
  });
}

function openLinkForm() {
  const subjects = [...new Set([...Object.values(SUBJECT_NAMES_FOR_LINKS), ...state.links.map((l) => l.subject).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "de"));
  openModal(`
    ${closeBtn}
    <h2>Link teilen</h2>
    <form id="link-form" class="form" novalidate>
      <label class="field"><span>Titel *</span><input name="title" maxlength="100" placeholder="z.B. Formelsammlung Mathe"></label>
      <label class="field"><span>Link *</span><input name="url" type="url" inputmode="url" maxlength="1000" placeholder="https://…"></label>
      <div class="row">
        <label class="field">
          <span>Fach</span>
          <input name="subject" maxlength="60" list="link-subjects" placeholder="z.B. Mathematik">
          <datalist id="link-subjects">${subjects.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
        </label>
        <label class="field"><span>Notiz</span><input name="note" maxlength="300" placeholder="optional"></label>
      </div>
      <p class="hint">Tipp: In OneDrive bei einer Datei auf <b>Teilen → Link kopieren</b> tippen und hier einfügen.
        ${state.user.isAdmin ? "" : "Nur der Admin kann Links wieder löschen."}</p>
      <p class="form-error" hidden></p>
      <div class="actions">
        <button type="button" class="btn ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn primary">Teilen</button>
      </div>
    </form>`, (body) => {
    const form = $("#link-form", body);
    form.title.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = $(".form-error", form);
      const data = {
        title: form.title.value.trim(),
        url: safeUrl(form.url.value),
        subject: form.subject.value.trim(),
        note: form.note.value.trim(),
      };
      const problem = !data.title ? "Bitte gib einen Titel ein." :
        !data.url ? "Bitte einen vollständigen Link eingeben, der mit https:// beginnt." :
        state.links.some((l) => l.url === data.url) ? "Diesen Link gibt es schon." : "";
      if (problem) { errEl.textContent = problem; errEl.hidden = false; return; }
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        await store.addLink(data);
        closeModal();
        toast("Link geteilt", "success");
      } catch (err) {
        console.error(err);
        errEl.textContent = err?.code === "permission-denied"
          ? "Keine Berechtigung. Sind die neuen Datenbank-Regeln in Firebase veröffentlicht?"
          : "Speichern hat nicht geklappt. Bist du online?";
        errEl.hidden = false;
        btn.disabled = false;
      }
    });
  });
}

async function deleteLink(id) {
  const l = state.links.find((x) => x.id === id);
  if (!l || !(await confirmBox(`Link „${l.title}“ löschen? Die Datei selbst in OneDrive bleibt erhalten.`))) return;
  try { await store.deleteLink(id); toast("Link gelöscht", "success"); }
  catch (err) { console.error(err); toast("Löschen hat nicht geklappt.", "error"); }
}

// ───────────────────────── Was ist neu? ─────────────────────────
const latestVersion = CHANGELOG[0]?.version || "";
function updateNewsDot() {
  const seen = pref.get("news-seen", "");
  $(".news-dot").hidden = !latestVersion || seen === latestVersion;
}
function openNews() {
  const seen = pref.get("news-seen", "");
  const seenIdx = CHANGELOG.findIndex((r) => r.version === seen);
  openModal(`
    ${closeBtn}
    <h2>Was ist neu? 🎁</h2>
    <div class="news-list">
      ${CHANGELOG.map((rel, i) => {
        const isNew = seenIdx === -1 ? i === 0 : i < seenIdx;
        return `<section class="news-release">
          <div class="news-head">
            <span class="news-version">Version ${esc(rel.version)}</span>
            ${isNew ? `<span class="news-new">Neu</span>` : ""}
            <span class="muted small">${esc(fmtDate.format(fromISO(rel.date)))}</span>
          </div>
          <h3>${esc(rel.title)}</h3>
          <ul>${rel.items.map((it) => `<li><span class="news-icon">${it.icon}</span><span>${it.text}</span></li>`).join("")}</ul>
        </section>`;
      }).join("")}
    </div>
    <div class="actions"><button class="btn primary" data-close>Cool, danke!</button></div>`);
  pref.set("news-seen", latestVersion);
  updateNewsDot();
}

// ───────────────────────── Toasts ─────────────────────────
function toast(text, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = text;
  $("#toasts").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3200);
}

// ───────────────────────── App aufs Handy ─────────────────────────
let installPrompt = null;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service Worker:", err));
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  maybeShowInstall();
});
window.addEventListener("appinstalled", () => { $("#install-banner").hidden = true; });

function maybeShowInstall() {
  if (!state.user || isStandalone() || pref.get("install-dismissed", "") === "1") return;
  const banner = $("#install-banner");
  if (installPrompt) {
    $("#install-hint").textContent = "Mit eigenem Symbol auf dem Startbildschirm, ohne Browserleiste.";
    $("#install-btn").hidden = false;
    banner.hidden = false;
  } else if (isIOS()) {
    $("#install-hint").innerHTML = `In Safari unten auf <b>Teilen</b> <svg class="inline" viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg> tippen, dann <b>„Zum Home-Bildschirm“</b>.`;
    $("#install-btn").hidden = true;
    banner.hidden = false;
  }
}

// ───────────────────────── Events binden ─────────────────────────
function bindStatic() {
  $("#login-form").addEventListener("submit", handleLogin);
  $("#btn-logout").addEventListener("click", () => store.logout());
  $("#btn-add").addEventListener("click", () => openEventForm(null, state.view === "week" ? toISO(state.weekStart) > todayISO() ? toISO(state.weekStart) : null : null));
  $("#btn-admin").addEventListener("click", openAdmin);
  $("#btn-news").addEventListener("click", openNews);

  $("#install-btn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $("#install-banner").hidden = true;
  });
  $("#install-close").addEventListener("click", () => { pref.set("install-dismissed", "1"); $("#install-banner").hidden = true; });

  $$(".view-toggle [data-view]").forEach((b) =>
    b.addEventListener("click", () => { state.view = b.dataset.view; pref.set("view", state.view); render(); }));

  const shiftMonth = (n) => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + n, 1); renderCalendar(); };
  const shiftWeek = (n) => { const d = new Date(state.weekStart); d.setDate(d.getDate() + 7 * n); state.weekStart = d; renderWeek(); };
  $("#cal-prev").addEventListener("click", () => shiftMonth(-1));
  $("#cal-next").addEventListener("click", () => shiftMonth(1));
  $("#cal-today").addEventListener("click", () => { const d = new Date(); state.month = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); });
  $("#week-prev").addEventListener("click", () => shiftWeek(-1));
  $("#week-next").addEventListener("click", () => shiftWeek(1));
  $("#week-today").addEventListener("click", () => { state.weekStart = mondayOf(new Date()); renderWeek(); });

  // Wischen (Handy)
  const swipe = (el, prev, next) => {
    let x = null, y = null;
    el.addEventListener("touchstart", (e) => { x = e.touches[0].clientX; y = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchend", (e) => {
      if (x === null) return;
      const dx = e.changedTouches[0].clientX - x, dy = e.changedTouches[0].clientY - y;
      x = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
    });
  };
  swipe($("#cal-grid"), () => shiftMonth(-1), () => shiftMonth(1));
  swipe($("#week-grid"), () => shiftWeek(-1), () => shiftWeek(1));

  $("#cal-grid").addEventListener("click", (e) => { const d = e.target.closest("[data-date]"); if (d) openDay(d.dataset.date); });
  $("#week-grid").addEventListener("click", (e) => {
    const ev = e.target.closest("[data-id]");
    if (ev) return openEventDetail(ev.dataset.id);
    const d = e.target.closest(".wk-head[data-date], .wk-allday[data-date]");
    if (d) openDay(d.dataset.date);
  });
  $("#week-notice").addEventListener("click", (e) => { if (e.target.closest("[data-open-import]")) openImport(); });
  $("#upcoming-list").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openEventDetail(b.dataset.id); });
  $("#event-list").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openEventDetail(b.dataset.id); });

  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    const id = b.dataset.cat;
    if (!id) state.filter.clear();
    else state.filter.has(id) ? state.filter.delete(id) : state.filter.add(id);
    render();
  });

  $("#search").addEventListener("input", (e) => { state.search = e.target.value; renderList(); });
  $("#docs-view").addEventListener("click", (e) => {
    if (e.target.closest("[data-edit-drive]")) openDriveForm();
    else if (e.target.closest("[data-add-link]")) openLinkForm();
    else if (e.target.closest("[data-del-link]")) deleteLink(e.target.closest("[data-del-link]").dataset.delLink);
  });
  $("#docs-view").addEventListener("input", (e) => {
    if (e.target.id === "doc-search") { state.docSearch = e.target.value; renderDocs(); }
  });
  $("#show-past").addEventListener("change", (e) => { state.showPast = e.target.checked; renderList(); });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) return closeModal();
    const t = e.target.closest("[data-close],[data-id],[data-edit],[data-delete],[data-add-date],[data-del-cat],[data-open-import],[data-del-link]");
    if (!t) return;
    if (t.matches("[data-close]")) closeModal();
    else if (t.matches("[data-open-import]")) openImport();
    else if (t.dataset.delLink) deleteLink(t.dataset.delLink);
    else if (t.dataset.edit) openEventForm(state.events.find((x) => x.id === t.dataset.edit));
    else if (t.dataset.delete) deleteEvent(t.dataset.delete);
    else if (t.dataset.addDate) openEventForm(null, t.dataset.addDate);
    else if (t.dataset.delCat) deleteCategory(t.dataset.delCat);
    else if (t.dataset.id && t.classList.contains("day-item")) openEventDetail(t.dataset.id);
  });
  modal.addEventListener("close", () => { modalRefresh = null; });
  $("#confirm").addEventListener("click", (e) => { if (e.target === $("#confirm")) $("#confirm-cancel").click(); });

  // Tastenkürzel: N = neuer Eintrag, ←/→ = blättern
  document.addEventListener("keydown", (e) => {
    if (!state.user || modal.open || $("#confirm").open || state.view === "games" || state.view === "docs") return;
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "n" || e.key === "N") { e.preventDefault(); openEventForm(); }
    if (e.key === "ArrowLeft") state.view === "week" ? shiftWeek(-1) : state.view === "calendar" && shiftMonth(-1);
    if (e.key === "ArrowRight") state.view === "week" ? shiftWeek(1) : state.view === "calendar" && shiftMonth(1);
  });

  // Jede Minute aktualisieren (Jetzt-Linie, „Heute“)
  setInterval(() => { if (state.user && !modal.open) render(); }, 60000);
}
