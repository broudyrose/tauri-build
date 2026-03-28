const AUTO_POLL = false;
const POLL_MS = 2000;

const DURATION_MS = 2600;
const EASE = "cubic-bezier(0.4, 0.0, 0.2, 1)";

let current = [];
let inFlight = false;
let animating = false;

/* =========================
   TIME
========================= */
function hhmmNow() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/* =========================
   TAURI invoke
========================= */
async function getInvoke() {
  const g = window.__TAURI__?.core?.invoke;
  if (typeof g === "function") return g;
  const mod = await import("@tauri-apps/api/core");
  if (typeof mod.invoke === "function") return mod.invoke;
  throw new Error("invoke недоступен");
}

/* =========================
   CSS VARS
========================= */
function cssPxVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function metaH() {
  // --metaH может быть px, parseFloat хватает
  return cssPxVar("--metaH", 118);
}

function gapPx() {
  return cssPxVar("--gap", 16);
}

/* =========================
   THEME (crossfade)
========================= */
let themeActive = "A";

function setThemeCrossfade(dataUrl) {
  const a = document.getElementById("bgA");
  const b = document.getElementById("bgB");
  if (!a || !b || !dataUrl) return;

  const nextLayer = themeActive === "A" ? b : a;
  const curLayer = themeActive === "A" ? a : b;

  const targetOpacity =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--themeOpacity")
      .trim() || "1.0";

  nextLayer.style.backgroundImage = `url("${dataUrl}")`;
  nextLayer.style.opacity = targetOpacity;
  curLayer.style.opacity = "0";

  window.setTimeout(() => {
    themeActive = themeActive === "A" ? "B" : "A";
    const newCur = themeActive === "A" ? a : b;
    const newOther = themeActive === "A" ? b : a;
    newCur.style.opacity = targetOpacity;
    newOther.style.opacity = "0";
  }, 2700);
}

function setThemeFromFirst(items) {
  const url = items?.[0]?.poster_data_url;
  if (url) setThemeCrossfade(url);
}

/* =========================
   HELPERS
========================= */
const NOSESS_RID = "__noSessions__";

function placeNoSessionsAtFirstSlot() {
  const el = document.getElementById("noSessions");
  const viewportEl = document.getElementById("viewport");
  const stripEl = document.getElementById("strip");
  const slot = document.querySelector("#strip .card"); // первая позиция (в т.ч. placeholder)
  if (!el || !viewportEl || !stripEl || !slot) return;

  const v = viewportEl.getBoundingClientRect();
  const r = slot.getBoundingClientRect();
  const s = stripEl.getBoundingClientRect();

  // Полоса от левого края первой карточки до правого края ряда
  const left = r.left - v.left;
  const top = r.top - v.top;
  const width = Math.max(0, s.right - r.left);
  const height = r.height;

  el.style.position = "absolute";
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.margin = "0";
  el.style.zIndex = "500";
  el.style.pointerEvents = "none";
}

function placeholder(i) {
  return {
    rid: `placeholder-${i}`,
    id: 0,
    time: "--:--",
    title: "Нет сеанса",
    poster_data_url: null,
  };
}

function normalizeToFive(items) {
  const out = [...items];
  while (out.length < 5) out.push(placeholder(out.length));
  return out.slice(0, 5);
}

function onlyRealSessions(items) {
  return items.filter(x => x.id !== 0);
}

function hasRealSessions(items) {
  return items.some(x => x.id !== 0);
}

function sameSequence(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].rid !== b[i].rid) return false;
  return true;
}

function cancelAllAnimations() {
  document.getAnimations().forEach((a) => a.cancel());
}

/* =========================
   RENDER
========================= */
function cardHtml(x, isNext) {
  const img = x.poster_data_url ? `<img src="${x.poster_data_url}" alt="">` : ``;
  const pill = x.time ? `<div class="timePill">${x.time}</div>` : ``;
  return `
    <article class="card ${isNext ? "is-next" : ""}" data-rid="${x.rid}" data-id="${x.id}">
      ${pill}
      <div class="poster">${img}</div>
      <div class="meta">
        <div class="title">${x.title}</div>
      </div>
    </article>
  `;
}

function applyZByOrder(forceTopRid = null) {
  const cards = [...document.querySelectorAll("#strip .card")];
  cards.forEach((el, i) => {
    el.style.zIndex = String(1000 - i);
  });
  if (forceTopRid) {
    const top = cards.find((x) => x.dataset.rid === forceTopRid);
    if (top) top.style.zIndex = "5000";
  }
}

