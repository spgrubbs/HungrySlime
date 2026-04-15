// SlimeVenture MVP — main game module
// Implements: tick engine, 3-lane treadmill, inventory with held/stomach zones,
// digestion, bump combat, basic level loop with terminus, pause, growth, HUD.
// Touch-friendly: tap-to-select-then-tap-to-place for inventory management.

import {
  ITEMS,
  ITEM_POOL_BY_RARITY,
  ENEMIES,
  ENEMY_POOL_BY_LEVEL,
  TERMINI,
  OBSTACLES,
  LOCATIONS,
} from "./data.js";
import { initDevTools } from "./devtools.js";

// ---------- Config ----------
const COLS = 6;
const LANES = 3;
const SLIME_COL = 0; // slime is anchored at leftmost visible column
const BASE_TICK_MS = 1500;
const LEVEL_TICK_LENGTH = 42; // ticks before terminus spawns
const MAX_LEVEL = 5;

// ---------- State ----------
const state = {
  tick: 0,
  tickInterval: BASE_TICK_MS,
  paused: false,
  running: true,
  hp: 20,
  maxHp: 20,
  gold: 0,
  lane: 1,
  level: 1,
  levelTicks: 0,
  terminusSpawned: false,
  terminusDefeated: false,
  // Path entities: keyed by id, each has {id,type,def,lane,col,hp,maxHp}
  entities: [],
  // Inventory: flat arrays of slots; each slot is null or item instance
  heldSlots: [null, null, null, null], // 4 held slots
  stomachSlots: [null, null], // 2 stomach slots
  // Each item instance shape: {key, def, digestProgress}
  selected: null, // {zone: "held"|"stomach", index: number}
  buffs: {}, // name -> remaining ticks
  regenCounter: 0,
  growthLevel: 0, // number of times player has grown
  log: [],
};

// Dev tools state — toggled from the dev panel, consulted by combat/grow code.
const devState = {
  godMode: false,
  freeGrowth: false,
};

let entityIdSeq = 1;
let tickTimer = null;

function setTickIntervalMs(ms) {
  state.tickInterval = ms;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, ms);
}

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const path = $("path");
const laneGrid = $("lane-grid");
const slimeEl = $("slime");
const heldZoneEl = $("held-zone");
const stomachZoneEl = $("stomach-zone");
const hpEl = $("hp");
const goldEl = $("gold");
const atkEl = $("atk");
const lvlEl = $("lvl");
const pauseBtn = $("pause-btn");
const laneUpBtn = $("lane-up");
const laneDownBtn = $("lane-down");
const growBtn = $("grow-btn");
const discardBtn = $("discard-btn");
const modalEl = $("modal");
const modalTitle = $("modal-title");
const modalBody = $("modal-body");
const modalActions = $("modal-actions");
const logEl = $("log");
const progressFill = $("level-progress-fill");
const banner = $("path-banner");

// ---------- Utility ----------
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function showBanner(text, ms = 1400) {
  banner.textContent = text;
  banner.classList.add("show");
  setTimeout(() => banner.classList.remove("show"), ms);
}

function pushLog(text) {
  const e = document.createElement("div");
  e.className = "log-entry";
  e.textContent = text;
  logEl.appendChild(e);
  setTimeout(() => e.remove(), 3100);
  // cap entries
  while (logEl.children.length > 5) logEl.firstChild.remove();
}

