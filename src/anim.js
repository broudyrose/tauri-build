/// anim.js
import {
  getCurrentState,
  setCurrentState,
  isAnimating,
  setAnimating,
  cancelAllAnimations,
  shouldUpdateTheme,
} from "./render.js";
import { sameSequence, sameContent } from "./data.js";

const DURATION_MS = 700;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function captureRowRects() {
  const rows = [...document.querySelectorAll(".sessionRow[data-rid]")];
  const map = new Map();

  rows.forEach((el) => {
    const r = el.getBoundingClientRect();
    map.set(el.dataset.rid, {
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
  });

  return map;
}

function makeGhostOfFirstRow() {
  const first = document.querySelector(".sessionRow[data-rid]");
  const list = document.querySelector(".sessionList");
  if (!first || !list) return null;

  const listRect = list.getBoundingClientRect();
  const rowRect = first.getBoundingClientRect();
  const ghost = first.cloneNode(true);

  ghost.classList.add("sessionRowGhost");
  ghost.style.position = "absolute";
  ghost.style.left = `${rowRect.left - listRect.left}px`;
  ghost.style.top = `${rowRect.top - listRect.top}px`;
  ghost.style.width = `${rowRect.width}px`;
  ghost.style.height = `${rowRect.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "100";

  list.appendChild(ghost);
  return ghost;
}

export function runFlipTransition(nextItems, deps) {
  const {
    renderFive,
    updateNoSessionsText,
    setThemeFromFirst,
  } = deps;

  const current = getCurrentState();

  if (isAnimating()) return;

  if (!current.length) {
    setCurrentState(nextItems);
    renderFive(nextItems);
    updateNoSessionsText(nextItems, false);
    setThemeFromFirst(nextItems);
    return;
  }

  if (sameSequence(current, nextItems)) {
    if (sameContent(current, nextItems)) return;
    setCurrentState(nextItems);
    renderFive(nextItems);
    updateNoSessionsText(nextItems, false);
    if (shouldUpdateTheme(current, nextItems)) setThemeFromFirst(nextItems);
    return;
  }

  const currentFirstRid = current[0]?.rid ?? null;
  const firstWasRemoved = currentFirstRid && !nextItems.some(x => x.rid === currentFirstRid);

  setAnimating(true);
  cancelAllAnimations();

  if (shouldUpdateTheme(current, nextItems)) setThemeFromFirst(nextItems);

  const startRects = captureRowRects();
  const ghost = firstWasRemoved ? makeGhostOfFirstRow() : null;

  renderFive(nextItems);
  updateNoSessionsText(nextItems, false);

  const endRects = captureRowRects();
  const rows = [...document.querySelectorAll(".sessionRow[data-rid]")];
  const animations = [];

  rows.forEach((el) => {
    const rid = el.dataset.rid;
    const start = startRects.get(rid);
    const end = endRects.get(rid);
    if (!end) return;

    if (!start) {
      animations.push(
        el.animate(
          [
            { opacity: 0, transform: "translateY(18px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: DURATION_MS, easing: EASE, fill: "forwards" }
        )
      );
      return;
    }

    const dy = start.top - end.top;
    animations.push(
      el.animate(
        [
          { transform: `translateY(${dy}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: DURATION_MS, easing: EASE, fill: "forwards" }
      )
    );
  });

  if (ghost) {
    animations.push(
      ghost.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-18px)" },
        ],
        { duration: DURATION_MS, easing: EASE, fill: "forwards" }
      )
    );
  }

  Promise.allSettled(animations.map(a => a.finished)).then(() => {
    ghost?.remove();
    cancelAllAnimations();
    setCurrentState(nextItems);
    setAnimating(false);
    renderFive(nextItems);
    updateNoSessionsText(nextItems, false);
  });
}