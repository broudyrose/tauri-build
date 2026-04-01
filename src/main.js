const AUTO_POLL = true;  // debug
const POLL_MS = 1000;

const DURATION_MS = 2600;
const EASE = "cubic-bezier(0.4, 0.0, 0.2, 1)";

let current = [];
let inFlight = false;
let animating = false;

const FULL_W = 1280;
const FULL_H = 704;
const MINI_W = 640;
const MINI_H = 352;

let compactMode = false;

function applyViewportScale() {
  const scene = document.getElementById("scene");
  if (!scene) return;
  scene.style.transform = `scale(${compactMode ? 0.5 : 1})`;
}

function showScene() {
  const scene = document.getElementById("scene");
  if (!scene) return;
  scene.style.visibility = "visible";
}

async function syncCompactModeFromWindow() {
  const w = window.__TAURI__?.window;
  if (!w) return;

  try {
    const win = w.getCurrentWindow();
    const size = await win.innerSize();
    compactMode = size.width <= MINI_W + 4 && size.height <= MINI_H + 4;
  } catch (_) {}
}

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
  const stripEl = document.getElementById("strip");
  const slot = document.querySelector("#strip .card");
  if (!el || !stripEl || !slot) return;

  const left = slot.offsetLeft + 45;
  const top = slot.offsetTop + 70;
  const width = Math.max(0, stripEl.clientWidth - slot.offsetLeft);
  const height = slot.offsetHeight;

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

function sameContent(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].rid !== b[i].rid ||
      a[i].id !== b[i].id ||
      a[i].time !== b[i].time ||
      a[i].title !== b[i].title ||
      a[i].poster_data_url !== b[i].poster_data_url
    ) return false;
  }
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

  hidePlaceholders();

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
      el.style.display = "none";
      el.style.visibility = "";
    } else {
      el.style.display = "";
      el.style.visibility = "hidden";
    }
  });
}

/* =========================
   BADGE ("Далее")
========================= */
function positionNextBadge() {
  if (animating) return;

  const badge = document.getElementById("nextBadge");
  const firstReal = document.querySelector('#strip .card:not([data-id="0"])');
  const firstSlot = document.querySelector('#strip .card');
  const target = firstReal || firstSlot;

  if (!badge || !target) return;

  const pad = 16;
  badge.style.left = `${target.offsetLeft + pad + 15}px`;
  badge.style.top = `${target.offsetTop + pad - 5}px`;
}