function floatText(kind, text, targetEl) {
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

// ---------- Item instance helpers ----------
function makeItemInstance(key) {
  const def = ITEMS[key];
  if (!def) return null;
  return { key, def, digestProgress: 0 };
}

function randomItemKey(rarity = null) {
  if (!rarity) {
    // 80% common, 20% uncommon for basic drops
    rarity = Math.random() < 0.2 ? "uncommon" : "common";
  }
  const pool = ITEM_POOL_BY_RARITY[rarity] || ITEM_POOL_BY_RARITY.common;
  return pick(pool);
}

// ---------- Inventory ----------
function firstEmpty(slots) {
  return slots.findIndex((s) => s === null);
}

function tryPickupItem(key) {
  // First try held zone, overflow to stomach
  let idx = firstEmpty(state.heldSlots);
  if (idx >= 0) {
    state.heldSlots[idx] = makeItemInstance(key);
    pushLog(`Picked up ${ITEMS[key].name}`);
    return true;
  }
  idx = firstEmpty(state.stomachSlots);
  if (idx >= 0) {
    state.stomachSlots[idx] = makeItemInstance(key);
    pushLog(`${ITEMS[key].name} → stomach (overflow)`);
    return true;
  }
  pushLog(`${ITEMS[key].name} lost (full)`);
  return false;
}

function getHeldBonuses() {
  let attack = 1;
  let damageReduction = 0;
  let maxHpBonus = 0;
  let regen = 0;
  let regenInterval = 5;
  for (const slot of state.heldSlots) {
    if (!slot || !slot.def.held) continue;
    const h = slot.def.held;
    if (h.attack) attack += h.attack;
    if (h.damageReduction) damageReduction += h.damageReduction;
    if (h.maxHpBonus) maxHpBonus += h.maxHpBonus;
    if (h.regen) {
      regen += h.regen;
      if (h.regenInterval) regenInterval = h.regenInterval;
    }
  }
  // Buffs
  if (state.buffs.burn_aura) attack += 1;
  return { attack, damageReduction, maxHpBonus, regen, regenInterval };
}

function applyDigest(item) {
  const d = item.def.digest || {};
  if (d.heal) {
    state.hp = Math.min(effectiveMaxHp(), state.hp + d.heal);
    pushLog(`Digested ${item.def.name}: +${d.heal} HP`);
    floatText("heal", `+${d.heal}`, slimeEl);
  }
  if (d.gold) {
    state.gold += d.gold;
    pushLog(`Digested ${item.def.name}: +${d.gold} 🪙`);
    floatText("gold", `+${d.gold}`, slimeEl);
  }
  if (d.permMaxHp) {
    state.maxHp += d.permMaxHp;
    state.hp += d.permMaxHp;
    pushLog(`+${d.permMaxHp} max HP permanently!`);
  }
  if (d.buff) {
    state.buffs[d.buff] = 10;
    pushLog(`Gained buff: ${d.buff}`);
  }
  if (d.enemyDamage) {
    const target = state.entities.find(
      (e) =>
        (e.type === "enemy" || e.type === "terminus") &&
        e.lane === state.lane &&
        e.col === SLIME_COL + 1 // enemy bumping into slime
    );
    if (target) {
      target.hp -= d.enemyDamage;
      pushLog(`Bomb hits ${target.def.name} for ${d.enemyDamage}!`);
    } else {
      pushLog("Bomb fizzles — no target");
    }
  }
}

function effectiveMaxHp() {
  const { maxHpBonus } = getHeldBonuses();
  return state.maxHp + maxHpBonus;
}

// ---------- Path / entities ----------
function spawnEntity(def, type, lane, col) {
  const ent = {
    id: entityIdSeq++,
    type,
    def,
    lane,
    col,
    hp: def.hp || 0,
    maxHp: def.hp || 0,
  };
  state.entities.push(ent);
  return ent;
}

function removeEntity(ent) {
  const idx = state.entities.indexOf(ent);
  if (idx >= 0) state.entities.splice(idx, 1);
}

function spawnRandomPathEntity() {
  // Pick a random lane and an entity type based on level
  const lane = rand(LANES);
  const col = COLS - 1;

  // Don't spawn on top of another entity in same lane/col
  if (state.entities.some((e) => e.lane === lane && e.col === col)) return;

  const roll = Math.random();
  if (roll < 0.5) {
    // Enemy
    const pool = ENEMY_POOL_BY_LEVEL[state.level] || ENEMY_POOL_BY_LEVEL[1];
    const enemyKey = pick(pool);
    spawnEntity(ENEMIES[enemyKey], "enemy", lane, col);
  } else if (roll < 0.78) {
    // Item pickup
    const itemKey = randomItemKey();
    spawnEntity(
      { id: itemKey, emoji: ITEMS[itemKey].emoji, itemKey },
      "item",
      lane,
      col
    );
  } else if (roll < 0.92) {
    // Obstacle
    const obs = Math.random() < 0.7 ? OBSTACLES.rock : OBSTACLES.spikes;
    spawnEntity(obs, "obstacle", lane, col);
  } else {
    // Location: fountain for MVP
    spawnEntity(LOCATIONS.fountain, "location", lane, col);
  }
}

function spawnTerminus() {
  const def = TERMINI[state.level] || TERMINI[1];
  // Spawn in the middle lane
  spawnEntity(def, "terminus", 1, COLS - 1);
  state.terminusSpawned = true;
  showBanner(`⚠ ${def.name} approaches!`, 2000);
  pushLog(`Terminus: ${def.name}`);
}

// ---------- Tick logic ----------
function tick() {
  if (!state.running || state.paused) return;
  state.tick++;
  state.levelTicks++;

  // 1. Apply passive regen from held items
  const bonuses = getHeldBonuses();
  state.regenCounter++;
  if (bonuses.regen > 0 && state.regenCounter >= bonuses.regenInterval) {
    state.regenCounter = 0;
    if (state.hp < effectiveMaxHp()) {
      state.hp = Math.min(effectiveMaxHp(), state.hp + bonuses.regen);
      floatText("heal", `+${bonuses.regen}`, slimeEl);
    }
  }

  // 2. Tick active buffs
  for (const [name, ticks] of Object.entries(state.buffs)) {
    state.buffs[name] = ticks - 1;
    if (state.buffs[name] <= 0) delete state.buffs[name];
  }

  // 3. Advance digestion for stomach items
  for (let i = 0; i < state.stomachSlots.length; i++) {
    const item = state.stomachSlots[i];
    if (!item) continue;
    item.digestProgress++;
    if (item.digestProgress >= item.def.digestTime) {
      applyDigest(item);
      state.stomachSlots[i] = null;
    }
  }

  // 4. Move entities. Entities stop at slime's column + 1 if slime is in their lane
  //    (they get "stuck" bumping the slime). Enemies deal damage when adjacent.
  //    Combat: when enemy.col == SLIME_COL && same lane, combat each tick.
  //    Simpler rule: an entity can't move onto the slime's cell. It stops at col 1
  //    if slime is in its lane, then on next tick when slime occupies, bump combat.
  // For MVP, treat the slime's cell itself as the combat cell.

  // Sort entities by col ascending so leftmost moves first (no collisions)
  const sorted = [...state.entities].sort((a, b) => a.col - b.col);
  for (const ent of sorted) {
    // Speed: some enemies act every 2 ticks
    const speed = ent.def.speed || 1;
    if (speed > 1 && state.tick % speed !== 0) continue;

    // Slow enemies don't move on alternate ticks (already skipped above)
    const nextCol = ent.col - 1;

    if (nextCol < 0) {
      // Despawned off the left edge
      if (ent.type === "enemy" || ent.type === "terminus") {
        // Shouldn't happen — enemies bump combat first
      }
      removeEntity(ent);
      continue;
    }

    // Would the move land on the slime's cell (combat trigger)?
    if (nextCol === SLIME_COL && ent.lane === state.lane) {
      // Trigger encounter based on type
      handleEncounter(ent);
      continue;
    }

    // Would it land on another entity? Skip move.
    if (state.entities.some((e) => e !== ent && e.lane === ent.lane && e.col === nextCol)) {
      continue;
    }

    ent.col = nextCol;

    // Slime not in this lane: entities in col 0 just despawn next tick
  }

  // 5. Combat continues for enemies still sharing slime's cell (multi-tick combat)
  //    (handled inside handleEncounter for newly arrived, but we also need
  //    ongoing bump combat for enemies already adjacent.)
  const stuckEnemies = state.entities.filter(
    (e) =>
      (e.type === "enemy" || e.type === "terminus") &&
      e.lane === state.lane &&
      e.col === SLIME_COL
  );
  for (const enemy of stuckEnemies) {
    resolveCombatRound(enemy);
    if (state.hp <= 0 || !state.running) break;
  }

  // 6. Despawn any entities that slipped past (col < 0)
  state.entities = state.entities.filter((e) => e.col >= 0);

  // 7. Level progression — spawn things
  if (state.levelTicks < LEVEL_TICK_LENGTH && !state.terminusSpawned) {
    // Normal spawning
    if (state.levelTicks % 2 === 0) spawnRandomPathEntity();
  } else if (!state.terminusSpawned && state.levelTicks >= LEVEL_TICK_LENGTH) {
    // Time for the terminus. Make sure the lane is clear.
    spawnTerminus();
  }

  // 8. Check terminus cleared
  if (state.terminusSpawned) {
    const terminus = state.entities.find((e) => e.type === "terminus");
    if (!terminus) {
      state.terminusDefeated = true;
      onLevelComplete();
      return;
    }
  }

  // 9. Check death
  if (state.hp <= 0) {
    state.hp = 0;
    onDeath();
    return;
  }

  // 10. Render
  renderAll();
}

// ---------- Encounters ----------
function handleEncounter(ent) {
  if (ent.type === "enemy" || ent.type === "terminus") {
    // Move onto slime cell; combat is resolved in the stuckEnemies loop below
    // so that newly-arrived and already-adjacent enemies get exactly one round.
    ent.col = SLIME_COL;
  } else if (ent.type === "item") {
    tryPickupItem(ent.def.itemKey);
    removeEntity(ent);
  } else if (ent.type === "obstacle") {
    const rawDmg = Math.max(0, ent.def.damage - getHeldBonuses().damageReduction);
    const dmg = devState.godMode ? 0 : rawDmg;
    state.hp -= dmg;
    pushLog(`${ent.def.name} hits you for ${dmg}`);
    if (dmg > 0) floatText("dmg", `-${dmg}`, slimeEl);
    removeEntity(ent);
  } else if (ent.type === "location") {
    // Move onto location and open modal
    ent.col = SLIME_COL;
    openLocation(ent);
  }
}

function resolveCombatRound(enemy) {
  const bonuses = getHeldBonuses();
  // Slime hits enemy
  const slimeDmg = bonuses.attack;
  enemy.hp -= slimeDmg;
  floatText("dmg", `-${slimeDmg}`, slimeEl);

  if (enemy.hp <= 0) {
    // Loot
    const goldDrop = enemy.def.gold || 0;
    state.gold += goldDrop;
    pushLog(`Defeated ${enemy.def.name} (+${goldDrop}🪙)`);
    if (enemy.def.dropChance && enemy.def.dropPool && Math.random() < enemy.def.dropChance) {
      const key = pick(enemy.def.dropPool);
      tryPickupItem(key);
    }
    removeEntity(enemy);
    return;
  }

  // Enemy hits slime
  const rawDmg = enemy.def.attack || 0;
  const dmg = devState.godMode
    ? 0
    : Math.max(0, rawDmg - bonuses.damageReduction);
  state.hp -= dmg;
  if (dmg > 0) floatText("dmg", `-${dmg}`, slimeEl);
}

// ---------- Locations ----------
function openLocation(ent) {
  state.paused = true;
  updatePauseBtn();
  const loc = ent.def;
  if (loc.id === "fountain") {
    const heal = Math.min(effectiveMaxHp() - state.hp, 10 + state.level * 2);
    openModal({
      title: "⛲ Fountain",
      body: `A shimmering pool. Drink to heal ${heal} HP.`,
      actions: [
        {
          label: `Drink (+${heal} HP)`,
          primary: true,
          onClick: () => {
            state.hp += heal;
            pushLog(`Fountain: +${heal} HP`);
            removeEntity(ent);
            closeModal();
            state.paused = false;
            updatePauseBtn();
            renderAll();
          },
        },
        {
          label: "Leave",
          onClick: () => {
            removeEntity(ent);
            closeModal();
            state.paused = false;
            updatePauseBtn();
            renderAll();
          },
        },
      ],
    });
  } else if (loc.id === "shop") {
    openModal({
      title: "🏪 Shop",
      body: "Shops coming soon. (MVP stub)",
      actions: [
        {
          label: "Continue",
          primary: true,
          onClick: () => {
            removeEntity(ent);
            closeModal();
            state.paused = false;
            updatePauseBtn();
            renderAll();
          },
        },
      ],
    });
  }
}

// ---------- Level / run flow ----------
function onLevelComplete() {
  state.paused = true;
  updatePauseBtn();
  if (state.level >= MAX_LEVEL) {
    openModal({
      title: "🏆 Run Complete!",
      body: `You defeated the Gelatinous King!\n\nGold: ${state.gold} · HP: ${state.hp}/${effectiveMaxHp()}\n\nThe MVP ends here. Future: meta-progression & more levels.`,
      actions: [
        {
          label: "New Run",
          primary: true,
          onClick: () => {
            closeModal();
            restartRun();
          },
        },
      ],
    });
    return;
  }
  openModal({
    title: `Level ${state.level} cleared!`,
    body: `HP: ${state.hp}/${effectiveMaxHp()} · Gold: ${state.gold}\n\nThe path ahead branches, but for the MVP you simply advance.`,
    actions: [
      {
        label: `Advance to Level ${state.level + 1}`,
        primary: true,
        onClick: () => {
          state.level++;
          state.levelTicks = 0;
          state.terminusSpawned = false;
          state.terminusDefeated = false;
          state.entities = [];
          closeModal();
          state.paused = false;
          updatePauseBtn();
          showBanner(`— Level ${state.level} —`);
          renderAll();
        },
      },
    ],
  });
}

function onDeath() {
  state.running = false;
  openModal({
    title: "💀 You died",
    body: `You reached Level ${state.level}.\nGold collected: ${state.gold}\nTicks survived: ${state.tick}`,
    actions: [
      {
        label: "Try Again",
        primary: true,
        onClick: () => {
          closeModal();
          restartRun();
        },
      },
    ],
  });
}

function restartRun() {
  state.tick = 0;
  // Note: state.tickInterval is intentionally NOT reset so dev-tool speed
  // settings persist across run resets during testing.
  state.paused = false;
  state.running = true;
  state.hp = 20;
  state.maxHp = 20;
  state.gold = 0;
  state.lane = 1;
  state.level = 1;
  state.levelTicks = 0;
  state.terminusSpawned = false;
  state.terminusDefeated = false;
  state.entities = [];
  state.heldSlots = [null, null, null, null];
  state.stomachSlots = [null, null];
  state.selected = null;
  state.buffs = {};
  state.regenCounter = 0;
  state.growthLevel = 0;
  updatePauseBtn();
  renderAll();
  showBanner("— Level 1 —");
}

// ---------- Inventory interactions (tap-to-select-then-place) ----------
function onSlotClick(zone, index) {
  const slots = zone === "held" ? state.heldSlots : state.stomachSlots;

  if (!state.selected) {
    // Need an item to select
    if (slots[index]) {
      state.selected = { zone, index };
    }
  } else {
    // Place/swap from selected to this slot
    const src = state.selected;
    const srcSlots =
      src.zone === "held" ? state.heldSlots : state.stomachSlots;
    const dstSlots = slots;
    if (src.zone === zone && src.index === index) {
      // Deselect
      state.selected = null;
    } else {
      const tmp = dstSlots[index];
      dstSlots[index] = srcSlots[src.index];
      srcSlots[src.index] = tmp;
      // If moved INTO stomach from held, digestion progress restarts
      if (zone === "stomach" && dstSlots[index]) {
        dstSlots[index].digestProgress = 0;
      }
      state.selected = null;
    }
  }
  renderInventory();
  updateHUD();
}

function discardSelected() {
  if (!state.selected) return;
  const slots =
    state.selected.zone === "held" ? state.heldSlots : state.stomachSlots;
  const item = slots[state.selected.index];
  if (item) pushLog(`Discarded ${item.def.name}`);
  slots[state.selected.index] = null;
  state.selected = null;
  renderInventory();
  updateHUD();
}

function growSlime() {
  const cost = devState.freeGrowth ? 0 : 10 + state.growthLevel * 5;
  if (state.gold < cost) {
    pushLog(`Need ${cost}🪙 to grow`);
    return;
  }
  if (state.heldSlots.length + state.stomachSlots.length >= 24) {
    pushLog("Max size reached");
    return;
  }
  state.paused = true;
  updatePauseBtn();
  openModal({
    title: "🧪 Grow",
    body: `Spend ${cost}🪙 to add one cell. Choose where:`,
    actions: [
      {
        label: "+1 Held cell",
        primary: true,
        onClick: () => {
          state.gold -= cost;
          state.heldSlots.push(null);
          state.growthLevel++;
          closeModal();
          state.paused = false;
          updatePauseBtn();
          renderAll();
        },
      },
      {
        label: "+1 Stomach cell",
        onClick: () => {
          state.gold -= cost;
          state.stomachSlots.push(null);
          state.growthLevel++;
          closeModal();
          state.paused = false;
          updatePauseBtn();
          renderAll();
        },
      },
      {
        label: "Cancel",
        onClick: () => {
          closeModal();
          state.paused = false;
          updatePauseBtn();
        },
      },
    ],
  });
}

// ---------- Modal ----------
function openModal({ title, body, actions }) {
  modalTitle.textContent = title;
  modalBody.textContent = body;
  modalActions.innerHTML = "";
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    if (a.primary) btn.className = "primary";
    btn.addEventListener("click", a.onClick);
    modalActions.appendChild(btn);
  }
  modalEl.classList.remove("hidden");
}

