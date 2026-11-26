// Import von Schuldaten: Stundenplan-Datei (.ics aus schulNetz) und Termine aus dem BM-Infoblatt.
// Läuft komplett im Browser – die Datei wird nirgends hochgeladen ausser in eure Datenbank.

export const SUBJECTS = {
  MG: "Mathematik", M: "Mathematik", Ph: "Physik", Ch: "Chemie",
  D: "Deutsch", F: "Französisch", E: "Englisch",
  WR: "Wirtschaft und Recht", GP: "Geschichte und Politik",
  IDPAuF: "IDPA", IDPA: "IDPA", IDAF: "IDAF",
};

export const SUBJECT_SHORT = {
  MG: "M", M: "M", Ph: "Ph", Ch: "Ch", D: "D", F: "F", E: "E",
  WR: "W&R", GP: "G&P", IDPAuF: "IDPA", IDPA: "IDPA", IDAF: "IDAF",
};

export const SUBJECT_COLORS = {
  MG: "#3e63dd", M: "#3e63dd", Ph: "#8e4ec6", Ch: "#12a594",
  D: "#e5484d", F: "#0090ff", E: "#f76b15",
  WR: "#30a46c", GP: "#d6409f", IDPAuF: "#e2a336", IDPA: "#e2a336", IDAF: "#e2a336",
};

export const TEACHERS = {
  MaBru: "Bruggisser", PeBla: "Blattnig", DoEbe: "Eberle", VeFis: "Fischer",
  SiFer: "Ferrari", MiWei: "Weibel", PaTan: "Tanner",
};

export const subjectName = (code) => SUBJECTS[code] || code;
export const teacherNames = (codes) =>
  String(codes || "").split(",").filter(Boolean).map((c) => TEACHERS[c.trim()] || c.trim()).join(", ");

// Termine aus dem öffentlichen „Informationsblatt Schuljahr 2026/2027“ der BM Lenzburg,
// gefiltert auf 26aTB1. Ferien und Feiertage kommen aus der Stundenplan-Datei.
export const INFOBLATT_EVENTS = [
  { id: "ib-england", cat: "Event", title: "Sprachaufenthalt England (freiwillig)", date: "2027-01-24", endDate: "2027-02-06",
    note: "Broadstairs, Hilderstone College. Nach Interesse. Für 26aTB1 evtl. nur die 2. Woche." },
  { id: "ib-bmp-d", cat: "Prüfung", title: "BMP Deutsch", subject: "Deutsch", date: "2027-05-03", time: "09:00", endTime: "11:30" },
  { id: "ib-bmp-e", cat: "Prüfung", title: "BMP Englisch", subject: "Englisch", date: "2027-05-12", time: "09:00", endTime: "11:00" },
  { id: "ib-bmp-mg1", cat: "Prüfung", title: "BMP Mathematik Grundlagen 1", subject: "Mathematik", date: "2027-05-18", time: "08:00", endTime: "09:15" },
  { id: "ib-bmp-ms1", cat: "Prüfung", title: "BMP Mathematik Schwerpunkt 1", subject: "Mathematik", date: "2027-05-18", time: "10:30", endTime: "12:00" },
  { id: "ib-bmp-mg2", cat: "Prüfung", title: "BMP Mathematik Grundlagen 2", subject: "Mathematik", date: "2027-05-21", time: "08:00", endTime: "09:15" },
  { id: "ib-bmp-ms2", cat: "Prüfung", title: "BMP Mathematik Schwerpunkt 2", subject: "Mathematik", date: "2027-05-21", time: "10:30", endTime: "12:00" },
  { id: "ib-bmp-ph", cat: "Prüfung", title: "BMP Physik", subject: "Physik", date: "2027-06-04", time: "09:00", endTime: "10:20" },
  { id: "ib-bmp-ch", cat: "Prüfung", title: "BMP Chemie", subject: "Chemie", date: "2027-06-11", time: "09:00", endTime: "09:40" },
  { id: "ib-auflage", cat: "Event", title: "BM-Prüfungsauflage", date: "2027-06-21", time: "17:00", endTime: "18:00",
    note: "Einsicht in die korrigierten Berufsmaturprüfungen." },
  { id: "ib-diplomfeier", cat: "Event", title: "Diplomfeier", date: "2027-06-25",
    note: "Schloss Lenzburg, mit Eltern, Ausbildungsbetrieben und Lehrpersonen." },
];

