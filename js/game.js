// SlimeVenture — main game module
// Scenes: hub → run → overworld → event → run → ... → run-end
// Implements tick engine, 3-lane treadmill, inventory, digestion, combat,
// branching overworld map, text events, mutations, meta progression hub.
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
import { generateRunMap, renderMapSVG, NODE_TYPES } from "./map.js";
import {
  UPGRADES,
  TIER_THRESHOLDS,
  loadMeta,
  saveMeta,
  resetMeta,
  calculateRunXp,
  grantXp,
  tierUnlocked,
  canPurchase,
  purchase,
  computeRunModifiers,
} from "./meta.js";
import { EVENTS, rollEvent } from "./events.js";
import {
  MUTATIONS,
  STOMACH_KINDS,
  rollMutationChoices,
  getMutationBonuses,
} from "./mutations.js";

// ---------- Config ----------
const COLS = 6;
const LANES = 3;
const SLIME_COL = 0; // slime is anchored at leftmost visible column
const BASE_TICK_MS = 1500;
const DEFAULT_LEVEL_TICK_LENGTH = 42; // fallback when a node has no tickLength
const MAX_LEVEL = 5;

// ---------- State ----------
const state = {
  // "hub" | "run" | "overworld" | "event"
  scene: "hub",
  tick: 0,
  tickInterval: BASE_TICK_MS,
  paused: false,
  running: false,
  hp: 20,
  maxHp: 20,
  gold: 0,
  lane: 1,
  level: 1,
  levelTicks: 0,
  terminusSpawned: false,
  terminusDefeated: false,
  // Run map (Slay-the-Spire style branching grid). Generated when starting a run.
  map: null,
  mapNode: { row: 0, col: 0 },
  // Path entities: keyed by id, each has {id,type,def,lane,col,hp,maxHp}
  entities: [],
  // Inventory: a single flat array of cells. Each cell has a stomach kind
  // (see STOMACH_KINDS) and may hold one item instance.
  // Items enter at index 0 and cascade toward the end as new items push them.
  // Cell shape: { kind: "none"|"digest"|"fast"|"acid"|"holding", item: instance|null }
  // Item instance shape: { key, def, digestProgress }
  inventory: [],
  // selected = { index: number } when something is picked up. arrangeMode
  // toggles whether the next click swaps items or swaps entire cells.
  selected: null,
  arrangeMode: false,
  buffs: {}, // name -> remaining ticks
  regenCounter: 0,
  passiveCounter: 0, // separate counter for mutation passive regen
  growthLevel: 0, // number of times player has grown
  log: [],
  // Mutations earned this run (powerful relic-like passives, no inv slot).
  mutations: [],
  // Per-run counters, used for XP calculation at run end.
  runStats: {
    levelsCompleted: 0,
    enemiesDefeated: 0,
    goldEarned: 0,
    itemsDigested: 0,
    bossDefeated: false,
  },
  // Meta save (loaded in start, persisted on XP grant / purchase).
  meta: null,
  // Modifier accumulator derived from state.meta.unlocks, recomputed at the
  // start of every run.
  runMods: null,
  // Cached mutation-bonus accumulator, refreshed when mutations change.
  mutBonuses: null,
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

function currentMapNode() {
  if (!state.map) return null;
  const { row, col } = state.mapNode;
  return state.map[row] && state.map[row][col];
}

function currentNodeConfig() {
  const node = currentMapNode();
  return (node && NODE_TYPES[node.type]) || NODE_TYPES.combat;
}

function levelTickLength() {
  return currentNodeConfig().tickLength || DEFAULT_LEVEL_TICK_LENGTH;
}

// ---------- Scene management ----------
// Switching the visible top-of-screen view is just a class swap on #game.
// Tick loop only advances when scene === "run" (and not paused).
function setScene(name) {
  state.scene = name;
  const gameEl = document.getElementById("game");
  gameEl.classList.remove(
    "scene-hub",
    "scene-run",
    "scene-overworld",
    "scene-event"
  );
  gameEl.classList.add(`scene-${name}`);
}

function refreshMutationBonuses() {
  state.mutBonuses = getMutationBonuses(state.mutations);
}

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const path = $("path");
const laneGrid = $("lane-grid");
const slimeEl = $("slime");
const inventoryZoneEl = $("inventory-zone");
const arrangeBtn = $("arrange-btn");
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
const overworldMapEl = $("overworld-map");
const overworldStatusEl = $("overworld-status");
const eventTitleEl = $("event-title");
const eventTextEl = $("event-text");
const eventChoicesEl = $("event-choices");
const eventResultEl = $("event-result");
const eventContinueBtn = $("event-continue");
const mutationStripEl = $("mutation-strip");
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
// Build a fresh inventory of `size` cells. The last cell is a default
// digestive sac; all earlier cells are inert. Used at run start.
function makeFreshInventory(size) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push({ kind: "none", item: null });
  }
  if (cells.length > 0) {
    cells[cells.length - 1].kind = "digest";
  }
  return cells;
}

// Insert an item instance into the inventory. Cascade-pushes existing items
// forward, bypassing occupied "holding" cells (their items don't get pushed).
// Returns true if the item found a home, false if everything was full and it
// fell out the back.
function pushIntoInventory(itemInstance) {
  let cur = itemInstance;
  for (let i = 0; i < state.inventory.length && cur; i++) {
    const cell = state.inventory[i];
    const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
    // Holding cells with an item already present are transparent — skip them
    // entirely so the moving item passes by.
    if (kindCfg.holds && cell.item) continue;
    if (!cell.item) {
      cell.item = cur;
      // Reset digest progress on entry so partial digestion doesn't leak in.
      cur.digestProgress = 0;
      cur = null;
    } else {
      // Swap: place new item, displace existing into `cur` to keep cascading.
      const prev = cell.item;
      cell.item = cur;
      cur.digestProgress = 0;
      cur = prev;
    }
  }
  return cur === null;
}

function tryPickupItem(key) {
  const inst = makeItemInstance(key);
  if (!inst) return false;
  if (pushIntoInventory(inst)) {
    pushLog(`Picked up ${ITEMS[key].name}`);
    return true;
  }
  pushLog(`${ITEMS[key].name} lost (full)`);
  return false;
}

