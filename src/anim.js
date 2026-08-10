import {
  getCurrentState,
  setCurrentState,
  isAnimating,
  setAnimating,
  cancelAllAnimations,
} from "./render.js";
import { sameSequence, sameContent } from "./data.js";

/* Настройки всех переходов расписания */
const BASE_SCENE_WIDTH = 1280; // Базовая ширина сцены, относительно которой пересчитываются координаты анимаций.

/* Удаление карточки вниз */
const CARD_EXIT_TOTAL_MS = 1400; // Полная длительность подготовки, подъёма и ускоренного ухода карточки вниз.
const CARD_EXIT_ANTICIPATION_TENSION = 0.7; // Исходная сила Android Anticipate: больше — заметнее подготовительный подъём.
const CARD_EXIT_RISE_MAX_PX = 6; // Максимальный подъём карточки перед падением.
const CARD_EXIT_OVERSCAN_PX = 24; // Дополнительный путь ниже границы окна, чтобы карточка гарантированно вышла за кадр.
const CARD_EXIT_FALLBACK_DROP_PX = 400; // Запасная дистанция падения, если размер сцены определить не удалось.
const CARD_EXIT_PATH_SAMPLES = 40; // Количество точек непрерывной траектории Anticipate; больше — точнее исходная формула.
const CARD_EXIT_FADE_END_AT = 0.8; // Положение, к которому целевая прозрачность уже достигнута: 0 — исходная точка, 1 — полный уход.
const CARD_EXIT_TARGET_OPACITY = 0; // Прозрачность после достижения указанной позиции: 0 — невидимая, 1 — полностью видимая карточка.

/* Перемещение и прозрачность ряда карточек */
const ROW_MOVE_MS = 2600; // Общая длительность горизонтального сдвига ряда и входа новых карточек справа.
const ROW_FALLBACK_STEP_PX = 242; // Запасное расстояние между соседними позициями карточек, если его нельзя измерить.
const CARD_INSERT_FADE_EARLY_MS = 800; // На сколько раньше окончания освобождения места начинать проявление нового визуального экземпляра карточки.

/* Смена hero и массовое обновление расписания */
export const HERO_BACKGROUND_FADE_MS = 3000; // Длительность плавной смены фонового изображения или видео hero-блока.
const CONTENT_FADE_MS = 1500; // Длительность обычного появления и исчезновения отдельной карточки.
const DATA_SWAP_PHASE_MS = CONTENT_FADE_MS; // Одна фаза смены текста: 1500 мс на угасание и 1500 мс на появление.

const EASE_ROW_MOVE = "cubic-bezier(0.4, 0, 0.2, 1)"; // Кривая скорости горизонтального движения карточек.
const EASE_HERO = "cubic-bezier(0.4, 0, 0.2, 1)"; // Кривая скорости смены текста hero-блока.

let pendingTransitions = [];
let appliedKnownUpcomingRids = new Set();
let appliedUpcomingSchedule = new Map();
let pendingTimeChangedRids = new Set();

const RID_ROLE_HERO = "hero";
const RID_ROLE_CARD = "card";
const RID_ROLE_RESERVE = "reserve";

document.documentElement.style.setProperty(
  "--card-standard-fade-ms",
  `${CONTENT_FADE_MS}ms`
);
document.documentElement.style.setProperty(
  "--hero-info-fade-ms",
  `${DATA_SWAP_PHASE_MS}ms`
);

function getSceneScale() {
  return document.getElementById("scene")?.getBoundingClientRect().width / BASE_SCENE_WIDTH || 1;
}

function copyUpcomingSchedule(schedule, items = []) {
  if (schedule instanceof Map) return new Map(schedule);
  return new Map((items || []).map((item) => [
    String(item.rid),
    String(item.time || "").trim(),
  ]));
}

function scheduleTimeChanged(previousSchedule, nextSchedule, rid) {
  const key = String(rid);
  if (!previousSchedule.has(key) || !nextSchedule.has(key)) return false;
  return previousSchedule.get(key) !== nextSchedule.get(key);
}

function rememberScheduleChanges(previousSchedule, nextSchedule) {
  nextSchedule.forEach((_time, rid) => {
    if (scheduleTimeChanged(previousSchedule, nextSchedule, rid)) {
      pendingTimeChangedRids.add(String(rid));
    }
  });

  [...pendingTimeChangedRids].forEach((rid) => {
    if (!nextSchedule.has(rid)) pendingTimeChangedRids.delete(rid);
  });
}

function forgetVisualizedScheduleChanges(currentItems, nextItems) {
  [...(currentItems || []), ...(nextItems || [])].forEach((item) => {
    pendingTimeChangedRids.delete(String(item.rid));
  });
}

