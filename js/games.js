// Minigames für die Pause. Rekorde werden nur im eigenen Browser gespeichert.

const GAMES = [
  { id: "reaction", name: "Reaktionstest", icon: "⚡", desc: "Tipp, sobald die Fläche grün wird. 5 Runden.", unit: "ms Ø", better: "low", start: reactionGame },
  { id: "math", name: "Kopfrechnen", icon: "🧮", desc: "So viele Aufgaben wie möglich in 60 Sekunden.", unit: "richtig", better: "high", start: mathGame },
  { id: "pairs", name: "Paare finden", icon: "🃏", desc: "Deck alle Paare mit möglichst wenigen Zügen auf.", unit: "Züge", better: "low", start: pairsGame },
  { id: "aim", name: "Ziel-Klick", icon: "🎯", desc: "Triff in 30 Sekunden so viele Ziele wie möglich. Sie werden immer kleiner.", unit: "Treffer", better: "high", start: aimGame },
  { id: "digits", name: "Zahlen merken", icon: "🔢", desc: "Merk dir die Zahl. Mit jeder Runde wird sie eine Ziffer länger.", unit: "Ziffern", better: "high", start: digitsGame },
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = rand(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

const records = {
  get(id) { try { const v = localStorage.getItem("game-" + id); return v === null ? null : Number(v); } catch { return null; } },
  set(id, v) { try { localStorage.setItem("game-" + id, String(v)); } catch { /* egal */ } },
};
const recordText = (g) => { const r = records.get(g.id); return r === null ? "Noch kein Rekord" : `Rekord: ${r} ${g.unit}`; };

export function mountGames(root) {
  let cleanup = null;
  const stop = () => { if (cleanup) { cleanup(); cleanup = null; } };

  function menu() {
    stop();
    root.innerHTML = `
      <div class="games-intro">
        <h2>Pause? 🎮</h2>
        <p class="muted">Kleine Spiele für zwischendurch. Deine Rekorde werden auf diesem Gerät gespeichert.</p>
      </div>
      <div class="games-grid">
        ${GAMES.map((g) => `
          <button class="game-card card" data-game="${g.id}">
            <span class="game-icon">${g.icon}</span>
            <span class="game-name">${esc(g.name)}</span>
            <span class="game-desc">${esc(g.desc)}</span>
            <span class="game-record">${esc(recordText(g))}</span>
          </button>`).join("")}
      </div>`;
  }

  function open(g) {
    stop();
    root.innerHTML = `
      <div class="game-shell card">
        <div class="game-top">
          <button class="btn ghost sm" data-back>
            <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg> Alle Spiele
          </button>
          <div class="game-title"><span>${g.icon}</span> ${esc(g.name)}</div>
          <span class="game-record small">${esc(recordText(g))}</span>
        </div>
        <div class="game-stage"></div>
        <div class="game-result" hidden></div>
      </div>`;
    const stage = root.querySelector(".game-stage");
    const result = root.querySelector(".game-result");
    const finish = (score, detail) => {
      stop();
      const prev = records.get(g.id);
      const isRecord = prev === null || (g.better === "low" ? score < prev : score > prev);
      if (isRecord) records.set(g.id, score);
      result.innerHTML = `
        <div class="gr-emoji">${isRecord ? "🏆" : "🎉"}</div>
        <div class="gr-score">${esc(score)} <small>${esc(g.unit)}</small></div>
        ${isRecord ? `<div class="gr-record">${prev === null ? "Erster Rekord!" : "Neuer Rekord!"}</div>`
                   : `<div class="muted small">Dein Rekord: ${esc(prev)} ${esc(g.unit)}</div>`}
        <p class="gr-detail">${detail}</p>
        <div class="actions center">
          <button class="btn ghost" data-back>Alle Spiele</button>
          <button class="btn primary" data-again>Nochmal</button>
        </div>`;
      result.hidden = false;
      stage.hidden = true;
      root.querySelector(".game-top .game-record").textContent = recordText(g);
      result.querySelector("[data-again]").focus();
    };
    cleanup = g.start(stage, finish) || null;
  }

  root.addEventListener("click", (e) => {
    const card = e.target.closest("[data-game]");
    if (card) return open(GAMES.find((g) => g.id === card.dataset.game));
    if (e.target.closest("[data-back]")) return menu();
    if (e.target.closest("[data-again]")) {
      const title = root.querySelector(".game-title")?.textContent || "";
      const g = GAMES.find((x) => title.includes(x.name));
      if (g) open(g);
    }
  });

  // Wechselt man den Tab, laufende Spiele stoppen
  new MutationObserver(() => { if (root.hidden) menu(); }).observe(root, { attributes: true, attributeFilter: ["hidden"] });

  menu();
}

// ───────────────────────── Reaktionstest ─────────────────────────
function reactionGame(stage, finish) {
  const ROUNDS = 5;
  let phase = "idle", timer = null, t0 = 0;
  const times = [];
  stage.innerHTML = `<button class="rx-pad"></button><p class="g-sub">Runde <b class="rx-round">1</b> von ${ROUNDS}</p>`;
  const pad = stage.querySelector(".rx-pad");
  const set = (cls, html) => { pad.className = "rx-pad " + cls; pad.innerHTML = html; };
  const wait = () => {
    phase = "wait";
    set("wait", "<b>Warte auf Grün …</b>");
    timer = setTimeout(() => { phase = "go"; t0 = performance.now(); set("go", "<b>JETZT!</b>"); }, rand(1200, 4000));
  };
  set("idle", "<b>Tippen zum Starten</b><span>Sobald die Fläche grün wird, so schnell wie möglich tippen.</span>");

  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (phase === "idle" || phase === "between") wait();
    else if (phase === "wait") {
      clearTimeout(timer);
      phase = "between";
      set("early", "<b>Zu früh! 😅</b><span>Tippen für einen neuen Versuch</span>");
    } else if (phase === "go") {
      const ms = Math.round(performance.now() - t0);
      times.push(ms);
      if (times.length >= ROUNDS) {
        phase = "done";
        const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        const verdict = avg < 220 ? "Blitzschnell ⚡" : avg < 270 ? "Sehr gut 💪" : avg < 330 ? "Solide 👍" : "Zeit für einen Kaffee? ☕";
        finish(avg, `${verdict}<br>Schnellste Runde: ${Math.min(...times)} ms · Runden: ${times.join(", ")} ms`);
      } else {
        phase = "between";
        stage.querySelector(".rx-round").textContent = times.length + 1;
        set("result", `<b>${ms} ms</b><span>Tippen für die nächste Runde</span>`);
      }
    }
  });
  return () => clearTimeout(timer);
}

