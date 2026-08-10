import { hhmmNow, hasRealSessions } from "./data.js";

const HERO_TITLE_SHINE_DEFAULT_FIRST_DELAY_MS = 1500; // Запасная задержка первого блика, если значение отсутствует в styles.css.
const HERO_TITLE_SHINE_DEFAULT_INTERVAL_MS = 15000; // Запасная пауза между бликами, если значение отсутствует в styles.css.
const HERO_TITLE_SHINE_DEFAULT_DURATION_MS = 4000; // Запасная длительность прохода блика, если значение отсутствует в styles.css.
const HERO_TITLE_SHINE_DEFAULT_ANGLE_DEG = -150; // Запасный угол полосы блика, если значение отсутствует в styles.css.
const HERO_TITLE_SHINE_DEFAULT_BAND_WIDTH_PX = 220; // Запасная физическая ширина полосы блика.
const HERO_TITLE_SHINE_DEFAULT_START_PX = -520; // Запасная начальная координата блика вдоль направления движения.
const HERO_TITLE_SHINE_DEFAULT_END_PX = 1280; // Запасная конечная координата блика вдоль направления движения.

let currentState = [];
let animating = false;
let getCompactMode = () => false;
let heroTitleShineTimer = 0;
let heroTitleShineCleanupTimer = 0;
let entranceNoticeAnimation = null;
let entranceNoticeTargetText = null;
let entranceNoticeRevision = 0;
let scheduleDividerAnimation = null;
let scheduleDividerTargetText = null;
let scheduleDividerTargetVisible = null;
let scheduleDividerRevision = 0;

function cssTimeMs(variableName, fallbackMs) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  const match = /^([\d.]+)\s*(ms|s)$/i.exec(raw);
  if (!match) return fallbackMs;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return fallbackMs;
  return match[2].toLowerCase() === "s" ? value * 1000 : value;
}

function cssNumber(variableName, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function cssValue(variableName, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
}

function cssAngleRadians(variableName, fallbackDegrees) {
  const raw = cssValue(variableName, `${fallbackDegrees}deg`);
  const match = /^(-?[\d.]+)\s*(deg|rad|turn|grad)$/i.exec(raw);
  if (!match) return fallbackDegrees * Math.PI / 180;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "rad") return value;
  if (unit === "turn") return value * Math.PI * 2;
  if (unit === "grad") return value * Math.PI / 200;
  return value * Math.PI / 180;
}

function shineStop(variableName, fallbackPercent, bandWidth) {
  const percent = cssNumber(variableName, fallbackPercent);
  const offset = (percent / 100 - 0.5) * bandWidth;
  const sign = offset < 0 ? "-" : "+";
  return `calc(50% ${sign} ${Math.abs(offset).toFixed(3)}px)`;
}

function configureHeroTitleShineGeometry() {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const angle = cssValue("--hero-title-shine-angle", `${HERO_TITLE_SHINE_DEFAULT_ANGLE_DEG}deg`);
  const radians = cssAngleRadians("--hero-title-shine-angle", HERO_TITLE_SHINE_DEFAULT_ANGLE_DEG);
  const bandWidth = Math.max(
    1,
    Math.abs(cssNumber("--hero-title-shine-band-width", HERO_TITLE_SHINE_DEFAULT_BAND_WIDTH_PX))
  );
  const start = cssNumber("--hero-title-shine-start", HERO_TITLE_SHINE_DEFAULT_START_PX);
  const end = cssNumber("--hero-title-shine-end", HERO_TITLE_SHINE_DEFAULT_END_PX);
  const directionX = -Math.sin(radians);
  const directionY = Math.cos(radians);

  root.style.setProperty("--hero-title-shine-start-x", `${(directionX * start).toFixed(3)}px`);
  root.style.setProperty("--hero-title-shine-start-y", `${(directionY * start).toFixed(3)}px`);
  root.style.setProperty("--hero-title-shine-end-x", `${(directionX * end).toFixed(3)}px`);
  root.style.setProperty("--hero-title-shine-end-y", `${(directionY * end).toFixed(3)}px`);

  const color = (name, fallback) => computed.getPropertyValue(name).trim() || fallback;
  const gradient = `linear-gradient(
    ${angle},
    transparent 0%,
    transparent ${shineStop("--hero-title-shine-stop-clear-left", 15, bandWidth)},
    ${color("--hero-title-shine-color-edge", "rgba(255, 183, 36, 0.18)")} ${shineStop("--hero-title-shine-stop-edge", 24, bandWidth)},
    ${color("--hero-title-shine-color-halo", "rgba(255, 202, 54, 0.92)")} ${shineStop("--hero-title-shine-stop-halo", 39, bandWidth)},
    ${color("--hero-title-shine-color-core-warm", "rgba(255, 237, 145, 1)")} ${shineStop("--hero-title-shine-stop-core-warm", 49, bandWidth)},
    ${color("--hero-title-shine-color-core", "rgba(255, 250, 204, 1)")} ${shineStop("--hero-title-shine-stop-core", 52, bandWidth)},
    ${color("--hero-title-shine-color-tail", "rgba(255, 211, 92, 0.62)")} ${shineStop("--hero-title-shine-stop-tail", 66, bandWidth)},
    transparent ${shineStop("--hero-title-shine-stop-clear-right", 83, bandWidth)},
    transparent 100%
  )`;
  root.style.setProperty("--hero-title-shine-gradient", gradient);
}