function buildRidRoles(items, knownUpcomingRids) {
  const roles = new Map();
  (knownUpcomingRids || new Set()).forEach((rid) => {
    roles.set(String(rid), RID_ROLE_RESERVE);
  });

  const heroRid = String(items?.[0]?.rid ?? "");
  if (heroRid) roles.set(heroRid, RID_ROLE_HERO);
  (items || []).slice(1).forEach((item) => {
    roles.set(String(item.rid), RID_ROLE_CARD);
  });

  return roles;
}

function needsCauseAwareLayout(nextItems, previousRoles, changedTimeRids) {
  const nextHeroRid = String(nextItems?.[0]?.rid ?? "");
  if (
    nextHeroRid
    && changedTimeRids.has(nextHeroRid)
    && previousRoles.get(nextHeroRid) !== RID_ROLE_HERO
  ) {
    return true;
  }

  return (nextItems || []).slice(1).some((item) => {
    const rid = String(item.rid);
    const previousRole = previousRoles.get(rid);

    return previousRole !== RID_ROLE_CARD
      && (previousRole !== RID_ROLE_RESERVE || changedTimeRids.has(rid));
  });
}

function captureRows() {
  const rows = [...document.querySelectorAll(
    ".sessionTrack > .sessionRow:not(.sessionRowGhost)[data-rid]"
  )];
  const map = new Map();

  rows.forEach((el) => {
    const rect = el.getBoundingClientRect();
    map.set(String(el.dataset.rid), {
      rid: String(el.dataset.rid),
      index: Number(el.dataset.index),
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      el,
    });
  });

  return map;
}

function reusableRowRids(current, target) {
  const currentRows = new Map(
    (current || []).slice(1).map((item) => [String(item.rid), item])
  );
  const reusable = new Set();

  (target || []).slice(1).forEach((item) => {
    const previous = currentRows.get(String(item.rid));
    if (sameVisualItem(previous, item)) reusable.add(String(item.rid));
  });

  return reusable;
}

function sameVisualItem(previous, next) {
  return Boolean(previous && next)
    && String(previous.rid) === String(next.rid)
    && String(previous.id) === String(next.id);
}

function sameVisualSequence(current, target) {
  if (!Array.isArray(current) || !Array.isArray(target)) return false;
  if (current.length !== target.length) return false;
  return current.every((item, index) => sameVisualItem(item, target[index]));
}