// ───────────────────────── Kopfrechnen ─────────────────────────
function mathGame(stage, finish) {
  let score = 0, left = 60, q = null, timer = null, started = false;
  stage.innerHTML = `
    <div class="g-hud"><span>⏱ <b class="m-time">60</b> s</span><span>✅ <b class="m-score">0</b></span></div>
    <div class="m-q">Bereit?</div>
    <input class="m-in" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Antwort eintippen" disabled>
    <div class="actions center">
      <button class="btn primary m-start">Start</button>
      <button class="btn ghost sm m-skip" hidden>Überspringen</button>
    </div>`;
  const qEl = stage.querySelector(".m-q"), inp = stage.querySelector(".m-in");

  function next() {
    const L = Math.min(4, 1 + Math.floor(score / 5));
    const op = ["+", "−", "×", "÷"][rand(0, L >= 2 ? 3 : 1)];
    let a, b, ans;
    if (op === "+") { a = rand(2, 20 * L); b = rand(2, 20 * L); ans = a + b; }
    else if (op === "−") { a = rand(5, 25 * L); b = rand(1, a); ans = a - b; }
    else if (op === "×") { a = rand(2, 4 + 2 * L); b = rand(2, 9 + L); ans = a * b; }
    else { b = rand(2, 8 + L); ans = rand(2, 8 + L); a = b * ans; }
    q = { ans };
    qEl.textContent = `${a} ${op} ${b} = ?`;
    inp.value = "";
  }

  stage.querySelector(".m-start").addEventListener("click", (e) => {
    if (started) return;
    started = true;
    e.currentTarget.hidden = true;
    stage.querySelector(".m-skip").hidden = false;
    inp.disabled = false;
    inp.focus();
    next();
    timer = setInterval(() => {
      left--;
      stage.querySelector(".m-time").textContent = left;
      if (left <= 10) stage.querySelector(".m-time").classList.add("hot");
      if (left <= 0) {
        clearInterval(timer);
        inp.disabled = true;
        const verdict = score >= 30 ? "Taschenrechner auf zwei Beinen 🤖" : score >= 20 ? "Stark! 💪" : score >= 12 ? "Gut gemacht 👍" : "Übung macht den Meister 📚";
        finish(score, `${verdict}<br>${score} richtige Aufgaben in 60 Sekunden`);
      }
    }, 1000);
  });
  inp.addEventListener("input", () => {
    if (!q || inp.value === "") return;
    if (Number(inp.value) === q.ans) {
      score++;
      stage.querySelector(".m-score").textContent = score;
      qEl.classList.remove("ok"); void qEl.offsetWidth; qEl.classList.add("ok");
      next();
    }
  });
  stage.querySelector(".m-skip").addEventListener("click", () => { next(); inp.focus(); });
  return () => clearInterval(timer);
}