function renderFive(items) {
  const strip = document.getElementById("strip");
  const base = normalizeToFive(items);

  strip.innerHTML = base.map((x, i) => cardHtml(x, i === 0)).join("");

  // прячем/схлопываем пустые карточки (id=0) по режиму
  hidePlaceholders();

  // z-index ставим по порядку только для видимых
  const visible = [...strip.querySelectorAll('.card:not([data-id="0"])')];
  visible.forEach((el, i) => (el.style.zIndex = String(1000 - i)));

  const topRid = visible[0]?.dataset?.rid ?? null;
  if (topRid) {
    const top = visible.find((x) => x.dataset.rid === topRid);
    if (top) top.style.zIndex = "5000";
  }
}

function hidePlaceholders() {
  const strip = document.getElementById("strip");
  if (!strip) return;

  const hasAnyReal = !!strip.querySelector('.card:not([data-id="0"])');

  strip.querySelectorAll('.card[data-id="0"]').forEach((el) => {
    if (hasAnyReal) {
      // как было: полностью убираем пустые карточки
      el.style.display = "none";
      el.style.visibility = "";
    } else {
      // НЕТ сеансов: оставляем layout (позиции) но не показываем карточки
      el.style.display = "";
      el.style.visibility = "hidden";
    }
  });
}

/* =========================
   BADGE ("Далее") follows first card position (but is not inside card)
========================= */
function positionNextBadge() {
  if (animating) return;
  const badge = document.getElementById("nextBadge");
  const viewport = document.getElementById("viewport");
  const first = document.querySelector('#strip .card:not([data-id="0"])');

  if (!badge || !viewport || !first) return;

  const v = viewport.getBoundingClientRect();
  const r = first.getBoundingClientRect();
  const pad = 16;

  badge.style.left = `${r.left - v.left + pad - 30}px`;
  badge.style.top  = `${r.top  - v.top  + pad - 70}px`;
}

/* =========================
   DATA
========================= */
async function fetchUpcoming(invoke, limit = 5, nowOverride = null) {
  if (inFlight) return null;
  inFlight = true;
  try {
    return await invoke("get_upcoming_posters", { limit, now: (nowOverride ?? hhmmNow()) });
  } finally {
    inFlight = false;
  }
}

function computeNextFromFetched(fetched) {
  const list = Array.isArray(fetched) ? fetched : [];
  if (!list.length) return null;

  if (!current.length) return normalizeToFive(list.slice(0, 5));

  const idx = list.findIndex((x) => x.rid === current[0].rid);
  if (idx === -1) return normalizeToFive(list.slice(0, 5));

  return normalizeToFive(list.slice(idx + 1, idx + 6));
}

/* =========================
   GEOMETRY (baseline-based)
   baseline = bottom - metaH (нижняя граница постера)
========================= */
function captureRects() {
  const viewport = document.getElementById("viewport").getBoundingClientRect();
  const cards = [...document.querySelectorAll("#strip .card")];
  const mh = metaH();

  const map = new Map();
  for (const el of cards) {
    const rid = el.dataset.rid;
    const r = el.getBoundingClientRect();

    const left = r.left - viewport.left;
    const top = r.top - viewport.top;
    const width = r.width;
    const height = r.height;

    const bottom = top + height;
    const baseY = bottom - mh; // линия "основания афиши"

    map.set(rid, { left, top, bottom, width, height, baseY });
  }

  // + noSessions как участник FLIP (берём геометрию ПЕРВОЙ карточки,
  // чтобы движение было 1-в-1 как у карточки, но ширина надписи может быть любой)
  const ns = document.getElementById("noSessions");
  if (ns && getComputedStyle(ns).display !== "none") {
    const slot = document.querySelector("#strip .card");
    if (slot) {
      const r = slot.getBoundingClientRect();

      const left = r.left - viewport.left;
      const top = r.top - viewport.top;
      const width = r.width;
      const height = r.height;

      const bottom = top + height;
      const baseY = bottom - mh;

      map.set(NOSESS_RID, { left, top, bottom, width, height, baseY });
    }
  }

  return { map };
}

/* =========================
   GHOSTS (no blink)
========================= */
function makeStripGhost() {
  const viewportEl = document.getElementById("viewport");
  const strip = document.getElementById("strip");
  if (!viewportEl || !strip) return null;

  const ghost = document.createElement("div");
  ghost.id = "stripGhost";
  ghost.innerHTML = strip.innerHTML; // слепок старого ряда

  viewportEl.appendChild(ghost);
  return ghost;
}