function sameStringList(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function itemFieldChanges(previous, next, includeHeroMedia = false) {
  const fields = new Set();
  if (!previous || !next) return fields;

  if (previous.sort_by_time_status !== next.sort_by_time_status) fields.add("scheduleMode");
  if (previous.time !== next.time) fields.add("time");
  if (previous.title !== next.title) fields.add("title");
  if (previous.duration !== next.duration) fields.add("duration");
  if (previous.age !== next.age) fields.add("age");
  if (previous.hall !== next.hall) fields.add("hall");
  if (
    previous.price !== next.price
    || previous.soldout !== next.soldout
    || previous.soldout_badge !== next.soldout_badge
  ) fields.add("price");
  if (previous.poster_data_url !== next.poster_data_url) fields.add("poster");
  if (
    includeHeroMedia
    && (
      previous.poster_data_url !== next.poster_data_url
      || !sameStringList(previous.gallery_paths, next.gallery_paths)
      || previous.header_path !== next.header_path
      || previous.active_gallery_path !== next.active_gallery_path
      || previous.trailer_path !== next.trailer_path
      || previous.trailer_start !== next.trailer_start
      || previous.trailer_end !== next.trailer_end
    )
  ) fields.add("media");

  if (previous.id !== next.id) {
    ["time", "title", "duration", "age", "hall", "price", "poster"].forEach((field) => {
      fields.add(field);
    });
    if (includeHeroMedia) fields.add("media");
  }

  return fields;
}

function changedRows(current, target) {
  const currentRows = new Map(
    (current || []).slice(1).map((item) => [String(item.rid), item])
  );
  const changed = new Map();

  (target || []).slice(1).forEach((item) => {
    const previous = currentRows.get(String(item.rid));
    if (!previous || sameContent([previous], [item])) return;
    const fields = itemFieldChanges(previous, item);
    if (fields.size) changed.set(String(item.rid), fields);
  });

  return changed;
}

function hasSequentialShift(current, target) {
  if (!Array.isArray(current) || !Array.isArray(target) || current.length < 2 || target.length < 1) {
    return false;
  }

  const overlapLength = Math.min(current.length - 1, target.length);
  if (!overlapLength) return false;

  for (let index = 0; index < overlapLength; index += 1) {
    if (!sameVisualItem(current[index + 1], target[index])) return false;
  }

  return true;
}

function ensureGhostLayer() {
  const scene = document.getElementById("scene");
  if (!scene) return null;

  let ghostLayer = document.getElementById("ghostLayer");
  if (!ghostLayer) {
    ghostLayer = document.createElement("div");
    ghostLayer.id = "ghostLayer";
    ghostLayer.style.position = "absolute";
    ghostLayer.style.inset = "0";
    ghostLayer.style.pointerEvents = "none";
    ghostLayer.style.zIndex = "30";
    scene.appendChild(ghostLayer);
  }

  return ghostLayer;
}

function cloneRowAsGhost(row) {
  const scene = document.getElementById("scene");
  const ghostLayer = ensureGhostLayer();
  if (!scene || !ghostLayer) return null;

  const sceneRect = scene.getBoundingClientRect();
  const scale = getSceneScale();
  const ghost = row.el.cloneNode(true);
  row.el.style.visibility = "hidden";

  ghost.classList.add("sessionRowGhost");
  ghost.style.visibility = "visible";
  ghost.style.position = "absolute";
  ghost.style.left = `${(row.left - sceneRect.left) / scale}px`;
  ghost.style.top = `${(row.top - sceneRect.top) / scale}px`;
  ghost.style.width = `${row.width / scale}px`;
  ghost.style.height = `${row.height / scale}px`;
  ghost.style.margin = "0";
  ghost.style.transform = "none";
  ghost.style.opacity = "1";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "1";
  ghost.style.boxSizing = "border-box";
  ghostLayer.appendChild(ghost);

  return { rid: row.rid, el: ghost };
}

// Маршрут определяется переходом между визуальными зонами. Только первая,
// непосредственно соседняя с Hero карточка может уйти через левую границу;
// более дальняя карточка при нелокальной смене роли использует общий уход вниз.
function planLeavingRows(
  startRows,
  nextItems,
  nextRoles,
  changedTimeRids,
  reusableRids = null
) {
  const nextHeroRid = String(nextItems?.[0]?.rid ?? "");
  const nextCardRids = new Set((nextItems || []).slice(1).map((item) => String(item.rid)));
  const removed = [];
  const promoted = [];
  const displaced = [];

  startRows.forEach((row, rid) => {
    if (nextCardRids.has(rid) && (!reusableRids || reusableRids.has(rid))) return;
    const ghost = cloneRowAsGhost(row);
    if (!ghost) return;
    if (row.index === 0 && row.rid === nextHeroRid) promoted.push(ghost);
    else if (
      nextRoles?.get(rid) === RID_ROLE_RESERVE
      && !changedTimeRids?.has(rid)
    ) displaced.push(ghost);
    else removed.push(ghost);
  });

  return { removed, promoted, displaced };
}

function animateRemovedCard(ghost) {
  const scene = document.getElementById("scene");
  const sceneRect = scene?.getBoundingClientRect();
  const ghostRect = ghost.el.getBoundingClientRect();
  const scale = getSceneScale();
  const dropDistance = sceneRect
    ? Math.max(
      CARD_EXIT_FALLBACK_DROP_PX,
      (sceneRect.bottom - ghostRect.top) / scale + CARD_EXIT_OVERSCAN_PX
    )
    : CARD_EXIT_FALLBACK_DROP_PX;
  const tension = effectiveAnticipationTension(
    dropDistance,
    CARD_EXIT_ANTICIPATION_TENSION,
    CARD_EXIT_RISE_MAX_PX
  );
  const fadeEndAt = Math.min(1, Math.max(0, CARD_EXIT_FADE_END_AT));
  const targetOpacity = Math.min(1, Math.max(0, CARD_EXIT_TARGET_OPACITY));
  const motionKeyframes = [];

  for (let index = 0; index <= CARD_EXIT_PATH_SAMPLES; index += 1) {
    const time = index / CARD_EXIT_PATH_SAMPLES;
    const path = anticipatePath(time, tension);
    const y = dropDistance * path;
    const position = Math.min(1, Math.max(0, y / dropDistance));
    const fadeProgress = fadeEndAt <= 0
      ? 1
      : Math.min(1, position / fadeEndAt);
    motionKeyframes.push({
      transform: `translateY(${y}px)`,
      opacity: 1 + (targetOpacity - 1) * fadeProgress,
      offset: time,
      easing: "linear",
    });
  }

  const motion = ghost.el.animate(
    motionKeyframes,
    { duration: CARD_EXIT_TOTAL_MS, fill: "forwards" }
  );

  return [motion];
}

function anticipatePath(time, tension) {
  return time * time * ((tension + 1) * time - tension);
}

function anticipateRisePx(dropDistance, tension) {
  if (tension <= 0) return 0;
  const apexTime = (2 * tension) / (3 * (tension + 1));
  return Math.abs(dropDistance * anticipatePath(apexTime, tension));
}

function effectiveAnticipationTension(dropDistance, requestedTension, maxRisePx) {
  const tension = Math.max(0, requestedTension);
  const maxRise = Math.max(0, maxRisePx);
  if (!tension || anticipateRisePx(dropDistance, tension) <= maxRise) return tension;

  let low = 0;
  let high = tension;
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    if (anticipateRisePx(dropDistance, middle) > maxRise) high = middle;
    else low = middle;
  }
  return low;
}