// ───────────────────────── Paare finden ─────────────────────────
function pairsGame(stage, finish) {
  const SYMBOLS = ["📐", "📚", "🧪", "⚛️", "✏️", "🧮", "🌍", "🔬"];
  const deck = shuffle([...SYMBOLS, ...SYMBOLS]);
  let open = [], moves = 0, found = 0, lock = false, t0 = null, timer = null;
  stage.innerHTML = `
    <div class="g-hud"><span>Züge: <b class="p-moves">0</b></span><span>Paare: <b class="p-found">0</b> / ${SYMBOLS.length}</span></div>
    <div class="p-grid">${deck.map((s, i) => `<button class="p-card" data-i="${i}" aria-label="Karte ${i + 1}"><span class="p-inner"><span class="p-back"></span><span class="p-face">${s}</span></span></button>`).join("")}</div>`;
  const cards = [...stage.querySelectorAll(".p-card")];

  stage.querySelector(".p-grid").addEventListener("click", (e) => {
    const card = e.target.closest(".p-card");
    if (!card || lock || card.classList.contains("flipped")) return;
    if (t0 === null) t0 = Date.now();
    card.classList.add("flipped");
    open.push(+card.dataset.i);
    if (open.length < 2) return;
    moves++;
    stage.querySelector(".p-moves").textContent = moves;
    const [a, b] = open;
    open = [];
    if (deck[a] === deck[b]) {
      cards[a].classList.add("matched"); cards[b].classList.add("matched");
      found++;
      stage.querySelector(".p-found").textContent = found;
      if (found === SYMBOLS.length) {
        const secs = Math.round((Date.now() - t0) / 1000);
        timer = setTimeout(() => finish(moves, `Alle Paare in ${moves} Zügen und ${secs} Sekunden gefunden.<br>Das Minimum wären ${SYMBOLS.length} Züge.`), 500);
      }
    } else {
      lock = true;
      timer = setTimeout(() => { cards[a].classList.remove("flipped"); cards[b].classList.remove("flipped"); lock = false; }, 800);
    }
  });
  return () => clearTimeout(timer);
}

