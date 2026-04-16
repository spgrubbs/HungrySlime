// SlimeVenture — UI rendering, HUD, modals, floating text, log

import { state, $, COLS, LANES, levelTickLength } from "./state.js";
import { getHeldBonuses, effectiveMaxHp, renderInventory } from "./inventory.js";

// ---------- DOM refs ----------
const laneGrid = $("lane-grid");
const slimeEl = $("slime");
const hpEl = $("hp");
const goldEl = $("gold");
const atkEl = $("atk");
const lvlEl = $("lvl");
const pauseBtn = $("pause-btn");
const modalEl = $("modal");
const modalTitle = $("modal-title");
const modalBody = $("modal-body");
const modalActions = $("modal-actions");
const logEl = $("log");
const progressFill = $("level-progress-fill");
const banner = $("path-banner");

// ---------- Banner / Log / Float ----------
export function showBanner(text, ms = 1400) {
  banner.textContent = text;
  banner.classList.add("show");
  setTimeout(() => banner.classList.remove("show"), ms);
}

export function pushLog(text) {
  const e = document.createElement("div");
  e.className = "log-entry";
  e.textContent = text;
  logEl.appendChild(e);
  setTimeout(() => e.remove(), 3100);
  // cap entries
  while (logEl.children.length > 5) logEl.firstChild.remove();
}

export function floatText(kind, text, targetEl) {
  const rect = targetEl.getBoundingClientRect();
  const gameRect = $("game").getBoundingClientRect();
  const el = document.createElement("div");
  el.className = `float ${kind}`;
  el.textContent = text;
  el.style.left = rect.left - gameRect.left + rect.width / 2 - 10 + "px";
  el.style.top = rect.top - gameRect.top + "px";
  $("game").appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ---------- Modal ----------
export function openModal({ title, body, bodyEl, actions }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  if (bodyEl) {
    modalBody.appendChild(bodyEl);
  } else if (body != null) {
    modalBody.textContent = body;
  }
  modalActions.innerHTML = "";
  for (const a of actions || []) {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    if (a.primary) btn.className = "primary";
    btn.addEventListener("click", a.onClick);
    modalActions.appendChild(btn);
  }
  modalEl.classList.remove("hidden");
}

export function closeModal() {
  modalEl.classList.add("hidden");
}

// ---------- Rendering ----------
export function renderAll() {
  renderPath();
  renderInventory();
  updateHUD();
  updateProgress();
}

export function renderPath() {
  // Clear and rebuild the cell grid
  laneGrid.innerHTML = "";
  for (let lane = 0; lane < LANES; lane++) {
    for (let col = 0; col < COLS; col++) {
      const cell = document.createElement("div");
      cell.className = "path-cell";
      cell.dataset.lane = lane;
      cell.dataset.col = col;
      laneGrid.appendChild(cell);
    }
  }
  // Place entities
  for (const ent of state.entities) {
    if (ent.col < 0 || ent.col >= COLS) continue;
    const cellIndex = ent.lane * COLS + ent.col;
    const cell = laneGrid.children[cellIndex];
    if (!cell) continue;
    const entEl = document.createElement("div");
    entEl.className = "entity";
    entEl.textContent = ent.def.emoji;
    cell.appendChild(entEl);
    if ((ent.type === "enemy" || ent.type === "terminus") && ent.maxHp > 0) {
      const bar = document.createElement("div");
      bar.className = "hp-bar";
      const fill = document.createElement("span");
      fill.style.width = (Math.max(0, ent.hp) / ent.maxHp) * 100 + "%";
      bar.appendChild(fill);
      cell.appendChild(bar);
    }
  }
  // Position slime
  const laneHeightPct = 100 / LANES;
  slimeEl.style.top = state.lane * laneHeightPct + "%";
}

export function updateHUD() {
  const b = getHeldBonuses();
  const shieldStr = state.shield > 0 ? ` +🛡${state.shield}` : "";
  hpEl.textContent = `❤️ ${state.hp}/${effectiveMaxHp()}${shieldStr}`;
  goldEl.textContent = `🪙 ${state.gold}`;
  atkEl.textContent = `⚔️ ${b.attack}`;
  lvlEl.textContent = `Lv ${state.level}`;
}

export function updateProgress() {
  const pct = Math.min(100, (state.levelTicks / levelTickLength()) * 100);
  progressFill.style.width = pct + "%";
}

export function updatePauseBtn() {
  if (state.paused) {
    pauseBtn.textContent = "▶";
    pauseBtn.classList.add("active");
  } else {
    pauseBtn.textContent = "⏸";
    pauseBtn.classList.remove("active");
  }
}