function fadeOutAndRemove(el) {
  if (!el) return;
  el.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 160,
    easing: "linear",
    fill: "forwards",
  }).onfinish = () => el.remove();
}

/* =========================
   GHOST of old first (fly-out)
========================= */

function makeGhostOfNoSessions() {
  const ns = document.getElementById("noSessions");
  const viewportEl = document.getElementById("viewport");
  if (!ns || !viewportEl) return null;

  const v = viewportEl.getBoundingClientRect();
  const r = ns.getBoundingClientRect();

  const ghost = ns.cloneNode(true);
  ghost.style.position = "absolute";
  ghost.style.left = `${r.left - v.left}px`;
  ghost.style.top = `${r.top - v.top}px`;
  ghost.style.width = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "800";

  viewportEl.appendChild(ghost);
  return ghost;
}


function makeGhostOfFirst() {
  const viewportEl = document.getElementById("viewport");
  const first = document.querySelector("#strip .card");
  if (!viewportEl || !first) return null;

  const v = viewportEl.getBoundingClientRect();
  const r = first.getBoundingClientRect();

  const ghost = first.cloneNode(true);
  ghost.style.position = "absolute";
  ghost.style.left = `${r.left - v.left}px`;
  ghost.style.top = `${r.top - v.top}px`;
  ghost.style.width = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "800";

  viewportEl.appendChild(ghost);
  return ghost;
}

function updateNoSessionsText(items, keepShown = false) {
  const el = document.getElementById("noSessions");
  if (!el) return;

  const want = !hasRealSessions(items);

  // если хотим скрыть, но идет анимация "ухода" — держим видимым до конца
  el.style.display = (want || keepShown) ? "block" : "none";

  if (el.style.display !== "none") {
    placeNoSessionsAtFirstSlot();
  }
}