// ───────────────────────── Ziel-Klick ─────────────────────────
function aimGame(stage, finish) {
  let hits = 0, misses = 0, left = 30, timer = null, started = false;
  stage.innerHTML = `
    <div class="g-hud"><span>⏱ <b class="a-time">30</b> s</span><span>🎯 <b class="a-hits">0</b></span></div>
    <div class="a-field"><div class="a-start"><b>Tippen zum Starten</b><span>Triff die Ziele. Daneben tippen zählt als Fehler.</span></div></div>`;
  const field = stage.querySelector(".a-field");
  const target = document.createElement("span");
  target.className = "a-target";

  function place() {
    const size = Math.max(26, 64 - hits * 1.6);
    // Position relativ zum Feld → bleibt drin, auch wenn man das Handy dreht
    target.style.width = target.style.height = size + "px";
    target.style.left = `calc((100% - ${size + 8}px) * ${Math.random().toFixed(3)} + 4px)`;
    target.style.top = `calc((100% - ${size + 8}px) * ${Math.random().toFixed(3)} + 4px)`;
    target.classList.remove("pop"); void target.offsetWidth; target.classList.add("pop");
  }

  field.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!started) {
      started = true;
      field.innerHTML = "";
      field.appendChild(target);
      place();
      timer = setInterval(() => {
        left--;
        stage.querySelector(".a-time").textContent = left;
        if (left <= 5) stage.querySelector(".a-time").classList.add("hot");
        if (left <= 0) {
          clearInterval(timer);
          const quote = Math.round((hits / (hits + misses || 1)) * 100);
          finish(hits, `${hits} Treffer, ${misses} daneben · Trefferquote ${quote} %`);
        }
      }, 1000);
      return;
    }
    if (e.target === target) {
      hits++;
      stage.querySelector(".a-hits").textContent = hits;
      place();
    } else {
      misses++;
      field.classList.remove("miss"); void field.offsetWidth; field.classList.add("miss");
    }
  });
  return () => clearInterval(timer);
}

// ───────────────────────── Zahlen merken ─────────────────────────
function digitsGame(stage, finish) {
  let len = 3, num = "", timer = null;
  stage.innerHTML = `
    <p class="g-sub">Stufe: <b class="d-len">3</b> Ziffern</p>
    <div class="d-show">Bereit?</div>
    <div class="d-bar"><i></i></div>
    <form class="d-form" hidden>
      <input class="m-in" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Welche Zahl war es?">
      <button class="btn primary" type="submit">OK</button>
    </form>
    <div class="actions center"><button class="btn primary d-start">Start</button></div>`;
  const show = stage.querySelector(".d-show"), form = stage.querySelector(".d-form"), inp = form.querySelector("input");
  const bar = stage.querySelector(".d-bar i");

  function round() {
    num = String(rand(1, 9)) + Array.from({ length: len - 1 }, () => rand(0, 9)).join("");
    stage.querySelector(".d-len").textContent = len;
    show.textContent = num.replace(/(\d{3})(?=\d)/g, "$1 ");
    show.className = "d-show";
    form.hidden = true;
    const ms = 900 + len * 500;
    bar.style.transition = "none"; bar.style.width = "100%"; void bar.offsetWidth;
    bar.style.transition = `width ${ms}ms linear`; bar.style.width = "0%";
    timer = setTimeout(() => {
      show.textContent = "? ".repeat(Math.min(len, 12)).trim();
      show.className = "d-show hidden-num";
      form.hidden = false;
      inp.value = "";
      inp.focus();
    }, ms);
  }

  stage.querySelector(".d-start").addEventListener("click", (e) => { e.currentTarget.closest(".actions").hidden = true; round(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = inp.value.replace(/\D/g, "");
    if (val === num) {
      show.textContent = "✅ Richtig!";
      show.className = "d-show ok";
      form.hidden = true;
      len++;
      timer = setTimeout(round, 700);
    } else {
      const reached = len - 1;
      finish(reached, `Die Zahl war <b>${esc(num)}</b>, du hast <b>${esc(val || "nichts")}</b> eingegeben.<br>Die meisten Menschen schaffen 7 ± 2 Ziffern.`);
    }
  });
  return () => clearTimeout(timer);
}
