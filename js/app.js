import { createStore, isDemo } from "./store.js";
import { SITE_NAME } from "./config.js";

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
const dayDiff = (a, b) => {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

const dtf = (o) => new Intl.DateTimeFormat("de-CH", o);
const fmtMonthYear = dtf({ month: "long", year: "numeric" });
const fmtLong = dtf({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = dtf({ day: "numeric", month: "short" });
const fmtWeekday = dtf({ weekday: "short" });
const fmtDate = dtf({ day: "2-digit", month: "2-digit", year: "numeric" });
const weekdayShort = (iso) => fmtWeekday.format(fromISO(iso)).replace(".", "");

function relLabel(iso) {
  const d = dayDiff(todayISO(), iso);
  if (d === 0) return "Heute";
  if (d === 1) return "Morgen";
  if (d === -1) return "Gestern";
  return d > 0 ? `in ${d} Tagen` : `vor ${-d} Tagen`;
}

const pref = {
  get(k, def) { try { return localStorage.getItem("kal-" + k) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem("kal-" + k, v); } catch { /* egal */ } },
};

// ───────────────────────── Zustand ─────────────────────────
const state = {
  user: null,
  events: [],
  categories: [],
  view: pref.get("view", "calendar") === "list" ? "list" : "calendar",
  month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
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
  ];
  render();
}

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

function filteredEvents() {
  const q = state.search.trim().toLowerCase();
  return state.events.filter((e) => {
    if (state.filter.size && !state.filter.has(e.category)) return false;
    if (q && ![e.title, e.subject, e.note, catById(e.category).name].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

// ───────────────────────── Rendern ─────────────────────────
function render() {
  if (!state.user) return;
  $$(".view-toggle [data-view]").forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  $("#calendar-view").hidden = state.view !== "calendar";
  $("#list-view").hidden = state.view !== "list";
  renderFilters();
  if (state.view === "calendar") { renderCalendar(); renderUpcoming(); }
  else renderList();
}

function renderFilters() {
  // Filter auf gelöschte Kategorien entfernen
  for (const id of state.filter) if (!state.categories.some((c) => c.id === id)) state.filter.delete(id);
  const chips = state.categories.map((c) => `
    <button class="filter-chip ${state.filter.has(c.id) ? "on" : ""}" data-cat="${esc(c.id)}" style="--c:${safeColor(c.color)}">
      <span class="dot"></span>${esc(c.name)}
    </button>`).join("");
  $("#filters").innerHTML = `
    <button class="filter-chip all ${state.filter.size ? "" : "on"}" data-cat="">Alle</button>${chips}`;
}

function chipHTML(e) {
  const c = catById(e.category);
  return `<span class="chip" style="--c:${safeColor(c.color)}" title="${esc(e.title)}">
    ${e.time ? `<b>${esc(e.time)}</b> ` : ""}${esc(e.title)}</span>`;
}

function renderCalendar() {
  const m = state.month;
  const year = m.getFullYear(), mon = m.getMonth();
  $("#cal-title").textContent = fmtMonthYear.format(m);

  const offset = (new Date(year, mon, 1).getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const today = todayISO();

  const byDate = new Map();
  for (const e of filteredEvents()) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  let html = "";
  for (let i = 0; i < cells; i++) {
    const d = new Date(year, mon, 1 - offset + i);
    const iso = toISO(d);
    const evs = byDate.get(iso) || [];
    const cls = ["day"];
    if (d.getMonth() !== mon) cls.push("other");
    if (iso === today) cls.push("today");
    if (iso < today) cls.push("past");
    if (i % 7 >= 5) cls.push("weekend");
    if (evs.length) cls.push("has-events");
    const max = 3;
    const label = `${fmtLong.format(d)}${evs.length ? `, ${evs.length} Eintr${evs.length === 1 ? "ag" : "äge"}` : ""}`;
    html += `<button class="${cls.join(" ")}" data-date="${iso}" aria-label="${esc(label)}">
      <span class="num">${d.getDate()}</span>
      <span class="chips">${evs.slice(0, max).map(chipHTML).join("")}${evs.length > max ? `<span class="more">+${evs.length - max} weitere</span>` : ""}</span>
      <span class="dots">${evs.slice(0, 4).map((e) => `<i style="--c:${safeColor(catById(e.category).color)}"></i>`).join("")}</span>
    </button>`;
  }
  $("#cal-grid").innerHTML = html;
}

function renderUpcoming() {
  const today = todayISO();
  const items = filteredEvents().filter((e) => e.date >= today).slice(0, 6);
  $("#upcoming-list").innerHTML = items.length
    ? items.map((e) => {
        const c = catById(e.category);
        const d = dayDiff(today, e.date);
        return `<button class="up-item" data-id="${esc(e.id)}" style="--c:${safeColor(c.color)}">
          <span class="up-bar"></span>
          <span class="up-main">
            <span class="up-title">${esc(e.title)}</span>
            <span class="up-meta">${esc(weekdayShort(e.date))}, ${esc(fmtShort.format(fromISO(e.date)))}${e.time ? ` · ${esc(e.time)}` : ""}</span>
          </span>
          <span class="up-rel ${d <= 2 ? "soon" : ""}">${esc(relLabel(e.date))}</span>
        </button>`;
      }).join("")
    : `<p class="empty-small">Keine anstehenden Termine 🎉</p>`;
}

function renderList() {
  const today = todayISO();
  const items = filteredEvents().filter((e) => state.showPast || e.date >= today);
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
      const past = e.date < today;
      const d = dayDiff(today, e.date);
      html += `<button class="list-item ${past ? "past" : ""}" data-id="${esc(e.id)}" style="--c:${safeColor(c.color)}">
        <span class="li-date"><span class="li-wd">${esc(weekdayShort(e.date))}</span><span class="li-day">${fromISO(e.date).getDate()}</span></span>
        <span class="li-main">
          <span class="li-title">${esc(e.title)}</span>
          <span class="li-meta">
            <span class="badge">${esc(c.name)}</span>
            ${e.subject ? `<span>${esc(e.subject)}</span>` : ""}
            ${e.time ? `<span>${esc(e.time)} Uhr</span>` : ""}
          </span>
          ${e.note ? `<span class="li-note">${esc(e.note)}</span>` : ""}
        </span>
        <span class="li-rel ${!past && d <= 2 ? "soon" : ""}">${esc(relLabel(e.date))}</span>
      </button>`;
    }
    html += `</div>`;
  }
  $("#event-list").innerHTML = html;
}

// ───────────────────────── Modals ─────────────────────────
const modal = $("#modal");
let modalRefresh = null; // wird neu gezeichnet, wenn sich Daten ändern

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

// Tag im Kalender angeklickt
function openDay(iso) {
  const evs = filteredEvents().filter((e) => e.date === iso);
  if (!evs.length) return openEventForm(null, iso);
  const draw = () => {
    const list = filteredEvents().filter((e) => e.date === iso);
    openModal(`
      ${closeBtn}
      <p class="eyebrow">${esc(relLabel(iso))}</p>
      <h2>${esc(fmtLong.format(fromISO(iso)))}</h2>
      <div class="day-list">
        ${list.length ? list.map((e) => {
          const c = catById(e.category);
          return `<button class="day-item" data-id="${esc(e.id)}" style="--c:${safeColor(c.color)}">
            <span class="up-bar"></span>
            <span class="up-main">
              <span class="up-title">${esc(e.title)}</span>
              <span class="up-meta">${esc(c.name)}${e.subject ? ` · ${esc(e.subject)}` : ""}${e.time ? ` · ${esc(e.time)} Uhr` : ""}</span>
            </span>
            <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
          </button>`;
        }).join("") : `<p class="empty-small">Keine Einträge mehr an diesem Tag.</p>`}
      </div>
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
    openModal(`
      ${closeBtn}
      <span class="badge lg" style="--c:${safeColor(c.color)}"><span class="dot"></span>${esc(c.name)}</span>
      <h2 class="detail-title">${esc(e.title)}</h2>
      <dl class="detail">
        <div><dt>Datum</dt><dd>${esc(fmtLong.format(fromISO(e.date)))} <span class="muted">· ${esc(relLabel(e.date))}</span></dd></div>
        ${e.time ? `<div><dt>Zeit</dt><dd>${esc(e.time)} Uhr</dd></div>` : ""}
        ${e.subject ? `<div><dt>Fach</dt><dd>${esc(e.subject)}</dd></div>` : ""}
        ${e.note ? `<div><dt>Notiz</dt><dd class="note">${esc(e.note)}</dd></div>` : ""}
      </dl>
      <p class="meta-line">Eingetragen von ${who}${created ? ` am ${esc(fmtDate.format(created))}` : ""}</p>
      <div class="actions">
        ${state.user.isAdmin ? `
          <button class="btn ghost danger-text" data-delete="${esc(e.id)}">Löschen</button>
          <button class="btn ghost" data-edit="${esc(e.id)}">Bearbeiten</button>` : ""}
        <button class="btn primary" data-close>Schliessen</button>
      </div>`, null, draw);
  };
  draw();
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
      <div class="row">
        <label class="field"><span>Datum *</span><input type="date" name="date" required value="${esc(date)}"></label>
        <label class="field"><span>Uhrzeit</span><input type="time" name="time" value="${esc(e.time)}"></label>
      </div>
      <label class="field">
        <span>Fach</span>
        <input name="subject" maxlength="60" list="subject-list" value="${esc(e.subject)}" placeholder="z.B. Mathematik">
        <datalist id="subject-list">${subjects.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      </label>
      <label class="field">
        <span>Notiz</span>
        <textarea name="note" maxlength="1000" rows="3" placeholder="Stoff, Raum, Hilfsmittel …">${esc(e.note)}</textarea>
      </label>
      ${state.user.isAdmin ? "" : `<p class="hint">Nur der Admin kann Einträge ändern oder löschen. Bitte prüf alles, bevor du speicherst.</p>`}
      <p class="form-error" hidden></p>
      <div class="actions">
        <button type="button" class="btn ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn primary">Speichern</button>
      </div>
    </form>`, (body) => {
    const form = $("#event-form", body);
    if (!existing) form.title.focus();
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const errEl = $(".form-error", form);
      const data = {
        title: form.title.value.trim(),
        category: form.category.value,
        date: form.date.value,
        time: form.time.value || "",
        subject: form.subject.value.trim(),
        note: form.note.value.trim(),
      };
      const problem = !data.title ? "Bitte gib einen Titel ein." :
        !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ? "Bitte wähle ein Datum." :
        !data.category ? "Bitte wähle eine Kategorie." : "";
      if (problem) { errEl.textContent = problem; errEl.hidden = false; return; }
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      btn.textContent = "Speichern …";
      try {
        if (existing) await store.updateEvent(existing.id, data);
        else await store.addEvent(data);
        closeModal();
        toast(existing ? "Eintrag gespeichert" : "Eintrag hinzugefügt", "success");
        // Kalender auf den Monat des neuen Eintrags springen
        const d = fromISO(data.date);
        state.month = new Date(d.getFullYear(), d.getMonth(), 1);
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

// ───────────────────────── Kategorien (Admin) ─────────────────────────
const PALETTE = ["#e5484d", "#3e63dd", "#30a46c", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#ffb224"];

function openCategories() {
  if (!state.user.isAdmin) return;
  const draw = () => {
    const used = new Set(state.categories.map((c) => c.color.toLowerCase()));
    const nextColor = PALETTE.find((p) => !used.has(p)) || PALETTE[0];
    openModal(`
      ${closeBtn}
      <h2>Kategorien</h2>
      <p class="muted small">Nur du als Admin kannst Kategorien erstellen, umbenennen und löschen.</p>
      <ul class="cat-list">
        ${state.categories.map((c) => {
          const n = state.events.filter((e) => e.category === c.id).length;
          return `<li data-id="${esc(c.id)}">
            <input type="color" value="${safeColor(c.color)}" aria-label="Farbe">
            <input type="text" value="${esc(c.name)}" maxlength="40" aria-label="Name">
            <span class="count">${n}</span>
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

// ───────────────────────── Toasts ─────────────────────────
function toast(text, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = text;
  $("#toasts").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2800);
}

// ───────────────────────── Events binden ─────────────────────────
function bindStatic() {
  $("#login-form").addEventListener("submit", handleLogin);
  $("#btn-logout").addEventListener("click", () => store.logout());
  $("#btn-add").addEventListener("click", () => openEventForm());
  $("#btn-categories").addEventListener("click", openCategories);

  $$(".view-toggle [data-view]").forEach((b) =>
    b.addEventListener("click", () => { state.view = b.dataset.view; pref.set("view", state.view); render(); }));

  $("#cal-prev").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); });
  $("#cal-next").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); });
  $("#cal-today").addEventListener("click", () => { const d = new Date(); state.month = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); });

  // Wischen im Kalender (Handy)
  let touchX = null;
  const grid = $("#cal-grid");
  grid.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  grid.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) (dx < 0 ? $("#cal-next") : $("#cal-prev")).click();
  });

  grid.addEventListener("click", (e) => { const d = e.target.closest("[data-date]"); if (d) openDay(d.dataset.date); });
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
  $("#show-past").addEventListener("change", (e) => { state.showPast = e.target.checked; renderList(); });

  // Klicks innerhalb des Modals
  modal.addEventListener("click", (e) => {
    if (e.target === modal) return closeModal(); // Klick auf Hintergrund
    const t = e.target.closest("[data-close],[data-id],[data-edit],[data-delete],[data-add-date],[data-del-cat]");
    if (!t) return;
    if (t.matches("[data-close]")) closeModal();
    else if (t.dataset.edit) openEventForm(state.events.find((x) => x.id === t.dataset.edit));
    else if (t.dataset.delete) deleteEvent(t.dataset.delete);
    else if (t.dataset.addDate) openEventForm(null, t.dataset.addDate);
    else if (t.dataset.delCat) deleteCategory(t.dataset.delCat);
    else if (t.dataset.id && t.classList.contains("day-item")) openEventDetail(t.dataset.id);
  });
  modal.addEventListener("close", () => { modalRefresh = null; });
  $("#confirm").addEventListener("click", (e) => { if (e.target === $("#confirm")) $("#confirm-cancel").click(); });

  // Tastenkürzel: N = neuer Eintrag, ←/→ = Monat wechseln
  document.addEventListener("keydown", (e) => {
    if (!state.user || modal.open || $("#confirm").open) return;
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "n" || e.key === "N") { e.preventDefault(); openEventForm(); }
    if (state.view === "calendar" && e.key === "ArrowLeft") $("#cal-prev").click();
    if (state.view === "calendar" && e.key === "ArrowRight") $("#cal-next").click();
  });
}
