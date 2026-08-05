// main.js

import {
  AUTO_POLL,
  POLL_MS,
  VISIBLE_SESSIONS,
  FETCH_SESSIONS,
  DEBUG_NOW_OVERRIDE,
  getInvoke,
  getLatestVxodValue,
  getLatestUpcomingRids,
  getLatestUpcomingSchedule,
  fetchUpcoming,
  fetchAdvertisedCatalog,
  normalizeSessions,
} from "./data.js";
import {
  showScene,
  renderFive,
  updateNoSessionsText,
  positionNextBadge,
  placeNoSessionsAtFirstSlot,
  setCompactModeGetter,
  setCurrentState,
  getCurrentState,
  updateClock,
  updateEntranceNotice,
  startHeroTitleShine,
  isAnimating,
} from "./render.js";
import { createWindowController } from "./window.js";
import {
  HERO_BACKGROUND_FADE_MS,
  initializeScheduleAnimation,
  runFlipTransition,
} from "./anim.js";

const FULL_W = 1280;
const FULL_H = 704;
const MINI_W = 640;
const MINI_H = 352;
const EMPTY_POLL_CONFIRMATIONS = 2;
const POSTER_DURATION_MS = 18000; // Полное время размытой афиши от появления до исчезновения.
const HEADER_DURATION_MS = 18000; // Полное время одиночного хедера от появления до исчезновения.
const GALLERY_SLIDE_DURATION_MS = 18000; // Полное время каждого файла gallery от появления до исчезновения.
const TRANSITION_SETTLE_POLL_MS = 100;

async function loadBoardFonts() {
  if (!document.fonts) return;
  await Promise.allSettled(
    [300, 400, 500, 600, 700].map((weight) =>
      document.fonts.load(`${weight} 16px "TT Firs Neue"`)
    )
  );
}

