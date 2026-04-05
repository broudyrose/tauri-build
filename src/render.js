// render.js
import { hhmmNow, hasRealSessions } from "./data.js";

let themeActive = "A";
let currentState = [];
let animating = false;
let getCompactMode = () => false;

export function setCompactModeGetter(fn) {
  getCompactMode = fn;
}

export function sceneScale() {
  return getCompactMode() ? 0.5 : 1;
}

export function metaH() {
  return 0;
}

export function gapPx() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--sessionGap").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 8;
}

export function getCurrentState() {
  return currentState;
}

export function setCurrentState(v) {
  currentState = v;
}

export function isAnimating() {
  return animating;
}

export function setAnimating(v) {
  animating = v;
}

export function cancelAllAnimations() {
  document.getAnimations().forEach((a) => a.cancel());
}

export function showScene() {
  const scene = document.getElementById("scene");
  if (scene) scene.style.visibility = "visible";
}

export function setThemeCrossfade(dataUrl) {
  const a = document.getElementById("bgA");
  const b = document.getElementById("bgB");
  if (!a || !b || !dataUrl) return;

  const nextLayer = themeActive === "A" ? b : a;
  const curLayer = themeActive === "A" ? a : b;
  const targetOpacity =
    getComputedStyle(document.documentElement).getPropertyValue("--themeOpacity").trim() || "1";

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

export function setThemeFromFirst(items) {
  const url = items?.[0]?.poster_data_url;
  if (url) setThemeCrossfade(url);
}

export function shouldUpdateTheme(prev, next) {
  const prevFirst = prev?.[0];
  const nextFirst = next?.[0];
  if (!prevFirst || !nextFirst) return true;
  return prevFirst.rid !== nextFirst.rid || prevFirst.poster_data_url !== nextFirst.poster_data_url;
}

function heroHtml(item) {
  if (!item) return `<div class="heroPoster heroPosterEmpty"></div>`;
  const img = item.poster_data_url ? `<img src="${item.poster_data_url}" alt="">` : "";
  return `<div class="heroPoster">${img}</div>`;
}

function buildMeta(item) {
  const left = [item.duration, item.age, item.hall].filter(Boolean).join(" • ");
  return left;
}

function priceHtml(item) {
  if (!item.price) return "";
  return `<div class="priceBadge">${item.price}</div>`;
}

function soldoutHtml(item) {
  if (!item.soldout_badge) return "";
  return `<div class="soldoutBadge">${item.soldout_badge}</div>`;
}

function rowHtml(item, isFirst, idx) {
  const meta = buildMeta(item);

  return `
    <article class="sessionRow ${isFirst ? "is-first" : ""}" data-rid="${item.rid}" data-index="${idx}">
      <div class="sessionTime">${item.time}</div>

      <div class="sessionMain">
        <div class="sessionTopLine">
          <div class="sessionMeta ${meta ? "" : "is-empty"}">${meta}</div>
          <div class="sessionBadges">
            ${soldoutHtml(item)}
            ${priceHtml(item)}
          </div>
        </div>

        <div class="sessionTitle">${item.title}</div>
      </div>
    </article>
  `;
}

export function renderFive(items) {
  const strip = document.getElementById("strip");
  if (!strip) return;

  const first = items[0] ?? null;
  const rest = items;
 
  strip.innerHTML = `
    <div class="sessionsLayout">
      <div class="heroColumn">
        ${heroHtml(first)}
      </div>

      <div class="listColumn">
        <div class="listHeader">
          <div class="listTitle">Ближайшие сеансы</div>
          <div class="listClock">◷ ${hhmmNow()}</div>
        </div>

        <div class="sessionList ${items.length ? "" : "is-empty"}">
          ${rest.map((item, idx) => rowHtml(item, idx === 0, idx)).join("")}
          ${items.length ? "" : `<div class="emptyState">Сегодня сеансов нет</div>`}
        </div>
      </div>
    </div>
  `;
}

export function applyZByOrder() {}
export function positionNextBadge() {}
export function placeNoSessionsAtFirstSlot() {}

export function updateNoSessionsText(items) {
  const badge = document.getElementById("nextBadge");
  const noSessions = document.getElementById("noSessions");

  if (badge) badge.style.display = "none";
  if (noSessions) noSessions.style.display = "none";

  const list = document.querySelector(".sessionList");
  if (!list) return;

  if (!hasRealSessions(items) && !list.querySelector(".emptyState")) {
    list.innerHTML = `<div class="emptyState">Сегодня сеансов нет</div>`;
  }
}