function closeModal() {
  modalEl.classList.add("hidden");
}

// ---------- Rendering ----------
function renderAll() {
  renderPath();
  renderInventory();
  updateHUD();
  updateProgress();
}

function renderPath() {
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

function renderInventory() {
  renderZone(heldZoneEl, state.heldSlots, "held");
  renderZone(stomachZoneEl, state.stomachSlots, "stomach");
  discardBtn.disabled = !state.selected;
  const cost = devState.freeGrowth ? 0 : 10 + state.growthLevel * 5;
  growBtn.textContent = `🧪 Grow (${cost}🪙)`;
  growBtn.disabled = state.gold < cost;
}

function renderZone(zoneEl, slots, zone) {
  zoneEl.innerHTML = "";
  slots.forEach((item, idx) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    if (!item) slot.classList.add("empty");
    if (
      state.selected &&
      state.selected.zone === zone &&
      state.selected.index === idx
    )
      slot.classList.add("selected");
    if (state.selected && !item) slot.classList.add("valid-target");

    if (item) {
      slot.textContent = item.def.emoji;
      const r = document.createElement("span");
      r.className = `rarity ${item.def.rarity}`;
      r.textContent = item.def.rarity.charAt(0).toUpperCase();
      slot.appendChild(r);

      if (zone === "stomach") {
        const ring = document.createElement("div");
        ring.className = "digest-ring";
        const pct = Math.min(100, (item.digestProgress / item.def.digestTime) * 100);
        ring.style.background = `conic-gradient(#9f6 ${pct}%, transparent ${pct}%)`;
        slot.appendChild(ring);
      }
      slot.title = `${item.def.name}\n${item.def.flavor}`;
    }
    slot.addEventListener("click", () => onSlotClick(zone, idx));
    zoneEl.appendChild(slot);
  });
}