// Iterate the inventory and collect "held" bonuses. Only items in cells with
// a holding-kind stomach are considered; items in inert/digesting cells are
// inert too (they're just in transit).
function getHeldBonuses() {
  let attack = 1;
  let damageReduction = 0;
  let maxHpBonus = 0;
  let regen = 0;
  let regenInterval = 5;
  for (const cell of state.inventory) {
    if (!cell.item || !cell.item.def.held) continue;
    const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
    if (!kindCfg.holds) continue;
    const h = cell.item.def.held;
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

// Centralised positive-gold source so run-stats stay accurate.
function addGold(amount) {
  if (!amount || amount <= 0) return;
  state.gold += amount;
  state.runStats.goldEarned += amount;
}

function applyDigest(item, yieldMult = 1) {
  const d = item.def.digest || {};
  state.runStats.itemsDigested++;
  // Hungry Void mutation: every digestion heals a flat amount.
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  if (mut.digestHeal > 0 && state.hp < effectiveMaxHp()) {
    state.hp = Math.min(effectiveMaxHp(), state.hp + mut.digestHeal);
    floatText("heal", `+${mut.digestHeal}`, slimeEl);
  }
  // Numeric yields scale with the cell's yieldMult (acid sac etc).
  const scaledHeal = Math.round((d.heal || 0) * yieldMult);
  const scaledGold = Math.round((d.gold || 0) * yieldMult);
  if (scaledHeal > 0) {
    state.hp = Math.min(effectiveMaxHp(), state.hp + scaledHeal);
    pushLog(`Digested ${item.def.name}: +${scaledHeal} HP`);
    floatText("heal", `+${scaledHeal}`, slimeEl);
  }
  if (scaledGold > 0) {
    addGold(scaledGold);
    pushLog(`Digested ${item.def.name}: +${scaledGold} 🪙`);
    floatText("gold", `+${scaledGold}`, slimeEl);
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
    // Enemies now stop one column to the right of the slime, so the bomb
    // looks one cell ahead instead of on top of the slime.
    const target = state.entities.find(
      (e) =>
        (e.type === "enemy" || e.type === "terminus") &&
        e.lane === state.lane &&
        e.col === SLIME_COL + 1
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
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  return state.maxHp + maxHpBonus + (mut.maxHpBonus || 0);
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
  // Spawn distribution is driven by the current map node's type.
  const lane = rand(LANES);
  const col = COLS - 1;

  // Don't spawn on top of another entity in same lane/col
  if (state.entities.some((e) => e.lane === lane && e.col === col)) return;

  const w = currentNodeConfig().spawnWeights;
  const total = w.enemy + w.item + w.obstacle + w.location;
  let roll = Math.random() * total;

  if ((roll -= w.enemy) < 0) {
    const pool = ENEMY_POOL_BY_LEVEL[state.level] || ENEMY_POOL_BY_LEVEL[1];
    const enemyKey = pick(pool);
    spawnEntity(ENEMIES[enemyKey], "enemy", lane, col);
  } else if ((roll -= w.item) < 0) {
    const itemKey = randomItemKey();
    spawnEntity(
      { id: itemKey, emoji: ITEMS[itemKey].emoji, itemKey },
      "item",
      lane,
      col
    );
  } else if ((roll -= w.obstacle) < 0) {
    // 60% rock, 25% spikes, 15% boulder.
    const r = Math.random();
    let obs;
    if (r < 0.6) obs = OBSTACLES.rock;
    else if (r < 0.85) obs = OBSTACLES.spikes;
    else obs = OBSTACLES.boulder;
    spawnEntity(obs, "obstacle", lane, col);
  } else {
    spawnEntity(LOCATIONS.fountain, "location", lane, col);
  }
}

function spawnTerminus() {
  const baseDef = TERMINI[state.level] || TERMINI[1];
  const cfg = currentNodeConfig();
  // Elite nodes buff the level's terminus.
  let def = baseDef;
  if (cfg.terminusHpMult || cfg.terminusAtkBonus || cfg.terminusGoldMult) {
    def = {
      ...baseDef,
      name: `Elite ${baseDef.name}`,
      hp: Math.round(baseDef.hp * (cfg.terminusHpMult || 1)),
      attack: (baseDef.attack || 0) + (cfg.terminusAtkBonus || 0),
      gold: Math.round((baseDef.gold || 0) * (cfg.terminusGoldMult || 1)),
    };
  }
  // Spawn in the middle lane
  spawnEntity(def, "terminus", 1, COLS - 1);
  state.terminusSpawned = true;
  showBanner(`⚠ ${def.name} approaches!`, 2000);
  pushLog(`Terminus: ${def.name}`);
}

// ---------- Tick logic ----------
function tick() {
  // Tick only advances during a live run. Hub/overworld/event scenes are inert.
  if (state.scene !== "run" || !state.running || state.paused) return;
  state.tick++;
  state.levelTicks++;

  const mut = state.mutBonuses || getMutationBonuses(state.mutations);

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

  // 1b. Mutation passive regen (Pulsing Core).
  if (mut.passiveRegen > 0 && mut.passiveRegenInterval > 0) {
    state.passiveCounter++;
    if (state.passiveCounter >= mut.passiveRegenInterval) {
      state.passiveCounter = 0;
      if (state.hp < effectiveMaxHp()) {
        state.hp = Math.min(effectiveMaxHp(), state.hp + mut.passiveRegen);
        floatText("heal", `+${mut.passiveRegen}`, slimeEl);
      }
    }
  }

  // 2. Tick active buffs
  for (const [name, ticks] of Object.entries(state.buffs)) {
    state.buffs[name] = ticks - 1;
    if (state.buffs[name] <= 0) delete state.buffs[name];
  }

  // 3. Advance digestion across the unified inventory. Only cells whose kind
  //    has digests=true tick down their item's digestion timer; inert/holding
  //    cells leave their items alone. Each cell's speedMult and yieldMult come
  //    from STOMACH_KINDS and stack with global modifiers.
  const baseDigestStep =
    (state.runMods?.digestSpeedMult || 1) * (mut.digestSpeedMult || 1);
  for (let i = 0; i < state.inventory.length; i++) {
    const cell = state.inventory[i];
    if (!cell.item) continue;
    const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
    if (!kindCfg.digests) continue;
    cell.item.digestProgress += baseDigestStep * (kindCfg.speedMult || 1);
    if (cell.item.digestProgress >= cell.item.def.digestTime) {
      applyDigest(cell.item, kindCfg.yieldMult || 1);
      cell.item = null;
    }
  }

  // 4. Move entities. Movement is one column to the left per tick (some enemies
  //    are slowed). Special collision rules:
  //    - Enemies and "blocking" obstacles (boulders) refuse to enter the slime's
  //      cell when the slime is in their lane: they stop one column away and
  //      keep attacking / barricading from there. Items can pile up behind them.
  //    - Items / locations / regular obstacles trigger interaction the moment
  //      they slide onto the slime's cell.
  //    - When two entities collide mid-path, items/obstacles sliding into a
  //      stuck enemy interact with it (obstacles damage, fountains heal),
  //      otherwise the moving entity just stalls a tick.

  // Sort entities by col ascending so the leftmost moves first to avoid races.
  const sorted = [...state.entities].sort((a, b) => a.col - b.col);
  for (const ent of sorted) {
    // Speed: some enemies act every N ticks
    const speed = ent.def.speed || 1;
    if (speed > 1 && state.tick % speed !== 0) continue;

    const nextCol = ent.col - 1;

    if (nextCol < 0) {
      // Despawned off the left edge
      removeEntity(ent);
      continue;
    }

    // Slime in the way? (next col is slime cell in slime's lane)
    if (nextCol === SLIME_COL && ent.lane === state.lane) {
      const isBlocker =
        ent.type === "enemy" ||
        ent.type === "terminus" ||
        (ent.type === "obstacle" && ent.def.blocking);
      if (isBlocker) {
        // Refuse to advance; stay at current col bumping the slime.
        continue;
      }
      // Items / locations / non-blocking obstacles slide onto the slime cell
      // and interact immediately.
      handleEncounter(ent);
      continue;
    }

    // Another entity already in nextCol?
    const blocker = state.entities.find(
      (e) => e !== ent && e.lane === ent.lane && e.col === nextCol
    );
    if (blocker) {
      handleSlideInteraction(ent, blocker);
      continue;
    }

    ent.col = nextCol;
  }

  // 4b. Magnetic Body / Magnetic Membrane: vacuum items from adjacent lanes.
  if (state.runMods?.magneticBody || mut.magneticBody) {
    const magnetTargets = state.entities.filter(
      (e) =>
        e.type === "item" &&
        e.col === SLIME_COL &&
        Math.abs(e.lane - state.lane) === 1
    );
    for (const ent of magnetTargets) {
      tryPickupItem(ent.def.itemKey);
      removeEntity(ent);
    }
  }

  // 5. Combat happens for any enemy adjacent to the slime (one cell ahead in
  //    the slime's lane). Enemies that survive remain there next tick.
  const adjacentEnemies = state.entities.filter(
    (e) =>
      (e.type === "enemy" || e.type === "terminus") &&
      e.lane === state.lane &&
      e.col === SLIME_COL + 1
  );
  for (const enemy of adjacentEnemies) {
    resolveCombatRound(enemy);
    if (state.hp <= 0 || !state.running) break;
  }

  // 5b. Blocking obstacles (boulders) deal contact damage every tick while
  //     adjacent to the slime in the same lane.
  if (state.hp > 0 && state.running) {
    const adjacentBlockers = state.entities.filter(
      (e) =>
        e.type === "obstacle" &&
        e.def.blocking &&
        e.lane === state.lane &&
        e.col === SLIME_COL + 1
    );
    for (const obs of adjacentBlockers) {
      applyObstacleDamageToSlime(obs);
      if (state.hp <= 0) break;
    }
  }

  // 6. Despawn any entities that slipped past (col < 0)
  state.entities = state.entities.filter((e) => e.col >= 0);

  // 7. Level progression — spawn things
  const lvlLen = levelTickLength();
  if (state.levelTicks < lvlLen && !state.terminusSpawned) {
    // Normal spawning
    if (state.levelTicks % 2 === 0) spawnRandomPathEntity();
  } else if (!state.terminusSpawned && state.levelTicks >= lvlLen) {
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
// Apply damage from an obstacle to the slime, taking held / mutation
// reductions and god-mode into account.
function applyObstacleDamageToSlime(ent) {
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  const reduction =
    getHeldBonuses().damageReduction + (mut.damageReduction || 0);
  const rawDmg = Math.max(0, (ent.def.damage || 0) - reduction);
  const dmg = devState.godMode ? 0 : rawDmg;
  state.hp -= dmg;
  pushLog(`${ent.def.name} hits you for ${dmg}`);
  if (dmg > 0) floatText("dmg", `-${dmg}`, slimeEl);
  return dmg;
}

// The slime "encounters" an entity that is now in its cell. Could be from the
// move loop (the entity slid in) or from a lane change (the slime walked onto
// it). Triggers the appropriate interaction.
function handleEncounter(ent) {
  if (ent.type === "enemy" || ent.type === "terminus") {
    // Slime walked into a stray enemy at col 0. Run a single combat round and
    // bump any survivor back to col 1 so the normal adjacent-combat rules
    // take over from the next tick.
    resolveCombatRound(ent);
    if (state.entities.includes(ent)) {
      ent.col = SLIME_COL + 1;
    }
  } else if (ent.type === "item") {
    tryPickupItem(ent.def.itemKey);
    removeEntity(ent);
  } else if (ent.type === "obstacle") {
    if (ent.def.blocking) {
      // Walked into a boulder. It hits the slime once and the slime's
      // movement stopper kicks in: the boulder gets bumped one column back so
      // it stays a barrier in this lane.
      applyObstacleDamageToSlime(ent);
      ent.col = SLIME_COL + 1;
    } else {
      applyObstacleDamageToSlime(ent);
      removeEntity(ent);
    }
  } else if (ent.type === "location") {
    // Move onto location and open modal
    ent.col = SLIME_COL;
    openLocation(ent);
  }
}

// Two entities collide in the middle of the path (one moving onto another).
// `mover` is the one trying to advance; `blocker` is the one already at that
// cell. Most pairings just stall, but obstacles damage stuck enemies and
// fountains heal them, which is what allows piles of debris to wear bosses
// down.
function handleSlideInteraction(mover, blocker) {
  const blockerIsEnemy =
    blocker.type === "enemy" || blocker.type === "terminus";

  if (blockerIsEnemy && mover.type === "obstacle") {
    const dmg = mover.def.damage || 0;
    blocker.hp -= dmg;
    pushLog(`${mover.def.name} slams ${blocker.def.name} for ${dmg}`);
    removeEntity(mover);
    if (blocker.hp <= 0) {
      state.runStats.enemiesDefeated++;
      const mut = state.mutBonuses || getMutationBonuses(state.mutations);
      const goldDrop = Math.round(
        (blocker.def.gold || 0) * (mut.enemyGoldMult || 1)
      );
      addGold(goldDrop);
      pushLog(`${blocker.def.name} crushed (+${goldDrop}🪙)`);
      removeEntity(blocker);
    }
    return;
  }

  if (blockerIsEnemy && mover.type === "location" && mover.def.id === "fountain") {
    const heal = 5 + state.level * 2;
    blocker.hp = Math.min(blocker.maxHp, blocker.hp + heal);
    pushLog(`${blocker.def.name} drinks from the ${mover.def.name} (+${heal})`);
    removeEntity(mover);
    return;
  }

  // Default: just don't move this tick.
}

function resolveCombatRound(enemy) {
  const bonuses = getHeldBonuses();
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  // Slime hits enemy (Forked Pseudopod adds a flat +1).
  const slimeDmg = bonuses.attack + (mut.attackBonus || 0);
  enemy.hp -= slimeDmg;
  floatText("dmg", `-${slimeDmg}`, slimeEl);

  if (enemy.hp <= 0) {
    // Loot
    state.runStats.enemiesDefeated++;
    const baseGold = enemy.def.gold || 0;
    const goldDrop = Math.round(baseGold * (mut.enemyGoldMult || 1));
    addGold(goldDrop);
    pushLog(`Defeated ${enemy.def.name} (+${goldDrop}🪙)`);
    if (enemy.def.dropChance && enemy.def.dropPool && Math.random() < enemy.def.dropChance) {
      const key = pick(enemy.def.dropPool);
      tryPickupItem(key);
    }
    removeEntity(enemy);
    return;
  }

  // Bouncy Body: chance to dodge entirely.
  if (mut.dodgeChance > 0 && Math.random() < mut.dodgeChance) {
    floatText("heal", "DODGE", slimeEl);
    return;
  }

  // Enemy hits slime
  const rawDmg = enemy.def.attack || 0;
  const reduction = bonuses.damageReduction + (mut.damageReduction || 0);
  const dmg = devState.godMode ? 0 : Math.max(0, rawDmg - reduction);
  state.hp -= dmg;
  if (dmg > 0) floatText("dmg", `-${dmg}`, slimeEl);

  // Acidic Skin: thorns reflect when actually struck.
  if (dmg > 0 && mut.thorns > 0) {
    enemy.hp -= mut.thorns;
    floatText("dmg", `-${mut.thorns}`, slimeEl);
    if (enemy.hp <= 0) {
      state.runStats.enemiesDefeated++;
      const baseGold = enemy.def.gold || 0;
      const goldDrop = Math.round(baseGold * (mut.enemyGoldMult || 1));
      addGold(goldDrop);
      pushLog(`${enemy.def.name} dissolved on your skin (+${goldDrop}🪙)`);
      removeEntity(enemy);
    }
  }
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
      body: "A shop. Coming soon.",
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
  state.runStats.levelsCompleted++;
  const node = currentMapNode();
  if (node && node.type === "boss") {
    state.runStats.bossDefeated = true;
    state.running = false;
    openRunEndScreen(true);
    return;
  }
  openOverworld();
}

// Render the overworld map into the top-of-screen viewport (replacing the
// treadmill). The user picks a glowing node which then transitions into the
// appropriate scene for that node type.
function openOverworld() {
  setScene("overworld");
  state.paused = true;
  updatePauseBtn();
  renderOverworld();
}

function renderOverworld() {
  if (!state.map) return;
  overworldMapEl.innerHTML = "";
  const svg = renderMapSVG(
    state.map,
    state.mapNode.row,
    state.mapNode.col,
    (next) => onNodeSelected(next)
  );
  overworldMapEl.appendChild(svg);
  if (overworldStatusEl) {
    overworldStatusEl.textContent = `HP ${state.hp}/${effectiveMaxHp()} · 🪙 ${state.gold}`;
  }
}

function onNodeSelected(node) {
  state.mapNode = { row: node.row, col: node.col };
  state.level = node.row + 1;
  state.levelTicks = 0;
  state.terminusSpawned = false;
  state.terminusDefeated = false;
  state.entities = [];

  // Different node types dispatch to different scenes.
  if (node.type === "event") {
    enterEventScene(rollEvent());
    return;
  }
  if (node.type === "treasure") {
    enterTreasureScene();
    return;
  }
  // combat / elite / boss → live run.
  enterRunScene();
}

function enterRunScene() {
  setScene("run");
  state.paused = false;
  state.running = true;
  state.entities = [];
  // Glowing Core mutation: heal a bit on level start.
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  if (mut.levelStartHeal > 0) {
    state.hp = Math.min(effectiveMaxHp(), state.hp + mut.levelStartHeal);
  }
  updatePauseBtn();
  const node = currentMapNode();
  const cfg = NODE_TYPES[node?.type] || NODE_TYPES.combat;
  showBanner(`— Level ${state.level}: ${cfg.label} —`, 1800);
  renderAll();
}

// ---------- Event scene ----------
function enterEventScene(eventKey) {
  const event = EVENTS[eventKey];
  if (!event) {
    // Fallback: skip to next scene as if it were combat.
    enterRunScene();
    return;
  }
  setScene("event");
  state.paused = true;
  state.running = false;
  updatePauseBtn();
  renderEventCard(event);
  updateHUD();
}

function renderEventCard(event) {
  eventTitleEl.textContent = event.title;
  eventTextEl.textContent = event.text;
  eventChoicesEl.innerHTML = "";
  eventResultEl.classList.add("hidden");
  eventResultEl.textContent = "";
  eventContinueBtn.classList.add("hidden");

  for (const choice of event.choices) {
    const btn = document.createElement("button");
    btn.className = "event-choice";
    btn.type = "button";
    btn.textContent = choice.label;
    const allowed =
      !choice.requires ||
      (choice.requires.gold == null || state.gold >= choice.requires.gold);
    if (!allowed) {
      btn.disabled = true;
      btn.classList.add("disabled");
    }
    btn.addEventListener("click", () => resolveEventChoice(event, choice));
    eventChoicesEl.appendChild(btn);
  }
}

function resolveEventChoice(event, choice) {
  // Apply each effect in order.
  for (const eff of choice.effects || []) {
    if (eff.gold) {
      if (eff.gold > 0) addGold(eff.gold);
      else state.gold = Math.max(0, state.gold + eff.gold);
    }
    if (eff.hp) {
      state.hp = clamp(state.hp + eff.hp, 0, effectiveMaxHp());
    }
    if (eff.heal) {
      state.hp = Math.min(effectiveMaxHp(), state.hp + eff.heal);
    }
    if (eff.maxHp) {
      state.maxHp = Math.max(1, state.maxHp + eff.maxHp);
      state.hp = Math.min(state.hp, effectiveMaxHp());
    }
    if (eff.item) tryPickupItem(eff.item);
    if (eff.randomItem) tryPickupItem(randomItemKey(eff.randomItem));
    if (eff.mutation) {
      // Award one random mutation directly (no choice screen here — events
      // already involved a choice).
      const owned = new Set(state.mutations);
      const choices = rollMutationChoices(owned, 1);
      if (choices.length > 0) addMutation(choices[0]);
    }
  }
  // Show the result text and a continue button.
  eventResultEl.textContent = choice.result || "";
  eventResultEl.classList.remove("hidden");
  for (const b of eventChoicesEl.querySelectorAll("button")) b.disabled = true;
  eventContinueBtn.classList.remove("hidden");
  updateHUD();
  renderInventory();

  // Death check: an event might have killed the slime.
  if (state.hp <= 0) {
    state.hp = 0;
    eventContinueBtn.textContent = "Continue (you collapse...)";
    eventContinueBtn.onclick = () => onDeath();
    return;
  }
  eventContinueBtn.textContent = "Continue ▶";
  eventContinueBtn.onclick = () => {
    // After resolving, go back to overworld so the player picks the next node.
    openOverworld();
  };
}

// ---------- Treasure scene (mutation pick) ----------
function enterTreasureScene() {
  setScene("event");
  state.paused = true;
  state.running = false;
  updatePauseBtn();

  const owned = new Set(state.mutations);
  const choices = rollMutationChoices(owned, 3);

  eventTitleEl.textContent = "💎 Mysterious Cache";
  eventTextEl.textContent =
    choices.length > 0
      ? "A pulsing nodule sits on a stone pedestal. As you approach, three potential mutations bloom in your sight."
      : "An empty pedestal — you've already mastered every mutation it offers.";
  eventChoicesEl.innerHTML = "";
  eventResultEl.classList.add("hidden");
  eventContinueBtn.classList.add("hidden");

  if (choices.length === 0) {
    // Console it with gold.
    addGold(25);
    eventResultEl.textContent = "You take 25🪙 instead.";
    eventResultEl.classList.remove("hidden");
    eventContinueBtn.classList.remove("hidden");
    eventContinueBtn.textContent = "Continue ▶";
    eventContinueBtn.onclick = () => openOverworld();
    updateHUD();
    return;
  }

  for (const key of choices) {
    const def = MUTATIONS[key];
    const btn = document.createElement("button");
    btn.className = "event-choice mutation-choice";
    btn.type = "button";
    btn.innerHTML = `<span class="mc-icon">${def.icon}</span><span class="mc-name">${def.name}</span><span class="mc-desc">${def.desc}</span>`;
    btn.addEventListener("click", () => {
      addMutation(key);
      eventResultEl.textContent = `You absorb the ${def.name}.`;
      eventResultEl.classList.remove("hidden");
      for (const b of eventChoicesEl.querySelectorAll("button")) b.disabled = true;
      eventContinueBtn.classList.remove("hidden");
      eventContinueBtn.textContent = "Continue ▶";
      eventContinueBtn.onclick = () => openOverworld();
      renderInventory();
      updateHUD();
    });
    eventChoicesEl.appendChild(btn);
  }
  // Optional skip choice — take 15 gold instead.
  const skip = document.createElement("button");
  skip.className = "event-choice subtle";
  skip.type = "button";
  skip.textContent = "Skip — take 15🪙 instead";
  skip.addEventListener("click", () => {
    addGold(15);
    eventResultEl.textContent = "You leave the pedestal undisturbed.";
    eventResultEl.classList.remove("hidden");
    for (const b of eventChoicesEl.querySelectorAll("button")) b.disabled = true;
    eventContinueBtn.classList.remove("hidden");
    eventContinueBtn.textContent = "Continue ▶";
    eventContinueBtn.onclick = () => openOverworld();
    updateHUD();
  });
  eventChoicesEl.appendChild(skip);
}

function addMutation(key) {
  if (!MUTATIONS[key] || state.mutations.includes(key)) return;
  state.mutations.push(key);
  refreshMutationBonuses();
  pushLog(`Mutation: ${MUTATIONS[key].name}`);
  // Refresh HP cap in case maxHp grew.
  if (state.hp > effectiveMaxHp()) state.hp = effectiveMaxHp();

  // Stomach-granting mutations: append a new typed cell to the inventory.
  // The player can move it around with arrange mode.
  const def = MUTATIONS[key];
  const stomachKind = def.effect && def.effect.addStomach;
  if (stomachKind && STOMACH_KINDS[stomachKind]) {
    state.inventory.unshift({ kind: stomachKind, item: null });
    pushLog(`Grew a ${STOMACH_KINDS[stomachKind].label}`);
  }
}

function onDeath() {
  state.running = false;
  openRunEndScreen(false);
}

// Build a fresh run from current meta. Called by Hub "Begin Adventure" and
// by dev tools "Reset Run". Leaves the game in the run scene at row 0.
function beginNewRun() {
  runEndAwarded = false;
  // Recompute modifiers from current meta so purchases made mid-session
  // take effect on the next run.
  const mods = computeRunModifiers(state.meta);
  state.runMods = mods;

  state.tick = 0;
  // Note: state.tickInterval is intentionally NOT reset so dev-tool speed
  // settings persist across run resets during testing.
  state.paused = false;
  state.running = true;
  state.maxHp = 20 + (mods.maxHpBonus || 0);
  state.hp = state.maxHp;
  state.gold = mods.startGold || 0;
  state.lane = 1;
  state.level = 1;
  state.levelTicks = 0;
  state.terminusSpawned = false;
  state.terminusDefeated = false;
  state.entities = [];
  // Unified inventory: 6 default cells + any extras granted by meta upgrades.
  // The last cell is a digestive sac; everything else is inert until a player
  // mutation adds a typed stomach. Held/Stomach meta upgrades both contribute
  // generic extra cells now that the two zones are unified.
  const baseInventorySize = 6 + (mods.heldCells || 0) + (mods.stomachCells || 0);
  state.inventory = makeFreshInventory(baseInventorySize);
  state.selected = null;
  state.arrangeMode = false;
  state.buffs = {};
  state.regenCounter = 0;
  state.passiveCounter = 0;
  state.growthLevel = 0;
  state.mutations = [];
  refreshMutationBonuses();
  state.runStats = {
    levelsCompleted: 0,
    enemiesDefeated: 0,
    goldEarned: 0,
    itemsDigested: 0,
    bossDefeated: false,
  };
  // Seed starting items from meta unlocks.
  for (const key of mods.startItems || []) {
    tryPickupItem(key);
  }
  state.map = generateRunMap();
  state.mapNode = { row: 0, col: 0 };
  closeModal();
  setScene("run");
  updatePauseBtn();
  renderAll();
  showBanner("— Level 1: Start —");
}

// Legacy alias retained so dev tools and run-end keep working.
function restartRun() {
  beginNewRun();
}

// Return to the village hub. Used after run-end and from a future "give up"
// button. Stops the tick loop by leaving scene !== "run".
function goToHub() {
  state.running = false;
  state.paused = true;
  setScene("hub");
  closeModal();
  renderHub();
}

function renderHub() {
  const line = document.getElementById("hub-meta-line");
  if (line && state.meta) {
    line.textContent = `XP: ${state.meta.availableXp} · Lifetime: ${state.meta.totalXp}`;
  }
}

// ---------- Inventory interactions (tap-to-select-then-place) ----------
// Two interaction modes share the same selection state:
//   default → tap any cell with an item to select it, tap another cell to
//             swap items only (cell kinds stay put).
//   arrange → tap any cell to select it, tap another to swap the entire cell
//             (kind + item). Lets the player reposition stomachs they earned.
function onSlotClick(index) {
  const cell = state.inventory[index];
  if (!cell) return;

  if (state.arrangeMode) {
    if (!state.selected) {
      state.selected = { index };
    } else if (state.selected.index === index) {
      state.selected = null;
    } else {
      const a = state.inventory[state.selected.index];
      const b = cell;
      // Swap the entire cell descriptor (kind + item).
      state.inventory[state.selected.index] = b;
      state.inventory[index] = a;
      state.selected = null;
    }
    renderInventory();
    updateHUD();
    return;
  }

  // Default mode: swap items between cells.
  if (!state.selected) {
    if (cell.item) state.selected = { index };
  } else {
    const src = state.inventory[state.selected.index];
    if (state.selected.index === index) {
      state.selected = null;
    } else {
      const tmp = cell.item;
      cell.item = src.item;
      src.item = tmp;
      // Reset digest progress on items that just entered a digesting cell.
      const dstKind = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
      const srcKind = STOMACH_KINDS[src.kind] || STOMACH_KINDS.none;
      if (dstKind.digests && cell.item) cell.item.digestProgress = 0;
      if (srcKind.digests && src.item) src.item.digestProgress = 0;
      state.selected = null;
    }
  }
  renderInventory();
  updateHUD();
}

function discardSelected() {
  if (!state.selected) return;
  const cell = state.inventory[state.selected.index];
  if (cell && cell.item) {
    pushLog(`Discarded ${cell.item.def.name}`);
    cell.item = null;
  }
  state.selected = null;
  renderInventory();
  updateHUD();
}

function toggleArrangeMode() {
  state.arrangeMode = !state.arrangeMode;
  state.selected = null;
  renderInventory();
}

function growCost() {
  if (devState.freeGrowth) return 0;
  const base = 10 + state.growthLevel * 5;
  const mult = state.runMods?.growCostMult || 1;
  return Math.max(1, Math.round(base * mult));
}

function growSlime() {
  const cost = growCost();
  if (state.gold < cost) {
    pushLog(`Need ${cost}🪙 to grow`);
    return;
  }
  if (state.inventory.length >= 24) {
    pushLog("Max size reached");
    return;
  }
  // Growth just adds an inert cell. Players use mutations to add stomachs
  // and arrange-mode to place them where they want.
  state.gold -= cost;
  state.inventory.unshift({ kind: "none", item: null });
  state.growthLevel++;
  pushLog("Slime grows: +1 cell");
  renderAll();
}

// ---------- Run end + meta menu ----------
// Guard so re-opening the run-end screen from the meta menu doesn't re-award XP.
let runEndAwarded = false;

function openRunEndScreen(victory) {
  state.paused = true;
  updatePauseBtn();

  const xp = calculateRunXp(state.runStats);
  if (!runEndAwarded) {
    grantXp(state.meta, xp.total);
    state.meta.lastRun = {
      xp: xp.total,
      victory,
      stats: { ...state.runStats },
      levelReached: state.level,
    };
    saveMeta(state.meta);
    runEndAwarded = true;
  }

  const wrap = document.createElement("div");
  wrap.className = "run-end";

  const summary = document.createElement("div");
  summary.className = "run-end-summary";
  summary.textContent = victory
    ? `You defeated the Gelatinous King! Reached Level ${state.level}.`
    : `You died on Level ${state.level}.`;
  wrap.appendChild(summary);

  const stats = document.createElement("div");
  stats.className = "run-end-stats";
  stats.innerHTML = `
    <div><span>Levels cleared</span><b>${state.runStats.levelsCompleted}</b></div>
    <div><span>Enemies slain</span><b>${state.runStats.enemiesDefeated}</b></div>
    <div><span>Gold earned</span><b>${state.runStats.goldEarned}</b></div>
    <div><span>Items digested</span><b>${state.runStats.itemsDigested}</b></div>
    <div><span>Boss defeated</span><b>${state.runStats.bossDefeated ? "yes" : "no"}</b></div>
  `;
  wrap.appendChild(stats);

  const xpHeader = document.createElement("div");
  xpHeader.className = "run-end-xp-header";
  xpHeader.textContent = `Slime XP earned: +${xp.total}`;
  wrap.appendChild(xpHeader);

  const xpBreak = document.createElement("div");
  xpBreak.className = "run-end-breakdown";
  xpBreak.innerHTML = `
    <div>Levels · +${xp.breakdown.levels}</div>
    <div>Enemies · +${xp.breakdown.enemies}</div>
    <div>Gold · +${xp.breakdown.gold}</div>
    <div>Items · +${xp.breakdown.items}</div>
    <div>Boss · +${xp.breakdown.boss}</div>
  `;
  wrap.appendChild(xpBreak);

  const total = document.createElement("div");
  total.className = "run-end-total";
  total.textContent = `Lifetime: ${state.meta.totalXp} XP · Available: ${state.meta.availableXp} XP`;
  wrap.appendChild(total);

  openModal({
    title: victory ? "🏆 Victory!" : "💀 You Died",
    bodyEl: wrap,
    actions: [
      {
        label: "Return to Hub",
        primary: true,
        onClick: () => {
          closeModal();
          goToHub();
        },
      },
    ],
  });
}

function openMetaMenu() {
  // Meta menu is now a hub-screen overlay. Caller should be in the hub scene.
  const wrap = document.createElement("div");
  wrap.className = "meta-menu";

  const header = document.createElement("div");
  header.className = "meta-header";
  header.textContent = `Available XP: ${state.meta.availableXp} · Lifetime: ${state.meta.totalXp}`;
  wrap.appendChild(header);

  // Group upgrades by tier
  const byTier = { 1: [], 2: [], 3: [] };
  for (const [id, def] of Object.entries(UPGRADES)) {
    byTier[def.tier].push({ id, def });
  }

  for (const tier of [1, 2, 3]) {
    const section = document.createElement("div");
    section.className = "meta-tier";
    const unlocked = tierUnlocked(state.meta, tier);
    if (!unlocked) section.classList.add("tier-locked");

    const label = document.createElement("div");
    label.className = "meta-tier-label";
    const names = { 1: "Tier 1 · Body", 2: "Tier 2 · Abilities", 3: "Tier 3 · Loadout" };
    const threshold = TIER_THRESHOLDS[tier] || 0;
    label.textContent = unlocked
      ? names[tier]
      : `${names[tier]}  🔒  requires ${threshold} lifetime XP`;
    section.appendChild(label);

    const grid = document.createElement("div");
    grid.className = "meta-grid";
    for (const { id, def } of byTier[tier]) {
      const card = document.createElement("div");
      card.className = "meta-upgrade";
      const owned = !!state.meta.unlocks[id];
      const canBuy = canPurchase(state.meta, id);
      const reqMet = !def.requires || !!state.meta.unlocks[def.requires];

      if (owned) card.classList.add("owned");
      else if (canBuy) card.classList.add("available");
      else card.classList.add("unavailable");

      const name = document.createElement("div");
      name.className = "meta-name";
      name.textContent = def.name;
      card.appendChild(name);

      const desc = document.createElement("div");
      desc.className = "meta-desc";
      desc.textContent = def.desc;
      card.appendChild(desc);

      const foot = document.createElement("div");
      foot.className = "meta-foot";
      if (owned) {
        foot.textContent = "✓ Owned";
      } else if (!unlocked) {
        foot.textContent = `Tier locked`;
      } else if (def.requires && !reqMet) {
        foot.textContent = `Requires ${UPGRADES[def.requires]?.name || def.requires}`;
      } else {
        foot.textContent = `${def.cost} XP`;
      }
      card.appendChild(foot);

      if (canBuy) {
        card.addEventListener("click", () => {
          if (purchase(state.meta, id)) {
            saveMeta(state.meta);
            renderHub();
            // Re-render the menu in place.
            openMetaMenu();
          }
        });
      }
      grid.appendChild(card);
    }
    section.appendChild(grid);
    wrap.appendChild(section);
  }

  openModal({
    title: "🧪 Upgrade Lab",
    bodyEl: wrap,
    actions: [
      {
        label: "Back to Hub",
        primary: true,
        onClick: () => {
          closeModal();
          renderHub();
        },
      },
    ],
  });
}

// Placeholder hub screens for not-yet-built buildings.
function openPlaceholder(title, msg) {
  openModal({
    title,
    body: msg,
    actions: [
      {
        label: "Back",
        primary: true,
        onClick: () => closeModal(),
      },
    ],
  });
}

// ---------- Modal ----------
function openModal({ title, body, bodyEl, actions }) {
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
  renderMutationStrip();
  renderInventoryZone();
  discardBtn.disabled =
    !state.selected ||
    !state.inventory[state.selected.index] ||
    !state.inventory[state.selected.index].item;
  const cost = growCost();
  growBtn.textContent = `🧪 Grow (${cost}🪙)`;
  growBtn.disabled = state.gold < cost;
  if (arrangeBtn) {
    arrangeBtn.classList.toggle("on", state.arrangeMode);
    arrangeBtn.textContent = state.arrangeMode ? "🔁 Arranging" : "🔁 Arrange";
  }
}

function renderMutationStrip() {
  if (!mutationStripEl) return;
  mutationStripEl.innerHTML = "";
  if (!state.mutations || state.mutations.length === 0) {
    mutationStripEl.classList.add("empty");
    return;
  }
  mutationStripEl.classList.remove("empty");
  for (const key of state.mutations) {
    const def = MUTATIONS[key];
    if (!def) continue;
    const chip = document.createElement("div");
    chip.className = "mut-chip";
    chip.textContent = def.icon;
    chip.title = `${def.name}\n${def.desc}`;
    mutationStripEl.appendChild(chip);
  }
}

function renderInventoryZone() {
  if (!inventoryZoneEl) return;
  inventoryZoneEl.innerHTML = "";
  inventoryZoneEl.classList.toggle("arrange-mode", state.arrangeMode);

  state.inventory.forEach((cell, idx) => {
    const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
    const slot = document.createElement("div");
    slot.className = `slot kind-${cell.kind}`;
    slot.style.background = kindCfg.color;
    slot.style.borderColor = kindCfg.border;
    if (!cell.item) slot.classList.add("empty");
    if (state.selected && state.selected.index === idx) {
      slot.classList.add("selected");
    }
    // Highlight valid drop targets in default mode (any cell), arrange mode
    // (any cell), so the user always sees clickable targets when something
    // is selected.
    if (state.selected && state.selected.index !== idx) {
      slot.classList.add("valid-target");
    }

    // Stomach kind label/icon shown faintly behind the item.
    const kindBadge = document.createElement("div");
    kindBadge.className = "kind-badge";
    kindBadge.textContent = kindCfg.icon;
    kindBadge.title = `${kindCfg.label} — ${kindCfg.desc}`;
    slot.appendChild(kindBadge);

    if (cell.item) {
      const item = cell.item;
      const itemEl = document.createElement("div");
      itemEl.className = "slot-item";
      itemEl.textContent = item.def.emoji;
      slot.appendChild(itemEl);

      const r = document.createElement("span");
      r.className = `rarity ${item.def.rarity}`;
      r.textContent = item.def.rarity.charAt(0).toUpperCase();
      slot.appendChild(r);

      if (kindCfg.digests) {
        const ring = document.createElement("div");
        ring.className = "digest-ring";
        const pct = Math.min(
          100,
          (item.digestProgress / item.def.digestTime) * 100
        );
        ring.style.background = `conic-gradient(#9f6 ${pct}%, transparent ${pct}%)`;
        slot.appendChild(ring);
      }
      slot.title = `${item.def.name} (${kindCfg.label})\n${item.def.flavor}`;
    } else {
      slot.title = kindCfg.label + " — " + kindCfg.desc;
    }
    slot.addEventListener("click", () => onSlotClick(idx));
    inventoryZoneEl.appendChild(slot);
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
  const pct = Math.min(100, (state.levelTicks / levelTickLength()) * 100);
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
function applyLaneRegen() {
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  if (mut.laneRegen > 0 && state.hp < effectiveMaxHp()) {
    state.hp = Math.min(effectiveMaxHp(), state.hp + mut.laneRegen);
    floatText("heal", `+${mut.laneRegen}`, slimeEl);
    updateHUD();
  }
}
// Whenever the slime changes lane, anything sitting in its column in the new
// lane gets walked-on. The encounter triggers immediately — items get picked
// up, fountains open, obstacles damage, lone enemies start a combat round.
function checkLaneEntry() {
  const ent = state.entities.find(
    (e) => e.lane === state.lane && e.col === SLIME_COL
  );
  if (ent) handleEncounter(ent);
}
function onLaneUp() {
  if (state.scene !== "run") return;
  const prev = state.lane;
  state.lane = clamp(state.lane - 1, 0, LANES - 1);
  if (state.lane !== prev) {
    applyLaneRegen();
    checkLaneEntry();
  }
  renderAll();
}
function onLaneDown() {
  if (state.scene !== "run") return;
  const prev = state.lane;
  state.lane = clamp(state.lane + 1, 0, LANES - 1);
  if (state.lane !== prev) {
    applyLaneRegen();
    checkLaneEntry();
  }
  renderAll();
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
  if (arrangeBtn) arrangeBtn.addEventListener("click", toggleArrangeMode);

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "w") onLaneUp();
    else if (e.key === "ArrowDown" || e.key === "s") onLaneDown();
    else if (e.key === " " || e.key === "p") {
      e.preventDefault();
      onPause();
    }
  });
}

// ---------- Hub wiring ----------
function hookHub() {
  const startBtn = document.getElementById("hub-start");
  const upgradesBtn = document.getElementById("hub-upgrades");
  const mutationsBtn = document.getElementById("hub-mutations");
  const codexBtn = document.getElementById("hub-codex");
  const cosmeticsBtn = document.getElementById("hub-cosmetics");
  if (startBtn) startBtn.addEventListener("click", () => beginNewRun());
  if (upgradesBtn) upgradesBtn.addEventListener("click", () => openMetaMenu());
  if (mutationsBtn) {
    mutationsBtn.addEventListener("click", () =>
      openPlaceholder(
        "🧬 Mutation Den",
        "Future home of permanent mutation unlocks. Coming soon."
      )
    );
  }
  if (codexBtn) {
    codexBtn.addEventListener("click", () =>
      openPlaceholder(
        "📖 Slime Codex",
        "Lore, item entries, and bestiary. Coming soon."
      )
    );
  }
  if (cosmeticsBtn) {
    cosmeticsBtn.addEventListener("click", () =>
      openPlaceholder(
        "🎨 Wardrobe",
        "Skins and color variants. Coming soon."
      )
    );
  }
}

// ---------- Event continue button ----------
function hookEventView() {
  if (eventContinueBtn) {
    // The onclick handler is rebound per-event in resolveEventChoice; this
    // line just exists so the button is registered in the DOM.
  }
}

// ---------- Boot ----------
function start() {
  hookInput();
  hookHub();
  hookEventView();
  state.meta = loadMeta();
  refreshMutationBonuses();
  // Boot lands in the hub — no run is in progress.
  setScene("hub");
  renderHub();
  renderAll();
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
    advanceToNode: onNodeSelected,
    rerollMap: () => {
      state.map = generateRunMap();
      state.mapNode = { row: 0, col: 0 };
      state.level = 1;
      state.levelTicks = 0;
      state.terminusSpawned = false;
      state.terminusDefeated = false;
      state.entities = [];
      state.paused = false;
      setScene("run");
      updatePauseBtn();
      renderAll();
      showBanner("— Level 1: Start —");
    },
    openMetaMenu,
    goToHub,
    grantMetaXp: (amount) => {
      grantXp(state.meta, amount);
      saveMeta(state.meta);
      renderHub();
    },
    resetMeta: () => {
      state.meta = resetMeta();
      saveMeta(state.meta);
      renderHub();
    },
    COLS,
    levelTickLength,
    MAX_LEVEL,
    BASE_TICK_MS,
  });
}

start();