function clearGhostLayer() {
  const ghostLayer = document.getElementById("ghostLayer");
  if (ghostLayer && !ghostLayer.children.length) ghostLayer.remove();
}

function planHeroSwap(currentItems, nextItems) {
  const current = currentItems?.[0] || null;
  const next = nextItems?.[0] || null;
  if (!current && !next) return null;

  if (!sameVisualItem(current, next)) {
    return { swapContent: true, swapMedia: true };
  }

  const changed = itemFieldChanges(current, next, true);
  const swapContent = ["scheduleMode", "time", "title", "duration", "age", "hall", "price"]
    .some((field) => changed.has(field));
  const swapMedia = changed.has("media");
  return swapContent || swapMedia ? { swapContent, swapMedia } : null;
}

function prepareHeroSwap(plan) {
  if (!plan) return null;
  const heroMount = document.querySelector(".heroMount");
  const oldSlot = heroMount?.querySelector(":scope > .heroSessionSlot");
  if (!heroMount || !oldSlot) return null;

  heroMount.querySelectorAll(":scope > .heroTransitionGhost").forEach((element) => element.remove());
  oldSlot.classList.remove("heroSessionSlot");
  oldSlot.classList.add("heroTransitionGhost");

  const newSlot = document.createElement("div");
  newSlot.className = "heroSessionSlot";
  oldSlot.after(newSlot);
  return { oldSlot, newSlot, ...plan };
}

function preserveUnchangedHeroLayer(swap, selector) {
  const oldLayer = swap.oldSlot.querySelector(selector);
  const newLayer = swap.newSlot.querySelector(selector);
  if (!oldLayer || !newLayer) return;
  newLayer.replaceWith(oldLayer);
}

function reconcileHeroSwap(swap) {
  if (!swap) return;
  if (!swap.swapMedia) preserveUnchangedHeroLayer(swap, ".heroBackdrop");
  if (!swap.swapContent) preserveUnchangedHeroLayer(swap, ".heroContent");
}

function animateIfPresent(element, keyframes, options) {
  return element ? element.animate(keyframes, { fill: "forwards", ...options }) : null;
}

function animateHeroSwap(swap) {
  if (!swap) return [];

  const animations = [];
  const add = (animation) => {
    if (animation) animations.push(animation);
  };

  if (swap.swapMedia) {
    add(animateIfPresent(
      swap.oldSlot.querySelector(".heroBackdrop"),
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: HERO_BACKGROUND_FADE_MS, easing: "ease-in-out" }
    ));
    add(animateIfPresent(
      swap.newSlot.querySelector(".heroBackdrop"),
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: HERO_BACKGROUND_FADE_MS, easing: "ease-in-out" }
    ));
  }

  if (swap.swapContent) {
    add(animateIfPresent(
      swap.oldSlot.querySelector(".heroContent"),
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: DATA_SWAP_PHASE_MS, easing: EASE_HERO }
    ));
    add(animateIfPresent(
      swap.newSlot.querySelector(".heroContent"),
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: DATA_SWAP_PHASE_MS,
        delay: DATA_SWAP_PHASE_MS,
        easing: EASE_HERO,
        fill: "both",
      }
    ));
  }

  return animations;
}

function stageHeroTransition(currentItems, nextItems, renderFive) {
  const swap = prepareHeroSwap(planHeroSwap(currentItems, nextItems));
  if (!swap) return { swap: null, animations: [] };

  renderFive(nextItems, { preserveRows: true });
  reconcileHeroSwap(swap);
  return { swap, animations: animateHeroSwap(swap) };
}

function rowStepFromPositions(endRows, scale) {
  const lefts = [...endRows.values()].map((row) => row.left).sort((a, b) => a - b);
  if (lefts.length >= 2) return (lefts[lefts.length - 1] - lefts[lefts.length - 2]) / scale;
  const first = endRows.values().next().value;
  return first ? first.width / scale + 32 : ROW_FALLBACK_STEP_PX;
}

