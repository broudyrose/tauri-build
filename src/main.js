/// main.js
import { AUTO_POLL, POLL_MS, MAX_VISIBLE_SESSIONS, getInvoke, fetchUpcoming, normalizeSessions } from "./data.js";
import {
  showScene,
  renderFive,
  updateNoSessionsText,
  setThemeFromFirst,
  positionNextBadge,
  placeNoSessionsAtFirstSlot,
  setCompactModeGetter,
  setCurrentState,
  getCurrentState,
} from "./render.js";
import { createWindowController } from "./window.js";
import { runFlipTransition } from "./anim.js";

const FULL_W = 1280;
const FULL_H = 704;
const MINI_W = 640;
const MINI_H = 352;

window.addEventListener("DOMContentLoaded", async () => {
  let compactMode = false;

  const compactModeRef = {
    get: () => compactMode,
    set: (v) => { compactMode = v; },
  };

  setCompactModeGetter(() => compactMode);

  const invoke = await getInvoke();

  const windowCtrl = createWindowController({
    invoke,
    compactModeRef,
    fullW: FULL_W,
    fullH: FULL_H,
    miniW: MINI_W,
    miniH: MINI_H,
    applyViewportScale: () => {
      const scene = document.getElementById("scene");
      if (!scene) return;
      scene.style.transform = `scale(${compactMode ? 0.5 : 1})`;
    },
    positionNextBadge: () => positionNextBadge(),
    placeNoSessionsAtFirstSlot: () => placeNoSessionsAtFirstSlot(),
    syncCompactModeFromWindow: async () => {
      const w = window.__TAURI__?.window;
      if (!w) return;
      try {
        const size = await w.getCurrentWindow().innerSize();
        compactMode = size.width <= MINI_W + 4 && size.height <= MINI_H + 4;
      } catch {}
    },
  });

  await windowCtrl.init();

  try {
    const first = await fetchUpcoming(invoke, MAX_VISIBLE_SESSIONS);
    if (first) {
      const current = normalizeSessions(first, MAX_VISIBLE_SESSIONS);
      setCurrentState(current);
      renderFive(current);
      updateNoSessionsText(current, false);
      setThemeFromFirst(current);
      positionNextBadge();
    }
  } catch (e) {
    console.error("initial fetchUpcoming error:", e);
  }

  showScene();
  windowCtrl.applyViewportScale();

  window.addEventListener("resize", () => {
    windowCtrl.applyViewportScale();
    positionNextBadge();
    placeNoSessionsAtFirstSlot();
  });

  if (AUTO_POLL) {
    setInterval(async () => {
      try {
        const fetched = await fetchUpcoming(invoke, MAX_VISIBLE_SESSIONS);
        if (!fetched) return;

        const nextItems = normalizeSessions(fetched, MAX_VISIBLE_SESSIONS);

        runFlipTransition(nextItems, {
          renderFive,
          updateNoSessionsText,
          placeNoSessionsAtFirstSlot,
          setThemeFromFirst,
          positionNextBadge,
          applyZByOrder: () => {},
        });
      } catch (e) {
        console.error("poll fetchUpcoming error:", e);
      }
    }, POLL_MS);
  }

  document.getElementById("debugRemove")?.addEventListener("click", async () => {
    try {
      const fetched = await fetchUpcoming(invoke, MAX_VISIBLE_SESSIONS);
      if (!fetched?.length) return;

      const current = getCurrentState();
      const idx = fetched.findIndex((x) => x.rid === current[0]?.rid);
      const nextItems = normalizeSessions(
        idx === -1 ? fetched.slice(0, MAX_VISIBLE_SESSIONS) : fetched.slice(idx + 1, idx + 1 + MAX_VISIBLE_SESSIONS),
        MAX_VISIBLE_SESSIONS
      );

      runFlipTransition(nextItems, {
        renderFive,
        updateNoSessionsText,
        placeNoSessionsAtFirstSlot,
        setThemeFromFirst,
        positionNextBadge,
        applyZByOrder: () => {},
      });
    } catch (e) {
      console.error("debugRemove error:", e);
    }
  });
});