function triggerHeroTitleShine() {
  heroTitleShineTimer = 0;
  const duration = cssTimeMs("--hero-title-shine-duration", HERO_TITLE_SHINE_DEFAULT_DURATION_MS);
  const pause = cssTimeMs("--hero-title-shine-interval", HERO_TITLE_SHINE_DEFAULT_INTERVAL_MS);
  const scheduleNext = () => {
    window.clearTimeout(heroTitleShineTimer);
    heroTitleShineTimer = window.setTimeout(triggerHeroTitleShine, Math.max(0, pause));
  };

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const heroMount = document.querySelector(".heroMount");
  if (!heroMount || !heroMount.querySelector(".heroSessionSlot [data-shine-text]")) {
    scheduleNext();
    return;
  }

  configureHeroTitleShineGeometry();
  window.clearTimeout(heroTitleShineCleanupTimer);
  heroMount.classList.remove("is-shining");
  void heroMount.offsetWidth;
  heroMount.classList.add("is-shining");
  heroTitleShineCleanupTimer = window.setTimeout(() => {
    heroTitleShineCleanupTimer = 0;
    if (heroMount.isConnected) heroMount.classList.remove("is-shining");
    scheduleNext();
  }, Math.max(0, duration));
}

export function startHeroTitleShine() {
  if (heroTitleShineTimer || heroTitleShineCleanupTimer) return;
  heroTitleShineTimer = window.setTimeout(
    triggerHeroTitleShine,
    cssTimeMs("--hero-title-shine-first-delay", HERO_TITLE_SHINE_DEFAULT_FIRST_DELAY_MS)
  );
}

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
  document.querySelectorAll(".sessionRow, .sessionRowGhost").forEach((el) => {
    el.getAnimations().forEach((a) => a.cancel());
  });
}

export function showScene() {
  const scene = document.getElementById("scene");
  if (scene) scene.style.visibility = "visible";
}

export function updateClock() {
  const clock = document.querySelector(".listClock");
  if (clock) clock.textContent = hhmmNow();

  document.querySelectorAll(".sessionRow").forEach((row) => {
    const text = untilText(row.getAttribute("data-time"));
    row.querySelectorAll(".sessionCountdown").forEach((el) => {
      el.textContent = text;
    });
  });
}

async function transitionEntranceNotice(block, label, text, revision) {
  const duration = cssTimeMs("--card-standard-fade-ms", 1500);
  const hidden = block.classList.contains("is-hidden");
  const currentOpacity = Number.parseFloat(getComputedStyle(block).opacity);
  let fadeInStartTime = null;

  entranceNoticeAnimation?.cancel();
  entranceNoticeAnimation = null;

  if (!hidden) {
    block.style.opacity = String(Number.isFinite(currentOpacity) ? currentOpacity : 1);
    const fadeOut = block.animate(
      [{ opacity: Number.isFinite(currentOpacity) ? currentOpacity : 1 }, { opacity: 0 }],
      { duration, easing: "ease-in-out", fill: "forwards" }
    );
    entranceNoticeAnimation = fadeOut;
    try {
      await fadeOut.finished;
    } catch {
      return;
    }
    if (revision !== entranceNoticeRevision) return;
    fadeInStartTime = Number.isFinite(fadeOut.startTime)
      ? fadeOut.startTime + duration
      : null;
    fadeOut.cancel();
    entranceNoticeAnimation = null;
    block.style.opacity = "";
  }

  label.textContent = text;
  if (!text) {
    block.classList.add("is-hidden");
    block.setAttribute("aria-hidden", "true");
    block.style.opacity = "";
    return;
  }

  block.classList.remove("is-hidden");
  block.setAttribute("aria-hidden", "false");
  const fadeIn = block.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration, easing: "ease-in-out", fill: "forwards" }
  );
  if (fadeInStartTime !== null) fadeIn.startTime = fadeInStartTime;
  entranceNoticeAnimation = fadeIn;
  try {
    await fadeIn.finished;
  } catch {
    return;
  }
  if (revision !== entranceNoticeRevision) return;
  fadeIn.cancel();
  entranceNoticeAnimation = null;
  block.style.opacity = "";
}