/* =========================
   FLIP TRANSITION
========================= */
function runFlipTransition(next5) {
  if (animating) return;
  if (!next5 || next5.length < 5) return;

  if (!current.length) {
    current = next5;

    renderFive(current);
    updateNoSessionsText(current, false);

    setThemeFromFirst(current);
    positionNextBadge();
    return;
  }

  if (sameSequence(current, next5)) return;

  const wasNoSessions = !hasRealSessions(current);
  const willNoSessions = !hasRealSessions(next5);

  animating = true;
  cancelAllAnimations();

  const strip = document.getElementById("strip");
  const gap = gapPx();
  const nextRid = next5[0].rid;

  setThemeFromFirst(next5);

  // 0) делаем слепок старого ряда, чтобы НЕ было моргания
  const stripGhost = makeStripGhost();

  // noSessions BEFORE
  updateNoSessionsText(current, false);
  placeNoSessionsAtFirstSlot();

  // 1) capture BEFORE
  const start = captureRects();

  // 2) ghost of old first
  const ghost = makeGhostOfFirst();

  // 3) render AFTER
  renderFive(next5);
  applyZByOrder(nextRid);

  // noSessions AFTER (держим при уходе)
  updateNoSessionsText(next5, (!willNoSessions && wasNoSessions));
  placeNoSessionsAtFirstSlot();

  // 4) capture AFTER
  const end = captureRects();

  // "новые" элементы стартуют как будто это 6-я карточка справа
  const newRids = new Set();
  for (const [rid, e] of end.map.entries()) {
    if (rid === NOSESS_RID) {
      // Надпись должна появляться так же, как "новая карточка" (с правого края)
      if (!start.map.has(NOSESS_RID)) {
        newRids.add(NOSESS_RID);
        start.map.set(NOSESS_RID, {
          left: e.left + e.width + gap,
          top: e.top,
          bottom: e.bottom,
          width: e.width,
          height: e.height,
          baseY: e.baseY,
        });
      }
      continue;
    }

    if (!start.map.has(rid)) {
      newRids.add(rid);
      start.map.set(rid, {
        left: e.left + e.width + gap,
        top: e.top,
        bottom: e.bottom,
        width: e.width,
        height: e.height,
        baseY: e.baseY, // держим baseline
      });
    }
  }

  const newCards = [...document.querySelectorAll("#strip .card")];
  const noSessionsEl = document.getElementById("noSessions");
  const animEls = noSessionsEl ? [...newCards, noSessionsEl] : [...newCards];

  // 5) invert transforms (по baseline, а не по bottom)
  for (const el of animEls) {
    const rid = el.classList?.contains("card") ? el.dataset.rid : NOSESS_RID;
    const s = start.map.get(rid);
    const e = end.map.get(rid);
    if (!s || !e) continue;

    let sx = s.width / e.width;
    let sy = s.height / e.height;

    // убираем микроскейл (дрожание текста)
    if (Math.abs(sx - 1) < 0.003) sx = 1;
    if (Math.abs(sy - 1) < 0.003) sy = 1;

    const dx = Math.round(s.left - e.left);
    const dy = Math.round(s.baseY - e.baseY);

    el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;

    if (el.classList?.contains("card")) {
      if (newRids.has(rid)) {
        el.style.opacity = "0";
        el.style.filter = "blur(2px)";
      } else {
        el.style.opacity = "1";
        el.style.filter = "blur(0px)";
      }
    } else {
      // noSessions
      if (newRids.has(NOSESS_RID)) {
        el.style.opacity = "0";
        el.style.filter = "blur(2px)";
      } else {
        el.style.opacity = "1";
        el.style.filter = "blur(0px)";
      }
    }
  }

  // 6) reflow
  void strip.offsetWidth;

  // 7) старый слепок убираем чуть позже, чтобы вообще не было “пустого кадра”
  if (ghost) {
    ghost
      .animate(
        [
          { transform: "translate3d(0px,0px,0) scale(1)", opacity: 1, filter: "blur(0px)" },
          { transform: "translate3d(-230px,0px,0) scale(0.9)", opacity: 0, filter: "blur(10px)" },
        ],
        { duration: DURATION_MS, easing: EASE, fill: "forwards" }
      )
      .onfinish = () => ghost.remove();
  }

  // noSessions уезжает ТОЧНО как карточка (через ghost)
  if (wasNoSessions && !willNoSessions) {
    const ns = document.getElementById("noSessions");
    const nsGhost = makeGhostOfNoSessions();
    if (ns && nsGhost) {
      // оригинал сразу прячем, анимацию делает ghost
      ns.style.display = "none";

      nsGhost
        .animate(
          [
            { transform: "translate3d(0px,0px,0) scale(1)", opacity: 1, filter: "blur(0px)" },
            { transform: "translate3d(-230px,0px,0) scale(0.9)", opacity: 0, filter: "blur(10px)" },
          ],
          { duration: DURATION_MS, easing: EASE, fill: "forwards" }
        )
        .onfinish = () => nsGhost.remove();
    }
  }

  // 8) start animations cleanly (no extra frame)
  requestAnimationFrame(() => {
    if (stripGhost) stripGhost.remove();

    const animations = [];

    for (const el of animEls) {
      const fromTransform = el.style.transform || "translate3d(0px,0px,0) scale(1,1)";
      const fromOpacity = el.style.opacity || "1";
      const fromFilter = el.style.filter || "blur(0px)";

      animations.push(
        el.animate(
          [
            { transform: fromTransform, opacity: fromOpacity, filter: fromFilter },
            { transform: "translate3d(0px,0px,0) scale(1,1)", opacity: 1, filter: "blur(0px)" },
          ],
          { duration: DURATION_MS, easing: EASE, fill: "forwards" }
        )
      );
    }

    Promise.allSettled(animations.map((a) => a.finished)).then(() => {
      for (const el of animEls) {
        el.style.transform = "";
        el.style.opacity = "";
        el.style.filter = "";
      }
      cancelAllAnimations();
      current = next5;
      animating = false;
      updateNoSessionsText(current, false);
      positionNextBadge();
    });
  });
}

/* =========================
   DEBUG REMOVE (button)
========================= */
async function debugRemoveFirst(invoke) {
  if (animating) return;
  const fetched = await fetchUpcoming(invoke, 2500, "00:00");
  if (!fetched || !fetched.length) return;

  const next5 = computeNextFromFetched(fetched);
  if (!next5) return;

  runFlipTransition(next5);
}

/* =========================
   INIT
========================= */
window.addEventListener("DOMContentLoaded", async () => {
  const invoke = await getInvoke();

  const first = await fetchUpcoming(invoke, 5);
  if (first) {
    current = normalizeToFive(first);
    renderFive(current);
    updateNoSessionsText(current, false);
    setThemeFromFirst(current);
    positionNextBadge();
  }

  window.addEventListener("resize", () => {
    positionNextBadge();
    placeNoSessionsAtFirstSlot();
  });

  if (AUTO_POLL) {
    setInterval(async () => {
      const fetched = await fetchUpcoming(invoke, 250, "00:00");
      if (!fetched) return;
      runFlipTransition(normalizeToFive(fetched.slice(0, 5)));
    }, POLL_MS);
  }

  document
    .getElementById("debugRemove")
    ?.addEventListener("click", () => debugRemoveFirst(invoke));
});