function updateHUD() {
  const b = getHeldBonuses();
  hpEl.textContent = `❤️ ${state.hp}/${effectiveMaxHp()}`;
  goldEl.textContent = `🪙 ${state.gold}`;
  atkEl.textContent = `⚔️ ${b.attack}`;
  lvlEl.textContent = `Lv ${state.level}`;
}

function updateProgress() {
  const pct = Math.min(
    100,
    (state.levelTicks / LEVEL_TICK_LENGTH) * 100
  );
  progressFill.style.width = pct + "%";
}

function updatePauseBtn() {
  if (state.paused) {
    pauseBtn.textContent = "▶";
    pauseBtn.classList.add("active");
  } else {
    pauseBtn.textContent = "⏸";
    pauseBtn.classList.remove("active");
  }
}

// ---------- Input ----------
function onLaneUp() {
  state.lane = clamp(state.lane - 1, 0, LANES - 1);
  renderPath();
}
function onLaneDown() {
  state.lane = clamp(state.lane + 1, 0, LANES - 1);
  renderPath();
}
function onPause() {
  if (!state.running) return;
  state.paused = !state.paused;
  updatePauseBtn();
}

function hookInput() {
  laneUpBtn.addEventListener("click", onLaneUp);
  laneDownBtn.addEventListener("click", onLaneDown);
  pauseBtn.addEventListener("click", onPause);
  growBtn.addEventListener("click", growSlime);
  discardBtn.addEventListener("click", discardSelected);

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "w") onLaneUp();
    else if (e.key === "ArrowDown" || e.key === "s") onLaneDown();
    else if (e.key === " " || e.key === "p") {
      e.preventDefault();
      onPause();
    }
  });
}

// ---------- Boot ----------
function start() {
  hookInput();
  renderAll();
  showBanner("— Level 1 —");
  setTickIntervalMs(state.tickInterval);
  initDevTools({
    state,
    devState,
    setTickIntervalMs,
    tick,
    renderAll,
    effectiveMaxHp,
    restartRun,
    spawnEntity,
    tryPickupItem,
    updatePauseBtn,
    showBanner,
    onLevelComplete,
    spawnTerminus,
    COLS,
    LEVEL_TICK_LENGTH,
    MAX_LEVEL,
    BASE_TICK_MS,
  });
}

start();