function attachGhostToTrack(ghost, track, leftOffsetPx = 0) {
  const ghostRect = ghost.el.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();
  const scale = getSceneScale();

  ghost.el.style.left = `${(ghostRect.left - trackRect.left) / scale + leftOffsetPx}px`;
  ghost.el.style.top = `${(ghostRect.top - trackRect.top) / scale}px`;
  ghost.el.style.zIndex = "4";
  track.appendChild(ghost.el);
}

function attachPromotedGhostToTrack(ghost, track, stepPx) {
  attachGhostToTrack(ghost, track, -stepPx);
}

function animateReorderedRows(startRows, endRows, promotedGhosts = []) {
  const rows = [...document.querySelectorAll(
    ".sessionTrack > .sessionRow:not(.sessionRowGhost)[data-rid]"
  )];
  const track = document.querySelector(".sessionTrack");
  const scale = getSceneScale();
  const movements = new Map();

  rows.forEach((element) => {
    const rid = String(element.dataset.rid);
    const start = startRows.get(rid);
    const end = endRows.get(rid);
    if (!start || !end) return;
    movements.set(rid, {
      dx: (start.left - end.left) / scale,
      dy: (start.top - end.top) / scale,
    });
  });

  const positiveMoves = [...movements.values()].map((move) => move.dx).filter((dx) => dx > 1);
  const entryDx = positiveMoves.length
    ? Math.max(...positiveMoves)
    : rowStepFromPositions(endRows, scale);
  const animations = [];

  if (track) {
    promotedGhosts.forEach((ghost) => attachPromotedGhostToTrack(ghost, track, entryDx));
    animations.push(track.animate(
      [
        { transform: `translateX(${entryDx}px)` },
        { transform: "translateX(0)" },
      ],
      { duration: ROW_MOVE_MS, easing: EASE_ROW_MOVE, fill: "forwards" }
    ));
  }

  return { rows, track, animations, stepPx: entryDx };
}

function animateFreshRows(rows, duration = CONTENT_FADE_MS) {
  return rows.map((element) => element.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration, easing: "ease-in-out", fill: "forwards" }
  ));
}

function animateUpdatedRows(rows) {
  const animations = [];

  rows.forEach(({ oldContent, newContent = [], kind }) => {
    const isMedia = kind === "media";
    const duration = isMedia ? HERO_BACKGROUND_FADE_MS : DATA_SWAP_PHASE_MS;
    const delay = isMedia ? 0 : DATA_SWAP_PHASE_MS;

    newContent.forEach((element) => {
      element.style.opacity = "0";
    });

    if (oldContent) {
      animations.push(oldContent.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration, easing: "ease-in-out", fill: "forwards" }
      ));
    }

    newContent.forEach((element) => {
      animations.push(element.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration,
          delay,
          easing: "ease-in-out",
          fill: "both",
        }
      ));
    });
  });

  return animations;
}

function cleanupUpdatedRows(rows) {
  rows.forEach(({ oldContent, newContent = [] }) => {
    oldContent?.remove();
    newContent.forEach((element) => {
      element.style.opacity = "";
    });
  });
}

function animateRowsWithFlip(startRows, endRows) {
  const scale = getSceneScale();
  const animations = [];

  endRows.forEach((end, rid) => {
    const start = startRows.get(rid);
    if (start) {
      const dx = (start.left - end.left) / scale;
      const dy = (start.top - end.top) / scale;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        animations.push(end.el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: ROW_MOVE_MS, easing: EASE_ROW_MOVE, fill: "forwards" }
        ));
      }
    }
  });

  return animations;
}

function synchronizeAnimationStart(animations) {
  const sharedStartTime = document.timeline.currentTime;
  if (sharedStartTime === null) return;
  animations.filter(Boolean).forEach((animation) => {
    animation.startTime = sharedStartTime;
  });
}

function animatePromotedRowsFade(ghosts) {
  return ghosts.map((ghost) => ghost.el.animate(
    [
      { opacity: 1 },
      { opacity: 0 },
    ],
    { duration: CONTENT_FADE_MS, easing: "ease-in-out", fill: "forwards" }
  ));
}

function animatePromotedRowsLeft(ghosts, endRows) {
  if (!ghosts.length) return [];
  const track = document.querySelector(".sessionTrack");
  if (!track) return animatePromotedRowsFade(ghosts);

  const stepPx = rowStepFromPositions(endRows, getSceneScale());
  ghosts.forEach((ghost) => attachGhostToTrack(ghost, track));
  return ghosts.flatMap((ghost) => [
    ghost.el.animate(
      [
        { transform: "translateX(0)" },
        { transform: `translateX(${-stepPx}px)` },
      ],
      { duration: ROW_MOVE_MS, easing: EASE_ROW_MOVE, fill: "forwards" }
    ),
    ghost.el.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: CONTENT_FADE_MS, easing: "ease-in-out", fill: "forwards" }
    ),
  ]);
}