window.addEventListener("DOMContentLoaded", async () => {
  let compactMode = false;
  let consecutiveEmptyPolls = 0;
  let advertisingActive = false;
  let advertisingPrepared = false;
  let advertisingDeck = [];
  let advertisingCursor = 0;
  let advertisingGalleryIndex = 0;
  let advertisingRevision = 0;
  let advertisingTimer = 0;
  let advertisingVideo = null;
  let advertisingVideoEnded = null;
  let advertisingVideoError = null;
  let advertisingVideoPlaying = null;
  let advertisingVideoTimeUpdate = null;
  let ordinaryGalleryTimer = 0;
  let ordinaryGalleryRevision = 0;
  let ordinaryGalleryKey = "";
  let ordinaryGalleryPaths = [];
  let ordinaryGalleryIndex = 0;

  const compactModeRef = {
    get: () => compactMode,
    set: (v) => { compactMode = v; },
  };

  setCompactModeGetter(() => compactMode);

  const transitionDeps = (knownUpcomingRids, upcomingSchedule) => ({
    renderFive,
    updateNoSessionsText,
    placeNoSessionsAtFirstSlot,
    positionNextBadge,
    applyZByOrder: () => {},
    knownUpcomingRids,
    upcomingSchedule,
  });

  const shuffled = (items) => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  };

  const heroGalleryPaths = (item) => {
    if (item?.trailer_path) return [];
    const paths = Array.isArray(item?.gallery_paths) ? item.gallery_paths : [];
    return paths.length >= 2 ? paths : [];
  };

  const advertisingHeroItem = (item) => {
    const paths = heroGalleryPaths(item);
    if (!paths.length) return item;

    const index = Math.min(advertisingGalleryIndex, paths.length - 1);
    return { ...item, active_gallery_path: paths[index] };
  };

  const advertisingWindow = () => {
    const count = Math.min(VISIBLE_SESSIONS, advertisingDeck.length);
    return Array.from({ length: count }, (_unused, offset) => {
      const item = advertisingDeck[(advertisingCursor + offset) % advertisingDeck.length];
      return offset === 0 ? advertisingHeroItem(item) : item;
    });
  };

  const advertisingStaticDuration = (item) => {
    if (heroGalleryPaths(item).length) return GALLERY_SLIDE_DURATION_MS;
    if (item?.header_path) return HEADER_DURATION_MS;
    return POSTER_DURATION_MS;
  };

  const advertisingStaticWait = (item) => Math.max(
    0,
    advertisingStaticDuration(item) - HERO_BACKGROUND_FADE_MS
  );

  const ordinaryGallerySourceKey = (item, paths) => paths.length
    ? `${item?.rid ?? ""}\u0000${item?.id ?? ""}\u0000${paths.join("\u0000")}`
    : "";

  const stopOrdinaryGallery = () => {
    ordinaryGalleryRevision += 1;
    window.clearTimeout(ordinaryGalleryTimer);
    ordinaryGalleryTimer = 0;
    ordinaryGalleryKey = "";
    ordinaryGalleryPaths = [];
    ordinaryGalleryIndex = 0;
  };

  const projectOrdinaryGallery = (items) => {
    const result = Array.isArray(items) ? [...items] : [];
    const hero = result[0] || null;
    const paths = heroGalleryPaths(hero);
    const key = ordinaryGallerySourceKey(hero, paths);
    const sourceChanged = key !== ordinaryGalleryKey;

    if (sourceChanged) {
      ordinaryGalleryRevision += 1;
      window.clearTimeout(ordinaryGalleryTimer);
      ordinaryGalleryTimer = 0;
      ordinaryGalleryKey = key;
      ordinaryGalleryPaths = paths;
      ordinaryGalleryIndex = 0;
    }

    if (paths.length) {
      const index = Math.min(ordinaryGalleryIndex, paths.length - 1);
      result[0] = { ...hero, active_gallery_path: paths[index] };
    }

    return { items: result, sourceChanged };
  };

  const queueOrdinaryGalleryAdvance = () => {
    if (advertisingActive || !ordinaryGalleryKey || ordinaryGalleryPaths.length < 2) return;
    ordinaryGalleryRevision += 1;
    const revision = ordinaryGalleryRevision;
    const expectedKey = ordinaryGalleryKey;
    const expectedPath = ordinaryGalleryPaths[ordinaryGalleryIndex];
    window.clearTimeout(ordinaryGalleryTimer);

    const advance = () => {
      if (
        advertisingActive
        || revision !== ordinaryGalleryRevision
        || !ordinaryGalleryKey
        || ordinaryGalleryPaths.length < 2
      ) return;
      ordinaryGalleryTimer = 0;
      if (isAnimating()) {
        ordinaryGalleryTimer = window.setTimeout(advance, TRANSITION_SETTLE_POLL_MS);
        return;
      }

      ordinaryGalleryIndex = (ordinaryGalleryIndex + 1) % ordinaryGalleryPaths.length;
      const current = getCurrentState();
      const hero = current[0] || null;
      const paths = heroGalleryPaths(hero);
      if (ordinaryGallerySourceKey(hero, paths) !== ordinaryGalleryKey) {
        stopOrdinaryGallery();
        return;
      }

      const nextItems = [
        { ...hero, active_gallery_path: ordinaryGalleryPaths[ordinaryGalleryIndex] },
        ...current.slice(1),
      ];
      runFlipTransition(
        nextItems,
        transitionDeps(getLatestUpcomingRids(), getLatestUpcomingSchedule())
      );
      queueOrdinaryGalleryAdvance();
    };

    const arm = () => {
      if (
        advertisingActive
        || revision !== ordinaryGalleryRevision
        || ordinaryGalleryKey !== expectedKey
      ) return;

      const hero = getCurrentState()[0] || null;
      const paths = heroGalleryPaths(hero);
      if (
        ordinaryGallerySourceKey(hero, paths) !== expectedKey
        || hero?.active_gallery_path !== expectedPath
      ) {
        ordinaryGalleryTimer = window.setTimeout(arm, TRANSITION_SETTLE_POLL_MS);
        return;
      }

      ordinaryGalleryTimer = window.setTimeout(
        advance,
        Math.max(0, GALLERY_SLIDE_DURATION_MS - HERO_BACKGROUND_FADE_MS)
      );
    };

    arm();
  };

  const advertisingRids = () => new Set(
    advertisingDeck.map((item) => String(item.rid))
  );

  const advertisingSchedule = () => new Map(
    advertisingDeck.map((item) => [String(item.rid), ""])
  );

  const clearAdvertisingAdvance = () => {
    advertisingRevision += 1;
    window.clearTimeout(advertisingTimer);
    advertisingTimer = 0;
    if (advertisingVideo && advertisingVideoEnded) {
      advertisingVideo.removeEventListener("ended", advertisingVideoEnded);
    }
    if (advertisingVideo && advertisingVideoError) {
      advertisingVideo.removeEventListener("error", advertisingVideoError);
    }
    if (advertisingVideo && advertisingVideoPlaying) {
      advertisingVideo.removeEventListener("playing", advertisingVideoPlaying);
    }
    if (advertisingVideo && advertisingVideoTimeUpdate) {
      advertisingVideo.removeEventListener("timeupdate", advertisingVideoTimeUpdate);
    }
    advertisingVideo = null;
    advertisingVideoEnded = null;
    advertisingVideoError = null;
    advertisingVideoPlaying = null;
    advertisingVideoTimeUpdate = null;
  };

  const queueAdvertisingAdvance = () => {
    if (!advertisingActive || !advertisingDeck.length) return;
    clearAdvertisingAdvance();
    const revision = advertisingRevision;

    const scheduleAction = (action, delay) => {
      window.clearTimeout(advertisingTimer);
      advertisingTimer = window.setTimeout(() => {
        advertisingTimer = 0;
        action();
      }, delay);
    };

    const transitionAdvertising = (advanceGallery) => {
      if (!advertisingActive || revision !== advertisingRevision) return;
      if (isAnimating()) {
        if (!advertisingTimer) {
          scheduleAction(
            () => transitionAdvertising(advanceGallery),
            TRANSITION_SETTLE_POLL_MS
          );
        }
        return;
      }
      window.clearTimeout(advertisingTimer);
      advertisingTimer = 0;

      clearAdvertisingAdvance();
      if (advanceGallery) {
        advertisingGalleryIndex += 1;
      } else {
        advertisingCursor = (advertisingCursor + 1) % advertisingDeck.length;
        advertisingGalleryIndex = 0;
      }
      const nextItems = advertisingWindow();
      runFlipTransition(
        nextItems,
        transitionDeps(advertisingRids(), advertisingSchedule())
      );
      queueAdvertisingAdvance();
    };

    const advanceProgram = () => transitionAdvertising(false);

    const advanceStatic = () => {
      const item = advertisingDeck[advertisingCursor];
      const paths = heroGalleryPaths(item);
      const hasNextGalleryImage = paths.length > 0
        && advertisingGalleryIndex < paths.length - 1;
      transitionAdvertising(hasNextGalleryImage);
    };

    const arm = () => {
      if (!advertisingActive || revision !== advertisingRevision) return;
      advertisingTimer = 0;
      const hero = document.querySelector(
        '.heroSessionSlot .heroSession[data-advertising="true"]'
      );
      const expectedRid = String(getCurrentState()[0]?.rid ?? "");
      if (!hero || hero.dataset.rid !== expectedRid) {
        advertisingTimer = window.setTimeout(arm, TRANSITION_SETTLE_POLL_MS);
        return;
      }

      const video = hero.querySelector(".heroMediaVideo");
      if (!video) {
        scheduleAction(
          advanceStatic,
          advertisingStaticWait(advertisingDeck[advertisingCursor])
        );
        return;
      }

      advertisingVideo = video;
      advertisingVideoEnded = advanceProgram;
      advertisingVideoPlaying = () => {
        if (revision !== advertisingRevision) return;
        video.classList.add("is-playing");
        advertisingVideoTimeUpdate?.();
      };
      advertisingVideoTimeUpdate = () => {
        if (revision !== advertisingRevision) return;
        const duration = Number(video.duration);
        const currentTime = Number(video.currentTime);
        if (!Number.isFinite(duration) || !Number.isFinite(currentTime) || duration <= 0) return;
        const remainingMs = Math.max(0, (duration - currentTime) * 1000);
        if (remainingMs <= HERO_BACKGROUND_FADE_MS) advanceProgram();
      };
      advertisingVideoError = (reason) => {
        if (revision !== advertisingRevision) return;
        video.classList.remove("is-playing");
        if (advertisingTimer) return;
        const mediaError = video.error;
        console.error("advertising video error:", {
          rid: hero.dataset.rid,
          src: video.currentSrc || video.src,
          code: mediaError?.code ?? null,
          message: mediaError?.message || "",
          reason: reason instanceof Error ? reason.message : "",
        });
        scheduleAction(
          advanceProgram,
          Math.max(0, POSTER_DURATION_MS - HERO_BACKGROUND_FADE_MS)
        );
      };
      video.addEventListener("ended", advertisingVideoEnded, { once: true });
      video.addEventListener("error", advertisingVideoError, { once: true });
      video.addEventListener("playing", advertisingVideoPlaying, { once: true });
      video.addEventListener("timeupdate", advertisingVideoTimeUpdate);
      video.classList.remove("is-playing");
      try {
        video.currentTime = 0;
      } catch {}
      const playback = video.play();
      playback?.catch((error) => advertisingVideoError(error));
    };

    arm();
  };

  const enterAdvertisingMode = async (invoke, { initial = false } = {}) => {
    if (advertisingPrepared) return advertisingActive;
    advertisingPrepared = true;
    let catalog;
    try {
      catalog = await fetchAdvertisedCatalog(invoke);
    } catch (error) {
      advertisingPrepared = false;
      console.error("advertising catalog error:", error);
      return false;
    }
    advertisingDeck = shuffled(catalog);
    advertisingCursor = 0;
    advertisingGalleryIndex = 0;
    advertisingActive = advertisingDeck.length > 0;
    stopOrdinaryGallery();

    if (!advertisingActive) {
      advertisingPrepared = false;
      if (!initial) {
        updateEntranceNotice(getLatestVxodValue(), [], false);
        runFlipTransition([], transitionDeps(new Set(), new Map()));
      }
      return false;
    }

    const nextItems = advertisingWindow();
    updateEntranceNotice(getLatestVxodValue(), nextItems, false);
    if (initial) {
      initializeScheduleAnimation(advertisingRids(), advertisingSchedule());
      setCurrentState(nextItems);
      renderFive(nextItems);
      updateEntranceNotice(getLatestVxodValue(), nextItems, false);
      updateNoSessionsText(nextItems, false);
      positionNextBadge();
      return true;
    }

    runFlipTransition(
      nextItems,
      transitionDeps(advertisingRids(), advertisingSchedule())
    );
    queueAdvertisingAdvance();
    return true;
  };

  const leaveAdvertisingMode = () => {
    clearAdvertisingAdvance();
    advertisingActive = false;
    advertisingPrepared = false;
    advertisingDeck = [];
    advertisingCursor = 0;
    advertisingGalleryIndex = 0;
  };

  await loadBoardFonts();
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
    const first = await fetchUpcoming(invoke, FETCH_SESSIONS, DEBUG_NOW_OVERRIDE);
    if (first) {
      const normalized = normalizeSessions(first, VISIBLE_SESSIONS);
      consecutiveEmptyPolls = normalized.length ? 0 : 1;
      const advertisingStarted = !normalized.length
        && await enterAdvertisingMode(invoke, { initial: true });
      if (!advertisingStarted) {
        const projected = projectOrdinaryGallery(normalized);
        const current = projected.items;
        initializeScheduleAnimation(
          getLatestUpcomingRids(),
          getLatestUpcomingSchedule()
        );
        setCurrentState(current);
        renderFive(current);
        updateEntranceNotice(getLatestVxodValue(), current);
        updateNoSessionsText(current, false);
        positionNextBadge();
        if (projected.sourceChanged) queueOrdinaryGalleryAdvance();
      }
    }
  } catch (e) {
    console.error("initial fetchUpcoming error:", e);
  }

  showScene();
  if (advertisingActive) queueAdvertisingAdvance();
  startHeroTitleShine();
  windowCtrl.applyViewportScale();

  window.addEventListener("resize", () => {
    windowCtrl.applyViewportScale();
    positionNextBadge();
    placeNoSessionsAtFirstSlot();
  });

  if (AUTO_POLL) {
    setInterval(async () => {
      updateClock();

      try {
        const fetched = await fetchUpcoming(invoke, FETCH_SESSIONS, DEBUG_NOW_OVERRIDE);
        if (!fetched) return;
        const normalized = normalizeSessions(fetched, VISIBLE_SESSIONS);

        if (!normalized.length) {
          consecutiveEmptyPolls += 1;
          if (consecutiveEmptyPolls < EMPTY_POLL_CONFIRMATIONS) return;
          if (!advertisingPrepared) await enterAdvertisingMode(invoke);
          else updateEntranceNotice(getLatestVxodValue(), normalized, false);
          return;
        } else {
          consecutiveEmptyPolls = 0;
          if (advertisingPrepared) leaveAdvertisingMode();
        }

        const projected = projectOrdinaryGallery(normalized);
        const nextItems = projected.items;

        updateEntranceNotice(getLatestVxodValue(), nextItems);

        runFlipTransition(
          nextItems,
          transitionDeps(getLatestUpcomingRids(), getLatestUpcomingSchedule())
        );
        if (projected.sourceChanged) queueOrdinaryGalleryAdvance();
      } catch (e) {
        console.error("poll fetchUpcoming error:", e);
      }
    }, POLL_MS);
  }

  document.getElementById("debugRemove")?.addEventListener("click", async () => {
    try {
      const fetched = await fetchUpcoming(invoke, FETCH_SESSIONS, DEBUG_NOW_OVERRIDE);
      if (!fetched?.length) return;

      const current = getCurrentState();
      const idx = fetched.findIndex((x) => x.rid === current[0]?.rid);
      const normalized = normalizeSessions(
        idx === -1 ? fetched.slice(0, FETCH_SESSIONS) : fetched.slice(idx + 1, idx + 1 + FETCH_SESSIONS),
        VISIBLE_SESSIONS
      );
      if (advertisingPrepared) leaveAdvertisingMode();
      const projected = projectOrdinaryGallery(normalized);
      const nextItems = projected.items;
      updateEntranceNotice(getLatestVxodValue(), nextItems);

      runFlipTransition(
        nextItems,
        transitionDeps(getLatestUpcomingRids(), getLatestUpcomingSchedule())
      );
      if (projected.sourceChanged) queueOrdinaryGalleryAdvance();
    } catch (e) {
      console.error("debugRemove error:", e);
    }
  });
});