/* =========================
   DATA
========================= */
async function fetchUpcoming(invoke, limit = 10, nowOverride = null) {
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
   GEOMETRY
========================= */
function captureRects() {
  const viewport = document.getElementById("scene").getBoundingClientRect();
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
    const baseY = bottom - mh;

    map.set(rid, { left, top, bottom, width, height, baseY });
  }

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
   GHOSTS
========================= */
function makeStripGhost() {
  const viewportEl = document.getElementById("scene");
  const strip = document.getElementById("strip");
  if (!viewportEl || !strip) return null;

  const ghost = document.createElement("div");
  ghost.id = "stripGhost";
  ghost.innerHTML = strip.innerHTML;

  viewportEl.appendChild(ghost);
  return ghost;
}

function makeGhostOfNoSessions() {
  const ns = document.getElementById("noSessions");
  const viewportEl = document.getElementById("scene");
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
  const viewportEl = document.getElementById("scene");
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

  if (sameSequence(current, next5)) {
    if (sameContent(current, next5)) return;

    current = next5;
    renderFive(current);
    updateNoSessionsText(current, false);
    setThemeFromFirst(current);
    positionNextBadge();
    return;
  }

  const wasNoSessions = !hasRealSessions(current);
  const willNoSessions = !hasRealSessions(next5);

  animating = true;
  cancelAllAnimations();

  const strip = document.getElementById("strip");
  const gap = gapPx();
  const nextRid = next5[0].rid;

  setThemeFromFirst(next5);

  const stripGhost = makeStripGhost();

  updateNoSessionsText(current, false);
  placeNoSessionsAtFirstSlot();

  const start = captureRects();
  const ghost = makeGhostOfFirst();

  renderFive(next5);
  applyZByOrder(nextRid);

  updateNoSessionsText(next5, (!willNoSessions && wasNoSessions));
  placeNoSessionsAtFirstSlot();

  const end = captureRects();

  const newRids = new Set();
  for (const [rid, e] of end.map.entries()) {
    if (rid === NOSESS_RID) {
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
        baseY: e.baseY,
      });
    }
  }

  const newCards = [...document.querySelectorAll("#strip .card")];
  const noSessionsEl = document.getElementById("noSessions");
  const animEls = noSessionsEl ? [...newCards, noSessionsEl] : [...newCards];

  for (const el of animEls) {
    const rid = el.classList?.contains("card") ? el.dataset.rid : NOSESS_RID;
    const s = start.map.get(rid);
    const e = end.map.get(rid);
    if (!s || !e) continue;

    let sx = s.width / e.width;
    let sy = s.height / e.height;

    if (Math.abs(sx - 1) < 0.003) sx = 1;
    if (Math.abs(sy - 1) < 0.003) sy = 1;

    const dx = Math.round(s.left - e.left);
    const dy = Math.round(s.baseY - e.baseY);

    el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;

    if (newRids.has(rid) || (!el.classList?.contains("card") && newRids.has(NOSESS_RID))) {
      el.style.opacity = "0";
      el.style.filter = "blur(2px)";
    } else {
      el.style.opacity = "1";
      el.style.filter = "blur(0px)";
    }
  }

  void strip.offsetWidth;

  if (ghost) {
    ghost.animate(
      [
        { transform: "translate3d(0px,0px,0) scale(1)", opacity: 1, filter: "blur(0px)" },
        { transform: "translate3d(-230px,0px,0) scale(0.9)", opacity: 0, filter: "blur(10px)" },
      ],
      { duration: DURATION_MS, easing: EASE, fill: "forwards" }
    ).onfinish = () => ghost.remove();
  }

  if (wasNoSessions && !willNoSessions) {
    const ns = document.getElementById("noSessions");
    const nsGhost = makeGhostOfNoSessions();
    if (ns && nsGhost) {
      ns.style.display = "none";

      nsGhost.animate(
        [
          { transform: "translate3d(0px,0px,0) scale(1)", opacity: 1, filter: "blur(0px)" },
          { transform: "translate3d(-230px,0px,0) scale(0.9)", opacity: 0, filter: "blur(10px)" },
        ],
        { duration: DURATION_MS, easing: EASE, fill: "forwards" }
      ).onfinish = () => nsGhost.remove();
    }
  }

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
   DEBUG REMOVE
========================= */
async function debugRemoveFirst(invoke) {
  if (animating) return;
  const fetched = await fetchUpcoming(invoke, 10);
  if (!fetched || !fetched.length) return;

  const next5 = computeNextFromFetched(fetched);
  if (!next5) return;

  runFlipTransition(next5);
}

