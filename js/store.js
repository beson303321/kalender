// Datenschicht: Firebase (echt) oder Demo (lokal im Browser)
import { firebaseConfig, LOGIN_DOMAIN, ADMIN_USERNAME, CLASS_USERNAME } from "./config.js";

const FB = "https://www.gstatic.com/firebasejs/11.0.2";

export const isDemo = !firebaseConfig.apiKey;
export const ADMIN_EMAIL = `${ADMIN_USERNAME}@${LOGIN_DOMAIN}`;

export function usernameToEmail(username) {
  const u = String(username || "").trim().toLowerCase();
  return u.includes("@") ? u : `${u}@${LOGIN_DOMAIN}`;
}

const toUser = (email) => (email ? { email, isAdmin: email.toLowerCase() === ADMIN_EMAIL } : null);

export async function createStore() {
  return isDemo ? createDemoStore() : createFirebaseStore();
}

// ───────────────────────── Firebase ─────────────────────────
async function createFirebaseStore() {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const { initializeApp } = appMod;
  const { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } = authMod;
  const { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } = fsMod;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const watch = (name, cb, onError) =>
    onSnapshot(
      collection(db, name),
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), { fromCache: snap.metadata.fromCache }),
      onError
    );

  return {
    onAuth: (cb) => onAuthStateChanged(auth, (u) => cb(toUser(u?.email))),
    login: (username, password) => signInWithEmailAndPassword(auth, usernameToEmail(username), password),
    logout: () => signOut(auth),

    watchEvents: (cb, onError) => watch("events", cb, onError),
    watchCategories: (cb, onError) => watch("categories", cb, onError),

    addEvent: (data) =>
      addDoc(collection(db, "events"), { ...data, createdBy: auth.currentUser.email, createdAt: serverTimestamp() }),
    updateEvent: (id, data) => updateDoc(doc(db, "events", id), data),
    deleteEvent: (id) => deleteDoc(doc(db, "events", id)),

    addCategory: (data) => addDoc(collection(db, "categories"), data),
    updateCategory: (id, data) => updateDoc(doc(db, "categories", id), data),
    deleteCategory: (id) => deleteDoc(doc(db, "categories", id)),
  };
}

// ─────────────────────────── Demo ───────────────────────────
// Nur zum Ausprobieren, bevor Firebase eingerichtet ist.
function createDemoStore() {
  const KEY = "kalender-demo-v1";
  const listeners = { events: new Set(), categories: new Set() };
  let authCb = () => {};
  let user = null;

  const read = (storage, key) => {
    try { return JSON.parse(storage.getItem(key)); } catch { return null; }
  };
  const write = (storage, key, value) => {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* egal */ }
  };

  let db = read(localStorage, KEY) || seed();
  user = read(sessionStorage, KEY + "-user");

  const save = () => write(localStorage, KEY, db);
  const list = (col) => Object.entries(db[col]).map(([id, v]) => ({ id, ...v }));
  const emit = (col) => listeners[col].forEach((cb) => cb(list(col), { fromCache: false }));
  const newId = () => Math.random().toString(36).slice(2, 12);
  const denied = () => Object.assign(new Error("permission-denied"), { code: "permission-denied" });
  const requireAdmin = () => { if (!user?.isAdmin) throw denied(); };

  const watch = (col) => (cb) => {
    listeners[col].add(cb);
    setTimeout(() => cb(list(col), { fromCache: false }), 0);
    return () => listeners[col].delete(cb);
  };

  function seed() {
    const iso = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const by = `${CLASS_USERNAME}@${LOGIN_DOMAIN}`;
    const now = Date.now();
    const ev = (title, category, offset, time, subject, note) =>
      ({ title, category, date: iso(offset), time, subject, note, createdBy: by, createdAt: now });
    return {
      categories: {
        pruefung: { name: "Prüfung", color: "#e5484d", order: 0 },
        event: { name: "Event", color: "#3e63dd", order: 1 },
      },
      events: {
        a: ev("Mathe Prüfung – Funktionen", "pruefung", 3, "08:15", "Mathematik", "Kapitel 4 und 5, Taschenrechner erlaubt"),
        b: ev("Englisch Vocabulary Test", "pruefung", 6, "10:05", "Englisch", "Unit 7"),
        c: ev("Schulreise", "event", 12, "", "", "Treffpunkt Bahnhof, Wanderschuhe mitnehmen"),
        d: ev("Deutsch Aufsatz", "pruefung", 19, "13:30", "Deutsch", ""),
        e: ev("Physik Prüfung", "pruefung", -4, "08:15", "Physik", "Mechanik"),
      },
    };
  }

  return {
    onAuth(cb) { authCb = cb; setTimeout(() => cb(user), 0); return () => {}; },
    async login(username, password) {
      const u = String(username || "").trim().toLowerCase();
      if (!password || (u !== ADMIN_USERNAME && u !== CLASS_USERNAME)) {
        throw Object.assign(new Error("invalid"), { code: "auth/invalid-credential" });
      }
      user = toUser(usernameToEmail(u));
      write(sessionStorage, KEY + "-user", user);
      authCb(user);
    },
    async logout() {
      user = null;
      try { sessionStorage.removeItem(KEY + "-user"); } catch { /* egal */ }
      authCb(null);
    },

    watchEvents: watch("events"),
    watchCategories: watch("categories"),

    async addEvent(data) {
      if (!user) throw denied();
      db.events[newId()] = { ...data, createdBy: user.email, createdAt: Date.now() };
      save(); emit("events");
    },
    async updateEvent(id, data) { requireAdmin(); Object.assign(db.events[id], data); save(); emit("events"); },
    async deleteEvent(id) { requireAdmin(); delete db.events[id]; save(); emit("events"); },

    async addCategory(data) { requireAdmin(); db.categories[newId()] = data; save(); emit("categories"); },
    async updateCategory(id, data) { requireAdmin(); Object.assign(db.categories[id], data); save(); emit("categories"); },
    async deleteCategory(id) { requireAdmin(); delete db.categories[id]; save(); emit("categories"); },
  };
}
