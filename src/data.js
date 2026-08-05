/// data.js
export const AUTO_POLL = true;
export const POLL_MS = 1000;
export const VISIBLE_SESSIONS = 6;
export const FETCH_SESSIONS = VISIBLE_SESSIONS + 1;
export const DEBUG_NOW_OVERRIDE = null;

let inFlight = false;
let latestVxodValue = 2;
let latestUpcomingRids = new Set();
let latestUpcomingSchedule = new Map();

function normalizeVxodValue(value) {
  const normalized = Number(value);
  return normalized === 0 || normalized === 1 || normalized === 2 ? normalized : 2;
}

export function getLatestVxodValue() {
  return latestVxodValue;
}

export function getLatestUpcomingRids() {
  return new Set(latestUpcomingRids);
}

export function getLatestUpcomingSchedule() {
  return new Map(latestUpcomingSchedule);
}

export function hhmmNow() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function getInvoke() {
  const g = window.__TAURI__?.core?.invoke;
  if (typeof g === "function") return g;
  const mod = await import("@tauri-apps/api/core");
  if (typeof mod.invoke === "function") return mod.invoke;
  throw new Error("invoke недоступен");
}

export async function fetchUpcoming(invoke, limit = FETCH_SESSIONS, nowOverride = null) {
  if (inFlight) return null;
  inFlight = true;
  try {
    const snapshot = await invoke("get_upcoming_posters", {
      limit,
      now: nowOverride ?? hhmmNow(),
    });

    if (Array.isArray(snapshot)) {
      latestUpcomingRids = new Set(snapshot.map((item) => String(item.rid)));
      latestUpcomingSchedule = new Map(snapshot.map((item) => [
        String(item.rid),
        String(item.time || "").trim(),
      ]));
      return snapshot;
    }

    latestVxodValue = normalizeVxodValue(snapshot?.vxod_value);
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const knownRids = Array.isArray(snapshot?.upcoming_rids)
      ? snapshot.upcoming_rids
      : items.map((item) => item.rid);
    const scheduleItems = Array.isArray(snapshot?.upcoming_schedule)
      ? snapshot.upcoming_schedule
      : items;
    latestUpcomingRids = new Set(knownRids.map((rid) => String(rid)));
    latestUpcomingSchedule = new Map(scheduleItems.map((item) => [
      String(item.rid),
      String(item.time || "").trim(),
    ]));
    return items;
  } finally {
    inFlight = false;
  }
}

export async function fetchAdvertisedCatalog(invoke) {
  const items = await invoke("get_advertised_catalog");
  return (Array.isArray(items) ? items : []).filter((item) =>
    item
    && Number(item.id) !== 0
  );
}

export function normalizeSessions(items, limit = VISIBLE_SESSIONS) {
  return (Array.isArray(items) ? items : [])
    .filter(x => x && x.id !== 0 && String(x.time || "").trim() !== "")
    .slice(0, limit);
}

export function hasRealSessions(items) {
  return Array.isArray(items) && items.length > 0;
}

export function sameSequence(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].rid !== b[i].rid) return false;
  return true;
}

function sameStringList(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function sameContent(a, b) {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (
      a[i].rid !== b[i].rid ||
      a[i].id !== b[i].id ||
      a[i].advertising !== b[i].advertising ||
      a[i].time !== b[i].time ||
      a[i].title !== b[i].title ||
      a[i].age !== b[i].age ||
      a[i].hall !== b[i].hall ||
      a[i].duration !== b[i].duration ||
      a[i].price !== b[i].price ||
      a[i].soldout !== b[i].soldout ||
      a[i].soldout_badge !== b[i].soldout_badge ||
      a[i].poster_data_url !== b[i].poster_data_url ||
      !sameStringList(a[i].gallery_paths, b[i].gallery_paths) ||
      a[i].header_path !== b[i].header_path ||
      a[i].active_gallery_path !== b[i].active_gallery_path ||
      a[i].trailer_path !== b[i].trailer_path
    ) return false;
  }

  return true;
}