// ───────────────────────── ICS lesen ─────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const isoFromYMD = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const addDaysISO = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

function parseDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  if (/VALUE=DATE(;|$)/.test(prop.params) || /^\d{8}$/.test(v)) return { date: isoFromYMD(v), time: "", allDay: true };
  const m = v.match(/^(\d{8})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  if (m[5] === "Z") {
    const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +m[2], +m[3]));
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false };
  }
  return { date: isoFromYMD(m[1]), time: `${m[2]}:${m[3]}`, allDay: false };
}

const unescapeText = (s) => String(s || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

// Einfacher Hash für stabile Dokument-IDs (damit ein erneuter Import nichts doppelt anlegt)
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function parseICS(text) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const left = line.slice(0, idx);
    const [name, ...params] = left.split(";");
    cur[name.toUpperCase()] = { params: params.join(";"), value: line.slice(idx + 1) };
  }

  const lessons = [], exams = [], holidays = [];
  for (const ev of events) {
    const uid = ev.UID?.value || "";
    const summary = unescapeText(ev.SUMMARY?.value);
    const start = parseDate(ev.DTSTART);
    if (!start || !summary) continue;
    let end = parseDate(ev.DTEND);
    if (end && end.allDay && end.date > start.date) end = { ...end, date: addDaysISO(end.date, -1) }; // DTEND bei ganztägig ist exklusiv
    const room = unescapeText(ev.LOCATION?.value);

    // "MG-26aTB1-PeBla Mathematik 2"  →  Fach, Klasse, Lehrperson(en), Rest
    const m = summary.match(/^(\S+?)-(\S+?)-(\S+)(?:\s+(.+))?$/);
    const subj = m ? m[1] : summary.split(/\s+/)[0];
    const teacher = m ? m[3] : "";
    const rest = m ? (m[4] || "") : summary.split(/\s+/).slice(1).join(" ");

    if (/pruefung/i.test(uid)) {
      const name = subjectName(subj);
      let title = rest || name;
      if (rest && !rest.toLowerCase().includes(name.toLowerCase().slice(0, 4))) title = `${name}: ${rest}`;
      exams.push({
        id: "sn-" + hash(uid), title, subject: name, date: start.date,
        time: start.allDay ? "" : start.time, endTime: start.allDay || !end ? "" : end.time,
        room, teacher: teacherNames(teacher),
      });
    } else if (/termin/i.test(uid)) {
      if (/^QV\b/i.test(summary)) continue; // Qualifikationsverfahren betrifft 26aTB1 nicht
      const endDate = end && end.date > start.date ? end.date : "";
      holidays.push({ id: "sn-" + hash(uid), title: summary.replace(/\s*SJ\s*\d{2}\/\d{2}\s*$/, ""), date: start.date, endDate });
    } else if (!start.allDay && end) {
      lessons.push({ date: start.date, start: start.time, end: end.time, subj, room, teacher });
    }
  }
  lessons.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  exams.sort((a, b) => a.date.localeCompare(b.date));
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  return { lessons, exams, holidays };
}

// Lektionen kompakt speichern: "2026-08-10|07:55|10:35|WR|A110|MaBru"
export const packLesson = (l) => [l.date, l.start, l.end, l.subj, l.room, l.teacher].map((x) => String(x || "").replace(/\|/g, "/")).join("|");
export const unpackLesson = (s) => {
  const [date, start, end, subj, room, teacher] = String(s).split("|");
  return { date, start, end, subj, room, teacher };
};