function animateDisplacedRowsRight(ghosts, endRows, addedCount) {
  if (!ghosts.length) return [];
  const track = document.querySelector(".sessionTrack");
  const stepPx = rowStepFromPositions(endRows, getSceneScale()) * Math.max(1, addedCount);
  if (track) ghosts.forEach((ghost) => attachGhostToTrack(ghost, track));

  return ghosts.map((ghost) => ghost.el.animate(
    [
      { transform: "translateX(0)", opacity: 1 },
      { transform: `translateX(${stepPx}px)`, opacity: 0 },
    ],
    { duration: ROW_MOVE_MS, easing: EASE_ROW_MOVE, fill: "forwards" }
  ));
}

function planEnteringRows(
  rows,
  startRows,
  endRows,
  displacedStartIndices = new Set(),
  promotedStartIndices = new Set()
) {
  if (!rows.length) return [];
  const scale = getSceneScale();
  const retainedMoves = [...endRows.entries()].map(([rid, end]) => {
    const start = startRows.get(rid);
    if (!start) return null;
    return {
      startIndex: start.index,
      endIndex: end.index,
    };
  }).filter(Boolean);
  const maxEndIndex = Math.max(...[...endRows.values()].map((row) => row.index), -1);
  const stepPx = rowStepFromPositions(endRows, scale);

  return rows.map((element) => {
    const destinationIndex = Number(element.dataset.index);
    const opensInteriorGap = retainedMoves.some((move) =>
      move.startIndex >= destinationIndex && move.endIndex > move.startIndex
    );
    const vacatesDestination = retainedMoves.some((move) =>
      move.startIndex === destinationIndex && move.endIndex !== move.startIndex
    );
    const replenishesRightEdge = destinationIndex === maxEndIndex
      && retainedMoves.some((move) => move.endIndex < move.startIndex);
    const replacesDisplacedRightEdge = destinationIndex === maxEndIndex
      && displacedStartIndices.has(destinationIndex);
    const replacesPromotedSlot = promotedStartIndices.has(destinationIndex);

    if (replenishesRightEdge) {
      return { element, route: "right-edge", stepPx, fadeDelay: 0 };
    }
    if (
      opensInteriorGap
      || vacatesDestination
      || replacesDisplacedRightEdge
      || replacesPromotedSlot
    ) {
      return {
        element,
        route: "vacated-slot",
        stepPx: 0,
        fadeDelay: Math.max(0, ROW_MOVE_MS - Math.max(0, CARD_INSERT_FADE_EARLY_MS)),
      };
    }
    return { element, route: "in-place", stepPx: 0, fadeDelay: 0 };
  });
}

