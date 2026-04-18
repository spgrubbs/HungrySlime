// SlimeVenture — UI rendering, HUD, modals, floating text, log

import { state, $, COLS, LANES, levelTickLength } from "./state.js";
import { getHeldBonuses, effectiveMaxHp, renderInventory } from "./inventory.js";
import { ITEMS } from "./data.js";
import { SUBCLASSES } from "./subclass.js";

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
const scrapEl = $("scrap");
const manaEl = $("mana");
const abilityBtn = $("ability-btn");

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

function entityTooltip(ent) {
  if (ent.type === "enemy" || ent.type === "terminus") {
    const d = ent.def;
    let tip = `${d.name}\nHP: ${ent.hp}/${ent.maxHp}  ATK: ${d.attack || 0}`;
    if (d.gold) tip += `\nGold: ${d.gold}`;
    if (d.behavior === "chaser") tip += "\nChases you between lanes";
    if (d.behavior === "fleer") tip += `\nFlees after ${d.fleeTimer || 8} ticks`;
    if (d.behavior === "lane_switcher") tip += "\nSwitches lanes periodically";
    if (d.onDeath?.burn) tip += "\nBurns you on death";
    if (d.boss) tip += "\nBOSS";
    return tip;
  }
  if (ent.type === "item" && ent.def.itemKey) {
    const item = ITEMS[ent.def.itemKey];
    if (!item) return ent.def.emoji;
    let tip = `${item.name} [${item.rarity}]`;
    if (item.held) {
      const parts = [];
      if (item.held.attack) parts.push(`+${item.held.attack} ATK`);
      if (item.held.damageReduction) parts.push(`-${item.held.damageReduction} DMG`);
      if (item.held.maxHpBonus) parts.push(`+${item.held.maxHpBonus} HP`);
      if (item.held.regen) parts.push(`+${item.held.regen} regen/${item.held.regenInterval || 5}t`);
      if (parts.length) tip += `\nHeld: ${parts.join(", ")}`;
    }
    if (item.digest) {
      const parts = [];
      if (item.digest.heal) parts.push(`+${item.digest.heal} HP`);
      if (item.digest.gold) parts.push(`+${item.digest.gold} gold`);
      if (item.digest.buff) parts.push(item.digest.buff);
      if (item.digest.enemyDamage) parts.push(`${item.digest.enemyDamage} dmg`);
      if (item.digest.permMaxHp) parts.push(`+${item.digest.permMaxHp} max HP`);
      if (parts.length) tip += `\nDigest: ${parts.join(", ")} (${item.digestTime}t)`;
    }
    return tip;
  }
  if (ent.type === "obstacle") {
    return `${ent.def.name}\nDamage: ${ent.def.damage}${ent.def.blocking ? "\nBlocking" : ""}`;
  }
  if (ent.type === "location") {
    return ent.def.name;
  }
  return "";
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
    entEl.title = entityTooltip(ent);
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
  if (scrapEl) {
    scrapEl.textContent = `🔩 ${state.scrap || 0}`;
    scrapEl.classList.toggle("hidden", !state.scrap);
  }
  if (manaEl) {
    manaEl.textContent = `🔮 ${state.mana || 0}`;
    manaEl.classList.toggle("hidden", !state.mana);
  }
  lvlEl.textContent = `Lv ${state.level}`;

  // Ability button: show when subclass chosen, display cooldown
  if (abilityBtn) {
    if (state.subclass) {
      const def = SUBCLASSES[state.subclass];
      abilityBtn.classList.remove("hidden");
      if (state.abilityCooldown > 0) {
        abilityBtn.textContent = state.abilityCooldown;
        abilityBtn.classList.add("on-cooldown");
        abilityBtn.title = `${def.ability.name} (${state.abilityCooldown} ticks)`;
      } else {
        abilityBtn.textContent = def.ability.icon;
        abilityBtn.classList.remove("on-cooldown");
        abilityBtn.title = `${def.ability.name}: ${def.ability.desc}`;
      }
    } else {
      abilityBtn.classList.add("hidden");
    }
  }
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
