const WINDOW_CONTROLS_IDLE_MS = 7000;

export function createWindowController({
  invoke,
  applyViewportScale,
  positionNextBadge,
  placeNoSessionsAtFirstSlot,
  syncCompactModeFromWindow,
  compactModeRef,
}) {
  const tauriWindow = window.__TAURI__?.window;
  let viewport = null;
  let dragStart = null;
  let dragStarted = false;
  let controlsIdleTimer = 0;

  function hideWindowControls() {
    window.clearTimeout(controlsIdleTimer);
    controlsIdleTimer = 0;
    document.body.classList.remove("window-controls-visible");
  }

  function showWindowControls() {
    document.body.classList.add("window-controls-visible");
    window.clearTimeout(controlsIdleTimer);
    controlsIdleTimer = window.setTimeout(
      hideWindowControls,
      WINDOW_CONTROLS_IDLE_MS
    );
  }

  function bindWindowControlsVisibility() {
    window.addEventListener("pointermove", showWindowControls, { passive: true });
    window.addEventListener("pointerdown", showWindowControls, { passive: true });
    document.documentElement.addEventListener("pointerleave", hideWindowControls);
    window.addEventListener("blur", hideWindowControls);
  }

  function stopPointer() {
    dragStart = null;
    dragStarted = false;
  }

  function refreshLayout() {
    applyViewportScale();
    positionNextBadge();
    placeNoSessionsAtFirstSlot();
  }

  async function syncPinButton() {
    const btn = document.getElementById("pinWin");
    if (!btn || !tauriWindow) return;

    try {
      const isTop = await tauriWindow.getCurrentWindow().isAlwaysOnTop();
      btn.classList.toggle("is-active", isTop);
    } catch (e) {
      console.error("syncPinButton error:", e);
    }
  }

  async function handleClose() {
    if (!tauriWindow) return;
    try {
      await tauriWindow.getCurrentWindow().close();
    } catch (e) {
      console.error("closeWin error:", e);
    }
  }

  async function handlePin() {
    if (!tauriWindow) return;
    try {
      const win = tauriWindow.getCurrentWindow();
      const next = !(await win.isAlwaysOnTop());
      await win.setAlwaysOnTop(next);
      document.getElementById("pinWin")?.classList.toggle("is-active", next);
    } catch (e) {
      console.error("pinWin error:", e);
    }
  }

  async function handleMove() {
    try {
      compactModeRef.set(false);
      await invoke("move_window_to_next_monitor");
      refreshLayout();
      await invoke("show_window");
    } catch (e) {
      console.error("move error:", e);
      try { await invoke("show_window"); } catch {}
    }
  }

  async function handleToggleCompact() {
    try {
      compactModeRef.set(!compactModeRef.get());
      await invoke("toggle_window_size_and_center", { compact: compactModeRef.get() });
      refreshLayout();
      await invoke("show_window");
    } catch (e) {
      compactModeRef.set(!compactModeRef.get());
      console.error("toggle size/center error:", e);
      try { await invoke("show_window"); } catch {}
    }
  }

  async function handleViewportRightClick(e) {
    if (!tauriWindow) return;
    if (e.target.closest("#closeWin, #pinWin")) return;

    e.preventDefault();
    stopPointer();
    await handleMove();
  }

  function bindDrag() {
    if (!viewport || !tauriWindow) return;

    viewport.addEventListener("pointerdown", (e) => {
      if (e.button === 2) return;
      if (e.target.closest("#closeWin, #pinWin")) return;
      dragStart = { x: e.clientX, y: e.clientY };
      dragStarted = false;
    });

    viewport.addEventListener("pointermove", async (e) => {
      if (!dragStart || dragStarted) return;

      const dx = Math.abs(e.clientX - dragStart.x);
      const dy = Math.abs(e.clientY - dragStart.y);

      if (dx > 4 || dy > 4) {
        dragStarted = true;
        dragStart = null;
        try {
          await tauriWindow.getCurrentWindow().startDragging();
        } catch (err) {
          console.error("startDragging error:", err);
        }
      }
    });

    viewport.addEventListener("pointerup", async (e) => {
      if (e.button === 0 && !dragStarted && !e.target.closest("#closeWin, #pinWin")) {
        await handleToggleCompact();
      }
      stopPointer();
    });

    viewport.addEventListener("contextmenu", handleViewportRightClick);
    viewport.addEventListener("pointercancel", stopPointer);
    viewport.addEventListener("pointerleave", stopPointer);
  }

  function bindButtons() {
    document.addEventListener("contextmenu", (e) => e.preventDefault());

    document.getElementById("closeWin")?.addEventListener("click", handleClose);
    document.getElementById("pinWin")?.addEventListener("click", handlePin);
  }

  async function init() {
    viewport = document.getElementById("scene");
    bindButtons();
    bindDrag();
    bindWindowControlsVisibility();
    await syncCompactModeFromWindow();
    applyViewportScale();
    await syncPinButton();
  }

  return {
    init,
    applyViewportScale,
  };
}