function animateEnteringRows(entryPlans) {
  const animations = [];

  entryPlans.forEach(({ element, route, stepPx, fadeDelay }) => {
    if (route === "right-edge") {
      animations.push(element.animate(
        [
          { transform: `translateX(${stepPx}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: ROW_MOVE_MS, easing: EASE_ROW_MOVE, fill: "both" }
      ));
    }

    animations.push(element.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: CONTENT_FADE_MS,
        delay: fadeDelay,
        easing: "ease-in-out",
        fill: "both",
      }
    ));
  });

  return animations;
}

async function settleAnimations(animations) {
  const valid = animations.filter(Boolean);
  await Promise.allSettled(valid.map((animation) => animation.finished));
  valid.forEach((animation) => animation.cancel());
}

function removeGhosts(ghosts) {
  ghosts.forEach((ghost) => ghost.el.remove());
  clearGhostLayer();
}

async function performContentTransition(current, nextItems, deps) {
  const { renderFive, updateNoSessionsText } = deps;

  const startRows = captureRows();
  const reusable = reusableRowRids(current, nextItems);
  const changed = changedRows(current, nextItems);
  const oldRowGhosts = [...startRows.values()]
    .filter((row) => !reusable.has(row.rid))
    .map(cloneRowAsGhost)
    .filter(Boolean);
  const heroTransition = stageHeroTransition(current, nextItems, renderFive);

  const rendered = renderFive(nextItems, {
    preserveHero: true,
    reusableRowRids: reusable,
    refreshRowFields: changed,
  });
  updateNoSessionsText(nextItems, false);

  const animations = [
    ...oldRowGhosts.map((ghost) => ghost.el.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: CONTENT_FADE_MS, easing: "ease-in-out", fill: "forwards" }
    )),
    ...animateFreshRows(rendered?.createdRows || []),
    ...animateUpdatedRows(rendered?.updatedRows || []),
    ...heroTransition.animations,
  ];
  synchronizeAnimationStart(animations);

  await settleAnimations(animations);
  removeGhosts(oldRowGhosts);
  cleanupUpdatedRows(rendered?.updatedRows || []);
  heroTransition.swap?.oldSlot.remove();
}

async function performSequenceTransition(
  current,
  nextItems,
  deps,
  nextRoles,
  changedTimeRids
) {
  const { renderFive, updateNoSessionsText } = deps;

  const startRows = captureRows();
  const reusable = reusableRowRids(current, nextItems);
  const { removed, promoted, displaced } = planLeavingRows(
    startRows,
    nextItems,
    nextRoles,
    changedTimeRids,
    reusable
  );
  const heroTransition = stageHeroTransition(current, nextItems, renderFive);
  const removalAnimations = removed.flatMap(animateRemovedCard);
  synchronizeAnimationStart([...removalAnimations, ...heroTransition.animations]);
  await settleAnimations(removalAnimations);
  removed.forEach((ghost) => ghost.el.remove());

  const preReorderRows = captureRows();
  const changed = changedRows(current, nextItems);
  const rendered = renderFive(nextItems, {
    preserveHero: true,
    reusableRowRids: reusable,
    refreshRowFields: changed,
  });
  updateNoSessionsText(nextItems, false);

  const endRows = captureRows();
  const rowTransition = animateReorderedRows(preReorderRows, endRows, promoted);
  const addedCount = (rendered?.createdRows || [])
    .filter((element) => !startRows.has(String(element.dataset.rid)))
    .length;
  const animations = [
    ...rowTransition.animations,
    ...animateDisplacedRowsRight(displaced, endRows, addedCount),
    ...animatePromotedRowsFade(promoted),
    ...animateFreshRows(rendered?.createdRows || []),
    ...animateUpdatedRows(rendered?.updatedRows || []),
  ];
  synchronizeAnimationStart(animations);

  await settleAnimations([...heroTransition.animations, ...animations]);
  rowTransition.rows.forEach((element) => {
    element.style.zIndex = "";
  });
  removeGhosts([...removed, ...promoted, ...displaced]);
  cleanupUpdatedRows(rendered?.updatedRows || []);
  heroTransition.swap?.oldSlot.remove();
}

async function performLayoutTransition(
  current,
  nextItems,
  deps,
  nextRoles,
  changedTimeRids
) {
  const { renderFive, updateNoSessionsText } = deps;
  const startRows = captureRows();
  const reusable = reusableRowRids(current, nextItems);
  const { removed, promoted, displaced } = planLeavingRows(
    startRows,
    nextItems,
    nextRoles,
    changedTimeRids,
    reusable
  );

  const heroTransition = stageHeroTransition(current, nextItems, renderFive);
  const removalAnimations = removed.flatMap(animateRemovedCard);
  synchronizeAnimationStart([...removalAnimations, ...heroTransition.animations]);
  await settleAnimations(removalAnimations);
  removeGhosts(removed);

  const changed = changedRows(current, nextItems);
  const rendered = renderFive(nextItems, {
    preserveHero: true,
    reusableRowRids: reusable,
    refreshRowFields: changed,
  });
  updateNoSessionsText(nextItems, false);

  const endRows = captureRows();
  const retainedStartRows = new Map(
    [...startRows].filter(([rid]) => reusable.has(rid))
  );
  // Вход в пять нижних слотов всегда считается новым визуальным появлением:
  // неважно, пришёл RID из Hero, из резерва или впервые возник в данных.
  const enteringRows = rendered?.createdRows || [];
  enteringRows.forEach((element) => {
    element.style.opacity = "0";
  });
  const displacedStartIndices = new Set(
    displaced
      .map((ghost) => startRows.get(String(ghost.rid))?.index)
      .filter((index) => Number.isFinite(index))
  );
  const promotedStartIndices = new Set(
    promoted
      .map((ghost) => startRows.get(String(ghost.rid))?.index)
      .filter((index) => Number.isFinite(index))
  );
  const entryPlans = planEnteringRows(
    enteringRows,
    retainedStartRows,
    endRows,
    displacedStartIndices,
    promotedStartIndices
  );
  const addedCount = enteringRows.length;

  const layoutAnimations = [
    ...animateRowsWithFlip(retainedStartRows, endRows),
    ...animatePromotedRowsLeft(promoted, endRows),
    ...animateDisplacedRowsRight(displaced, endRows, addedCount),
    ...animateEnteringRows(entryPlans),
    ...animateUpdatedRows(rendered?.updatedRows || []),
  ];
  synchronizeAnimationStart(layoutAnimations);

  await settleAnimations([...heroTransition.animations, ...layoutAnimations]);
  removeGhosts([...promoted, ...displaced]);
  cleanupUpdatedRows(rendered?.updatedRows || []);
  heroTransition.swap?.oldSlot.remove();

  enteringRows.forEach((element) => {
    element.style.opacity = "";
  });
}

export function initializeScheduleAnimation(knownUpcomingRids, upcomingSchedule) {
  if (!(knownUpcomingRids instanceof Set)) return;
  appliedKnownUpcomingRids = new Set(knownUpcomingRids);
  appliedUpcomingSchedule = copyUpcomingSchedule(upcomingSchedule);
  pendingTimeChangedRids = new Set();
  pendingTransitions = [];
}

function startTransition(entry) {
  const {
    items: targetItems,
    deps,
    knownUpcomingRids,
    upcomingSchedule,
  } = entry;
  const current = getCurrentState();
  const previousKnownUpcomingRids = new Set(appliedKnownUpcomingRids);
  const previousUpcomingSchedule = new Map(appliedUpcomingSchedule);
  rememberScheduleChanges(previousUpcomingSchedule, upcomingSchedule);
  const changedTimeRids = new Set(pendingTimeChangedRids);
  const previousRoles = buildRidRoles(current, previousKnownUpcomingRids);
  const nextRoles = buildRidRoles(targetItems, knownUpcomingRids);

  if (sameContent(current, targetItems)) {
    appliedKnownUpcomingRids = new Set(knownUpcomingRids);
    appliedUpcomingSchedule = new Map(upcomingSchedule);
    const next = pendingTransitions.shift();
    if (next) startTransition(next);
    return;
  }

  setAnimating(true);
  cancelAllAnimations();
  setCurrentState(targetItems);

  let transition;
  if (!current.length || sameVisualSequence(current, targetItems)) {
    transition = performContentTransition(current, targetItems, deps);
  } else if (
    hasSequentialShift(current, targetItems)
    && !needsCauseAwareLayout(
      targetItems,
      previousRoles,
      changedTimeRids
    )
  ) {
    transition = performSequenceTransition(
      current,
      targetItems,
      deps,
      nextRoles,
      changedTimeRids
    );
  } else {
    transition = performLayoutTransition(
      current,
      targetItems,
      deps,
      nextRoles,
      changedTimeRids
    );
  }

  transition
    .then(() => {
      appliedKnownUpcomingRids = new Set(knownUpcomingRids);
      appliedUpcomingSchedule = new Map(upcomingSchedule);
      forgetVisualizedScheduleChanges(current, targetItems);
    })
    .catch((error) => {
      console.error("schedule transition error:", error);
      const recoveryItems = getCurrentState();
      deps.renderFive(recoveryItems);
      deps.updateNoSessionsText(recoveryItems, false);
      document.querySelectorAll(".heroTransitionGhost, #ghostLayer").forEach((element) => element.remove());
      appliedKnownUpcomingRids = new Set(knownUpcomingRids);
      appliedUpcomingSchedule = new Map(upcomingSchedule);
      forgetVisualizedScheduleChanges(current, targetItems);
    })
    .finally(() => {
      setAnimating(false);
      const next = pendingTransitions.shift();
      if (next) startTransition(next);
    });
}

function enqueueTransition(entry) {
  const lastIndex = pendingTransitions.length - 1;
  const last = pendingTransitions[lastIndex];
  const comparisonItems = last?.items || getCurrentState();

  if (sameContent(comparisonItems, entry.items)) {
    if (last) {
      last.knownUpcomingRids = entry.knownUpcomingRids;
      last.upcomingSchedule = entry.upcomingSchedule;
    } else {
      pendingTransitions.push(entry);
    }
    return;
  }

  if (last && sameSequence(last.items, entry.items)) {
    pendingTransitions[lastIndex] = entry;
    return;
  }

  pendingTransitions.push(entry);
}

export function runFlipTransition(nextItems, deps) {
  const entry = {
    items: nextItems,
    deps,
    knownUpcomingRids: deps.knownUpcomingRids instanceof Set
      ? new Set(deps.knownUpcomingRids)
      : new Set(nextItems.map((item) => String(item.rid))),
    upcomingSchedule: copyUpcomingSchedule(deps.upcomingSchedule, nextItems),
  };

  if (isAnimating()) {
    enqueueTransition(entry);
    return;
  }

  startTransition(entry);
}
