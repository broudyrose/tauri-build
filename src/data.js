/// data.js
export const AUTO_POLL = true;
export const POLL_MS = 1000;
export const MAX_VISIBLE_SESSIONS = 8;

let inFlight = false;

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

export async function fetchUpcoming(invoke, limit = MAX_VISIBLE_SESSIONS, nowOverride = null) {
  if (inFlight) return null;
  inFlight = true;
  try {
    return await invoke("get_upcoming_posters", {
      limit,
      now: nowOverride ?? hhmmNow(),
    });
  } finally {
    inFlight = false;
  }
}

export function normalizeSessions(items, limit = MAX_VISIBLE_SESSIONS) {
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

export function sameContent(a, b) {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (
      a[i].rid !== b[i].rid ||
      a[i].id !== b[i].id ||
      a[i].time !== b[i].time ||
      a[i].title !== b[i].title ||
      a[i].age !== b[i].age ||
      a[i].hall !== b[i].hall ||
      a[i].duration !== b[i].duration ||
      a[i].price !== b[i].price ||
      a[i].soldout !== b[i].soldout ||
      a[i].soldout_badge !== b[i].soldout_badge ||
      a[i].poster_data_url !== b[i].poster_data_url
    ) return false;
  }

  return true;
}