export function updateEntranceNotice(
  vxodValue,
  items = currentState,
  hasScheduledSessions = hasRealSessions(items)
) {
  const block = document.querySelector(".ticketOnly");
  if (!block) return;

  const mode = Number(vxodValue);
  const text = !hasScheduledSessions
    ? "На сегодня сеансов нет"
    : mode === 1
      ? "Вход вне сеансов – 100 ₽"
      : mode === 2
        ? "Вход только по билетам"
        : "";
  const label = block.querySelector("span");
  if (!label) return;

  const hidden = !text;
  if (entranceNoticeTargetText === null) {
    entranceNoticeTargetText = text;
    entranceNoticeAnimation?.cancel();
    entranceNoticeAnimation = null;
    label.textContent = text;
    block.classList.toggle("is-hidden", hidden);
    block.setAttribute("aria-hidden", String(hidden));
    block.style.opacity = "";
    return;
  }
  if (text === entranceNoticeTargetText) return;

  entranceNoticeTargetText = text;
  entranceNoticeRevision += 1;
  void transitionEntranceNotice(block, label, text, entranceNoticeRevision);
}

function setScheduleDividerInstant(divider, label, text, visible) {
  scheduleDividerAnimation?.cancel();
  scheduleDividerAnimation = null;
  divider.style.transition = "none";
  label.textContent = text;
  divider.setAttribute("aria-label", text);
  divider.classList.toggle("is-hidden", !visible);
  divider.style.opacity = "";
  void divider.offsetWidth;
  divider.style.transition = "";
}

function transitionScheduleDivider(divider, label, text, visible, revision) {
  const duration = cssTimeMs("--hero-info-fade-ms", 1500);
  const currentlyHidden = divider.classList.contains("is-hidden");
  const currentOpacity = Number.parseFloat(getComputedStyle(divider).opacity);
  let initialAnimation = null;

  divider.style.transition = "none";
  scheduleDividerAnimation?.cancel();
  scheduleDividerAnimation = null;

  void (async () => {
    let fadeInStartTime = null;
    if (!currentlyHidden) {
      divider.style.opacity = String(Number.isFinite(currentOpacity) ? currentOpacity : 1);
      const fadeOut = divider.animate(
        [{ opacity: Number.isFinite(currentOpacity) ? currentOpacity : 1 }, { opacity: 0 }],
        { duration, easing: "ease-in-out", fill: "forwards" }
      );
      initialAnimation = fadeOut;
      scheduleDividerAnimation = fadeOut;
      try {
        await fadeOut.finished;
      } catch {
        return;
      }
      if (revision !== scheduleDividerRevision) return;
      fadeInStartTime = Number.isFinite(fadeOut.startTime)
        ? fadeOut.startTime + duration
        : null;
      divider.style.opacity = "0";
      fadeOut.cancel();
      scheduleDividerAnimation = null;
    }

    label.textContent = text;
    divider.setAttribute("aria-label", text);
    if (!visible) {
      divider.classList.add("is-hidden");
      divider.style.opacity = "";
      void divider.offsetWidth;
      divider.style.transition = "";
      return;
    }

    divider.style.opacity = "0";
    divider.classList.remove("is-hidden");
    const fadeIn = divider.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration, easing: "ease-in-out", fill: "forwards" }
    );
    if (fadeInStartTime !== null) fadeIn.startTime = fadeInStartTime;
    if (!initialAnimation) initialAnimation = fadeIn;
    scheduleDividerAnimation = fadeIn;
    try {
      await fadeIn.finished;
    } catch {
      return;
    }
    if (revision !== scheduleDividerRevision) return;
    divider.style.opacity = "1";
    fadeIn.cancel();
    scheduleDividerAnimation = null;
    divider.style.transition = "";
    divider.style.opacity = "";
  })();

  return {
    animation: initialAnimation,
    entering: currentlyHidden && visible,
  };
}