/* =========================
   INIT
========================= */
window.addEventListener("DOMContentLoaded", async () => {
  // window controls
  (() => {
    const btnMove = document.getElementById("moveWin");
    const btnClose = document.getElementById("closeWin");

    if (btnMove) btnMove.style.display = "none";

    const w = window.__TAURI__?.window;
    if (!w) return;

    const getNextMonitor = async () => {
      const win = w.getCurrentWindow();
      const monitors = await win.availableMonitors();
      const cur = await win.currentMonitor();
      if (!cur) return null;

      return monitors.find(m =>
        m.name !== cur.name ||
        m.position?.x !== cur.position?.x ||
        m.position?.y !== cur.position?.y ||
        m.size?.width !== cur.size?.width ||
        m.size?.height !== cur.size?.height
      ) || null;
    };

    if (btnClose) {
      btnClose.addEventListener("click", async () => {
        try {
          await w.getCurrentWindow().close();
        } catch (e) {
          console.error("closeWin error:", e);
        }
      });
    }

    if (btnMove) {
      btnMove.addEventListener("click", async () => {
        try {
          const win = w.getCurrentWindow();
          const next = await getNextMonitor();
          if (next) await win.setPosition(next.position);
        } catch (e) {
          console.error("moveWin error:", e);
        }
      });

      (async () => {
        try {
          const next = await getNextMonitor();
          btnMove.style.display = next ? "" : "none";
        } catch (e) {
          console.error("moveWin detect error:", e);
          btnMove.style.display = "none";
        }
      })();
    }
  })();

  let invoke;
  try {
    invoke = await getInvoke();
  } catch (e) {
    console.error("getInvoke error:", e);
    return;
  }

    await syncCompactModeFromWindow();
    applyViewportScale();

  try {
    const first = await fetchUpcoming(invoke, 10);
      if (first) {
      current = normalizeToFive(first);
      renderFive(current);
      updateNoSessionsText(current, false);
      setThemeFromFirst(current);
      positionNextBadge();
      showScene();
    } else {
      showScene();
    }
  } catch (e) {
    console.error("initial fetchUpcoming error:", e);
    showScene();
  }

  applyViewportScale();

  window.addEventListener("resize", () => {
    applyViewportScale();
    positionNextBadge();
    placeNoSessionsAtFirstSlot();
  });

  if (AUTO_POLL) {
    setInterval(async () => {
      try {
        const fetched = await fetchUpcoming(invoke, 10);
        if (!fetched) return;
        runFlipTransition(normalizeToFive(fetched));
      } catch (e) {
        console.error("poll fetchUpcoming error:", e);
      }
    }, POLL_MS);
  }

  document.getElementById("debugRemove")?.addEventListener("click", () => {
    debugRemoveFirst(invoke).catch((e) => console.error("debugRemove error:", e));
  });

    // drag + double click resize
    // drag + double click resize
  const w = window.__TAURI__?.window;
  const viewport = document.getElementById("scene");
  const dpi = window.__TAURI__?.dpi || await import("@tauri-apps/api/dpi");

  let dragStart = null;
  let dragStarted = false;

  viewport?.addEventListener("pointerdown", (e) => {
    if (!w || e.button !== 0) return;
    if (e.target.closest("#closeWin, #moveWin")) return;
    dragStart = { x: e.clientX, y: e.clientY };
    dragStarted = false;
  });

  viewport?.addEventListener("pointermove", async (e) => {
    if (!w || !dragStart || dragStarted) return;

    const dx = Math.abs(e.clientX - dragStart.x);
    const dy = Math.abs(e.clientY - dragStart.y);

    if (dx > 4 || dy > 4) {
      dragStarted = true;
      dragStart = null;
      try {
        await w.getCurrentWindow().startDragging();
      } catch (e) {
        console.error("startDragging error:", e);
      }
    }
  });

  const stopPointer = () => {
    dragStart = null;
    dragStarted = false;
  };

  viewport?.addEventListener("pointerup", stopPointer);
  viewport?.addEventListener("pointercancel", stopPointer);
  viewport?.addEventListener("pointerleave", stopPointer);

viewport?.addEventListener("click", async (e) => {
  if (!w) return;
  if (e.target.closest("#closeWin, #moveWin")) return;

  stopPointer();

  try {
    compactMode = !compactMode;

    await invoke("toggle_window_size_and_center", { compact: compactMode });

    applyViewportScale();
    positionNextBadge();
    placeNoSessionsAtFirstSlot();

    await invoke("show_window");
  } catch (e) {
    compactMode = !compactMode;
    console.error("toggle size/center error:", e);
    try { await invoke("show_window"); } catch {}
  }
});
});