function updateScheduleDivider(divider, text, visible) {
  if (!divider) return;
  const label = divider.querySelector("span");
  if (!label) return;

  if (scheduleDividerTargetText === null) {
    scheduleDividerTargetText = text;
    scheduleDividerTargetVisible = visible;
    setScheduleDividerInstant(divider, label, text, visible);
    return;
  }
  if (
    text === scheduleDividerTargetText
    && visible === scheduleDividerTargetVisible
  ) return;

  scheduleDividerTargetText = text;
  scheduleDividerTargetVisible = visible;
  scheduleDividerRevision += 1;
  return transitionScheduleDivider(
    divider,
    label,
    text,
    visible,
    scheduleDividerRevision
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function minutesUntil(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!m) return null;

  const now = new Date();
  const target = new Date(now);
  target.setHours(Number(m[1]), Number(m[2]), 0, 0);

  let diff = Math.round((target - now) / 60000);
  if (diff < 0) {
    target.setDate(target.getDate() + 1);
    diff = Math.round((target - now) / 60000);
  }
  return diff;
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function untilText(time) {
  const mins = minutesUntil(time);
  if (mins === null) return "";
  if (mins <= 0) return "начинается";
  if (mins < 60) return `через ${mins} ${pluralRu(mins, "минуту", "минуты", "минут")}`;

  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hourText = `${h} ${pluralRu(h, "час", "часа", "часов")}`;
  return m ? `через ${hourText} ${m} мин` : `через ${hourText}`;
}

function posterHtml(item, className = "posterThumb") {
  if (!item?.poster_data_url) return `<div class="${className} is-empty"></div>`;
  return `<img class="${className}" src="${item.poster_data_url}" alt="">`;
}

function fileSrc(path) {
  if (!path) return "";
  const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
  return typeof convertFileSrc === "function" ? convertFileSrc(path) : path;
}

function trailerRangeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function trailerRangeAttributes(item) {
  const start = trailerRangeNumber(item?.trailer_start);
  const end = trailerRangeNumber(item?.trailer_end);
  const attributes = [];
  if (start !== null) attributes.push(`data-trailer-start="${escapeHtml(String(start))}"`);
  if (end !== null) attributes.push(`data-trailer-end="${escapeHtml(String(end))}"`);
  return {
    hasRange: attributes.length > 0,
    html: attributes.length ? ` ${attributes.join(" ")}` : "",
  };
}

function heroMediaHtml(item) {
  const trailer = fileSrc(item?.trailer_path);
  if (trailer) {
    const range = trailerRangeAttributes(item);
    const playback = item?.advertising || range.hasRange ? "" : " autoplay loop";
    return `<video class="heroMedia heroMediaVideo" src="${escapeHtml(trailer)}"${playback}${range.html} muted playsinline preload="metadata"></video>`;
  }

  const galleryImage = Array.isArray(item?.gallery_paths)
    ? item.active_gallery_path || item.gallery_paths[0]
    : "";
  const header = fileSrc(galleryImage || item?.header_path);
  if (header) {
    return `<div class="heroMedia heroMediaImage is-header" style="background-image:url(&quot;${escapeHtml(header)}&quot;)"></div>`;
  }

  if (item?.poster_data_url) {
    return `<div class="heroMedia heroMediaImage is-poster" style="background-image:url(&quot;${item.poster_data_url}&quot;)"></div>`;
  }

  return `<div class="heroMedia heroMediaImage is-empty"></div>`;
}

function normalizedTitle(item) {
  const raw = String(item?.title || "").trim();
  const premiereMatch = raw.match(/^премьера\s*[!:.\-–—]*\s*/i);
  return {
    isPremiere: Boolean(premiereMatch),
    title: raw.replace(/^премьера\s*[!:.\-–—]*\s*/i, "").trim() || raw,
  };
}

function firstTitleSeparatorOutsideQuotes(value) {
  const closingQuote = {
    '"': '"',
    "«": "»",
    "„": "“",
    "“": "”",
  };
  let expectedClose = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (expectedClose) {
      if (char === expectedClose) expectedClose = "";
      continue;
    }

    if (closingQuote[char]) {
      expectedClose = closingQuote[char];
      continue;
    }

    if (char === ".") return index;

    if (
      char === ":"
      && /\s/u.test(value[index + 1] || "")
      && value.slice(index + 1).trim()
    ) {
      return index;
    }
  }

  return -1;
}

function splitHeroTitle(title) {
  const masterClassMatch = /^(мастер(?:[\s\-‐‑‒–—]+)класс)(?![\p{L}\p{N}_])/iu.exec(title);
  if (masterClassMatch) {
    const wordEnd = masterClassMatch[1].length;
    const subtitle = title.slice(wordEnd).trim();
    if (subtitle) {
      return {
        title: title.slice(0, wordEnd).trim(),
        subtitle,
      };
    }
  }

  const categoryMatch = /(^|[^\p{L}\p{N}_])(концерт|экскурсия)(?![\p{L}\p{N}_])/iu.exec(title);
  if (categoryMatch) {
    const wordEnd = categoryMatch.index + categoryMatch[1].length + categoryMatch[2].length;
    const subtitle = title.slice(wordEnd).trim();
    if (subtitle) {
      return {
        title: title.slice(0, wordEnd).trim(),
        subtitle,
      };
    }
  }

  const separator = firstTitleSeparatorOutsideQuotes(title);
  if (separator < 0 || separator === title.length - 1) {
    return { title, subtitle: "" };
  }

  return {
    title: title.slice(0, separator + 1).trim(),
    subtitle: title.slice(separator + 1).trim(),
  };
}

function priceDisplay(item) {
  if (item?.soldout_badge || Number(item?.soldout) === 1) {
    return { kind: "soldout", text: "Нет мест" };
  }

  const raw = String(item?.price || "").trim();
  const compact = raw.replace(/\s+/gu, "");
  const numericPrice = compact
    .replace(/(?:₽|руб(?:\.|лей|ля)?|р\.?)/giu, "")
    .replace(",", ".");
  const isNumericZero = /^\d+(?:\.\d+)?$/u.test(numericPrice)
    && Number(numericPrice) === 0;
  if (
    !compact
    || /^(?:(?:₽)|(?:руб\.?)|(?:р\.?))+$/iu.test(compact)
    || isNumericZero
  ) {
    return { kind: "free", text: "Бесплатно" };
  }

  const normalized = raw.replace(/\s*₽\s*$/u, " ₽");
  return { kind: "price", text: normalized };
}

function priceOrSoldoutHtml(item) {
  const display = priceDisplay(item);
  return `<span class="priceValue is-${display.kind}">${escapeHtml(display.text)}</span>`;
}

function rowHtml(item, idx) {
  const hall = String(item.hall || "").trim();
  const age = String(item.age || "").trim();
  const duration = String(item.duration || "").trim();
  const normalized = normalizedTitle(item);
  const title = splitHeroTitle(normalized.title);
  const hasSubtitle = Boolean(title.subtitle);

  return `
    <article class="sessionRow scheduleCard${normalized.isPremiere ? " is-premiere" : ""}${item.advertising ? " is-advertising" : ""}" data-rid="${item.rid}" data-index="${idx}" data-time="${escapeHtml(item.time)}">
      <div class="cardTopMeta">
        <span class="cardTime">${escapeHtml(item.time)}</span>
        <span class="cardDuration">${escapeHtml(duration || "—")}</span>
      </div>
      <div class="cardFrame">
        <div class="cardArtwork">
          ${posterHtml(item, "cardPoster")}
          <span class="ageBadge posterAge">${escapeHtml(age || "—")}</span>
        </div>
        <div class="cardPanel">
          ${normalized.isPremiere ? `<div class="cardKicker">Премьера!</div>` : ""}
          <div class="cardTitleBlock ${hasSubtitle ? "has-subtitle" : ""}">
            <div class="cardPrimaryTitle">${escapeHtml(title.title)}</div>
            ${hasSubtitle ? `<div class="cardSubtitle">${escapeHtml(title.subtitle)}</div>` : ""}
          </div>
          <div class="cardRule"></div>
          <div class="cardFooter">
            <div class="hallName">${escapeHtml(hall || "Зал")}</div>
            ${priceOrSoldoutHtml(item)}
          </div>
        </div>
      </div>
    </article>
  `;
}

function createRowElement(item, idx) {
  const template = document.createElement("template");
  template.innerHTML = rowHtml(item, idx).trim();
  return template.content.firstElementChild;
}

function refreshRowElement(row, item, idx) {
  const replacement = createRowElement(item, idx);
  const oldContent = document.createElement("div");
  oldContent.className = "rowContentGhost";

  [...row.children]
    .filter((child) => !child.classList.contains("rowContentGhost"))
    .forEach((child) => oldContent.appendChild(child.cloneNode(true)));

  const newContent = [...replacement.children];
  row.className = replacement.className;
  row.dataset.rid = replacement.dataset.rid;
  row.dataset.index = replacement.dataset.index;
  row.dataset.time = replacement.dataset.time;
  row.replaceChildren(...newContent, oldContent);
  row.style.visibility = "";

  return { el: row, oldContent, newContent };
}

function stageSelectorSwap(root, replacement, selector, options = {}) {
  const {
    parentSelector,
    beforeSelector,
    kind = "field",
    ghostZIndex = 20,
  } = options;
  const current = root.querySelector(selector);
  const nextTemplate = replacement.querySelector(selector);
  if (!current && !nextTemplate) return null;

  const next = nextTemplate?.cloneNode(true) || null;
  if (current) {
    const left = current.offsetLeft;
    const top = current.offsetTop;
    const width = current.offsetWidth;
    const height = current.offsetHeight;

    current.classList.add("fieldTransitionGhost");
    current.setAttribute("aria-hidden", "true");
    current.style.position = "absolute";
    current.style.left = `${left}px`;
    current.style.top = `${top}px`;
    current.style.right = "auto";
    current.style.bottom = "auto";
    current.style.width = `${width}px`;
    current.style.height = `${height}px`;
    current.style.margin = "0";
    current.style.zIndex = String(ghostZIndex);
    current.style.pointerEvents = "none";

    if (next) current.before(next);
  } else if (next) {
    const parent = parentSelector ? root.querySelector(parentSelector) : null;
    if (!parent) return null;
    const before = beforeSelector ? parent.querySelector(beforeSelector) : null;
    parent.insertBefore(next, before);
  }

  return {
    oldContent: current,
    newContent: next ? [next] : [],
    kind,
  };
}

function refreshRowFields(row, item, idx, fields) {
  if (!(fields instanceof Set) || !fields.size) return [];
  const replacement = createRowElement(item, idx);
  const updates = [];
  const stage = (selector, options) => {
    const update = stageSelectorSwap(row, replacement, selector, options);
    if (update) updates.push(update);
  };

  if (fields.has("time")) {
    stage(".cardTime", { parentSelector: ".cardTopMeta", beforeSelector: ".cardDuration" });
  }
  if (fields.has("duration")) {
    stage(".cardDuration", { parentSelector: ".cardTopMeta" });
  }
  if (fields.has("poster")) {
    stage(".cardPoster", {
      parentSelector: ".cardArtwork",
      beforeSelector: ".posterAge",
      ghostZIndex: 1,
    });
  }
  if (fields.has("age")) {
    stage(".posterAge", { parentSelector: ".cardArtwork" });
  }
  if (fields.has("title")) {
    stage(".cardKicker", {
      parentSelector: ".cardPanel",
      beforeSelector: ".cardTitleBlock",
    });
    stage(".cardTitleBlock", {
      parentSelector: ".cardPanel",
      beforeSelector: ".cardRule",
    });
  }
  if (fields.has("hall") || fields.has("price")) {
    stage(".cardFooter", { parentSelector: ".cardPanel" });
  }

  row.className = replacement.className;
  row.dataset.rid = replacement.dataset.rid;
  row.dataset.index = replacement.dataset.index;
  row.dataset.time = replacement.dataset.time;
  row.style.visibility = "";
  return updates;
}

function renderSessionRows(
  list,
  cardItems,
  reusableRowRids,
  refreshRowFieldsByRid
) {
  if (!(reusableRowRids instanceof Set)) {
    list.innerHTML = `
      <div class="sessionTrack">
        ${cardItems.length
          ? cardItems.map((item, idx) => rowHtml(item, idx)).join("")
          : ""}
      </div>
    `;

    return {
      track: list.querySelector(":scope > .sessionTrack"),
      createdRows: [...list.querySelectorAll(":scope > .sessionTrack > .sessionRow")],
    };
  }

  let track = list.querySelector(":scope > .sessionTrack");
  if (!track) {
    track = document.createElement("div");
    track.className = "sessionTrack";
    list.replaceChildren(track);
  }

  const existingRows = new Map(
    [...track.querySelectorAll(":scope > .sessionRow:not(.sessionRowGhost)[data-rid]")]
      .map((row) => [String(row.dataset.rid), row])
  );
  const retainedRows = new Set();
  const createdRows = [];
  const updatedRows = [];

  cardItems.forEach((item, idx) => {
    const rid = String(item.rid);
    let row = reusableRowRids.has(rid) ? existingRows.get(rid) : null;

    if (!row) {
      row = createRowElement(item, idx);
      createdRows.push(row);
    } else if (refreshRowFieldsByRid instanceof Map && refreshRowFieldsByRid.has(rid)) {
      updatedRows.push(...refreshRowFields(
        row,
        item,
        idx,
        refreshRowFieldsByRid.get(rid)
      ));
    }

    row.dataset.index = String(idx);
    track.appendChild(row);
    retainedRows.add(row);
  });

  existingRows.forEach((row) => {
    if (!retainedRows.has(row)) row.remove();
  });

  return { track, createdRows, updatedRows };
}

function heroHtml(item) {
  if (!item) return "";

  const hall = String(item.hall || "").trim();
  const age = String(item.age || "").trim();
  const duration = String(item.duration || "").trim();
  const normalized = normalizedTitle(item);
  const title = splitHeroTitle(normalized.title);
  const hasTrailer = Boolean(item.trailer_path);
  const advertising = Boolean(item.advertising);
  const sortByTime = item.sort_by_time_status !== false;

  return `
    <section class="heroSession${hasTrailer ? " has-trailer" : ""}${advertising ? " is-advertising" : ""}" data-rid="${item.rid}" data-time="${escapeHtml(item.time)}" data-advertising="${advertising}">
      <div class="heroBackdrop">
        ${heroMediaHtml(item)}
        <div class="heroShade heroShadeTop"></div>
        <div class="heroShade heroShadeBottom"></div>
        <div class="heroShade heroShadeCards"></div>
      </div>
      <div class="heroContent">
        <div class="heroText">
          <div class="heroSchedule">${advertising ? "В репертуаре" : `${sortByTime ? "Далее в" : "В"} ${escapeHtml(item.time)}`}</div>
          <div class="heroTitleGroup">
            ${normalized.isPremiere ? `<div class="heroKicker" data-shine-text="Премьера!">Премьера!</div>` : ""}
            <h1 class="heroTitle" data-fit-height="72" data-fit-min="24" data-shine-text="${escapeHtml(title.title)}">${escapeHtml(title.title)}</h1>
            ${title.subtitle ? `<div class="heroSubtitle" data-fit-height="34" data-fit-min="14" data-shine-text="${escapeHtml(title.subtitle)}">${escapeHtml(title.subtitle)}</div>` : ""}
          </div>
          <div class="heroRule"></div>
          <div class="heroMeta">
            <span class="heroHall">${escapeHtml(hall || "Зал")}</span>
            <span class="heroDuration">${escapeHtml(duration || "—")}</span>
            <span class="heroAgeSlot"><span class="ageBadge heroAge">${escapeHtml(age || "—")}</span></span>
            <span class="heroPriceSlot">${priceOrSoldoutHtml(item)}</span>
          </div>
        </div>
      </div>
    </section>
  `;
}
// <span aria-hidden="true">•</span> 369

export function renderFive(items, options = {}) {
  const {
    preserveHero = false,
    preserveRows = false,
    reusableRowRids = null,
    refreshRowFields = null,
  } = options;
  const strip = document.getElementById("strip");
  if (!strip) return { track: null, createdRows: [] };

  let layout = strip.querySelector(".sessionsLayout");
  if (!layout) {
    strip.innerHTML = `
      <div class="sessionsLayout">
        <header class="boardHeader">
          <div class="brandBlock">
            <img class="brandLogo" src="./res/logo.png" alt="Планетарий">
          </div>
          <div class="statusBlock">
            <div class="clockCluster">
              <div class="listClock">${hhmmNow()}</div>
            </div>
            <div class="workHours">СР–ВС · 10:00–20:00</div>
            <div class="ticketOnly"><i></i><span>Вход только по билетам</span><i></i></div>
          </div>
          <div class="qrBlock">
            <div class="qrItems">
              <div class="qrItem"><span>Сайт</span><img src="./res/qr/site.png" alt=""></div>
              <div class="qrItem"><span>TG</span><img src="./res/qr/tg.png" alt=""></div>
              <div class="qrItem"><span>VK</span><img src="./res/qr/vk.png" alt=""></div>
              <div class="qrItem"><span>MAX</span><img src="./res/qr/max.png" alt=""></div>
            </div>
          </div>
        </header>

        <div class="heroMount">
          <div class="heroGrid" aria-hidden="true"></div>
          <div class="heroSessionSlot"></div>
          <div class="scheduleDivider" aria-label="Позже сегодня">
            <span>Позже сегодня</span>
            <i aria-hidden="true"></i>
          </div>
        </div>
        <div class="sessionList"></div>
      </div>
    `;
    layout = strip.querySelector(".sessionsLayout");
  }

  const clock = strip.querySelector(".listClock");
  const heroMount = strip.querySelector(".heroMount");
  const hero = strip.querySelector(".heroSessionSlot");
  const divider = strip.querySelector(".scheduleDivider");
  const list = strip.querySelector(".sessionList");
  if (clock) clock.textContent = hhmmNow();
  if (!list || !heroMount || !hero) return { track: null, createdRows: [] };

  const heroItem = items[0] || null;
  const cardItems = items.slice(1);
  const advertising = Boolean(heroItem?.advertising);
  const sortByTime = heroItem?.sort_by_time_status !== false;

  if (!preserveHero) {
    heroMount.classList.toggle("has-trailer", Boolean(heroItem?.trailer_path));
    heroMount.classList.toggle("is-advertising", advertising);
    hero.innerHTML = heroHtml(heroItem);
  }
  let renderedRows = {
    track: list.querySelector(":scope > .sessionTrack"),
    createdRows: [],
    updatedRows: [],
  };
  const scheduleDividerTransition = updateScheduleDivider(
    divider,
    advertising ? "Ещё" : (sortByTime ? "Позже сегодня" : "Позже"),
    cardItems.length > 0
  );
  if (!preserveRows) {
    list.className = `sessionList ${cardItems.length ? "" : "is-empty"}`;
    renderedRows = renderSessionRows(
      list,
      cardItems,
      reusableRowRids,
      refreshRowFields
    );
  }

  fitVisibleText();
  return { ...renderedRows, scheduleDividerTransition };
}

export function applyZByOrder() {}
export function positionNextBadge() {}
export function placeNoSessionsAtFirstSlot() {}

export function updateNoSessionsText() {
  const badge = document.getElementById("nextBadge");
  if (badge) badge.style.display = "none";
}

function fitCardTitleGroups() {
  document.querySelectorAll(".cardTitleBlock").forEach((group) => {
    if (group.closest(
      ".fieldTransitionGhost, .rowContentGhost, .sessionRowGhost"
    )) return;
    const main = group.querySelector(".cardPrimaryTitle");
    const subtitle = group.querySelector(".cardSubtitle");
    if (!main) return;

    const sizes = subtitle
      ? [[13, 9.5], [12.5, 9]]
      : [[13, null], [12.5, null]];

    for (const [mainSize, subtitleSize] of sizes) {
      main.style.fontSize = `${mainSize}px`;
      if (subtitle && subtitleSize) subtitle.style.fontSize = `${subtitleSize}px`;

      const mainFits = main.scrollHeight <= main.clientHeight + 1;
      const subtitleFits = !subtitle || subtitle.scrollHeight <= subtitle.clientHeight + 1;
      if (mainFits && subtitleFits && group.scrollHeight <= group.clientHeight + 1) break;
    }
  });
}

function fitVisibleText() {
  fitCardTitleGroups();

  document.querySelectorAll("[data-fit-height]").forEach((el) => {
    if (el.closest(
      ".fieldTransitionGhost, .heroTransitionGhost, .rowContentGhost, .sessionRowGhost"
    )) return;
    const maxHeight = Number(el.dataset.fitHeight);
    const minSize = Number(el.dataset.fitMin);
    if (!Number.isFinite(maxHeight) || !Number.isFinite(minSize)) return;

    el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollHeight > maxHeight && size > minSize) {
      size = Math.max(minSize, size - 0.5);
      el.style.fontSize = `${size}px`;
    }
  });
}
