// SlimeVenture — scene management, overworld, events, treasure, run flow, hub

import { state, $, clamp, refreshMutationBonuses, currentMapNode } from "./state.js";
import {
  MUTATIONS,
  STOMACH_KINDS,
  rollMutationChoices,
  getMutationBonuses,
  MUTATION_KEYS,
} from "./mutations.js";
import { EVENTS, rollEvent } from "./events.js";
import { generateRunMap, renderMapSVG, NODE_TYPES, EVOLUTION_ROW } from "./map.js";
import {
  UPGRADES,
  TIER_THRESHOLDS,
  saveMeta,
  calculateRunXp,
  grantXp,
  tierUnlocked,
  canPurchase,
  purchase,
  computeRunModifiers,
} from "./meta.js";
import {
  tryPickupItem,
  addGold,
  makeFreshInventory,
  effectiveMaxHp,
  randomItemKey,
  renderInventory,
} from "./inventory.js";
import {
  renderAll,
  showBanner,
  updateHUD,
  updatePauseBtn,
  openModal,
  closeModal,
  pushLog,
} from "./ui.js";
import { generateLevelSchedule } from "./pathgen.js";
import { SUBCLASSES, rollSubclassChoices, applySubclass } from "./subclass.js";
import { getPetBonuses } from "./pets.js";
import { syncRunStats, refreshDailies, trackIncrement } from "./quests.js";

// ---------- DOM refs ----------
const overworldMapEl = $("overworld-map");
const overworldStatusEl = $("overworld-status");
const eventTitleEl = $("event-title");
const eventTextEl = $("event-text");
const eventChoicesEl = $("event-choices");
const eventResultEl = $("event-result");
const eventContinueBtn = $("event-continue");

// ---------- Scene management ----------
// Switching the visible top-of-screen view is just a class swap on #game.
// Tick loop only advances when scene === "run" (and not paused).
export function setScene(name) {
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

// ---------- Level / run flow ----------
export function onLevelComplete() {
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
export function openOverworld() {
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

export function onNodeSelected(node) {
  state.mapNode = { row: node.row, col: node.col };
  state.level = node.row + 1;
  state.levelTicks = 0;
  state.terminusSpawned = false;
  state.terminusDefeated = false;
  state.entities = [];

  if (node.type === "evolution") {
    enterEvolutionPool(null);
    return;
  }
  if (node.type === "elder") {
    enterElderScene();
    return;
  }
  if (node.type === "event") {
    enterEventScene(rollEvent());
    return;
  }
  if (node.type === "treasure") {
    enterTreasureScene();
    return;
  }
  // combat / elite / boss / start → live run.
  enterRunScene();
}

function enterRunScene() {
  setScene("run");
  state.paused = false;
  state.running = true;
  state.entities = [];
  state.levelSchedule = generateLevelSchedule();
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

// ---------- Evolution Pool (subclass pick, overworld node) ----------
function enterEvolutionPool() {
  setScene("event");
  state.paused = true;
  state.running = false;
  updatePauseBtn();

  const choices = rollSubclassChoices();

  eventTitleEl.textContent = "🧬 Evolution Pool";
  eventTextEl.textContent =
    "A luminous pool pulses with mutagenic energy. Step inside and feel your body reshape...";
  eventChoicesEl.innerHTML = "";
  eventResultEl.classList.add("hidden");
  eventContinueBtn.classList.add("hidden");

  for (const key of choices) {
    const def = SUBCLASSES[key];
    const btn = document.createElement("button");
    btn.className = "event-choice mutation-choice";
    btn.type = "button";
    btn.innerHTML = `<span class="mc-icon">${def.emoji}</span><span class="mc-name">${def.name}</span><span class="mc-desc">${def.desc}</span>`;
    btn.addEventListener("click", () => {
      applySubclass(key);
      trackIncrement("subclassChosen");
      eventResultEl.textContent = `You emerge from the pool as a ${def.name}!`;
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

  // Allow skipping.
  const skip = document.createElement("button");
  skip.className = "event-choice subtle";
  skip.type = "button";
  skip.textContent = "Walk past the pool";
  skip.addEventListener("click", () => openOverworld());
  eventChoicesEl.appendChild(skip);
}

// ---------- Elder scene (overworld node) ----------
function enterElderScene() {
  setScene("event");
  state.paused = true;
  state.running = false;
  updatePauseBtn();

  const CONVERT_OPTIONS = [
    { from: "none", to: "digest", label: "Add Digestive Sac", desc: "Convert an inert cell into a digesting cell" },
    { from: "none", to: "holding", label: "Add Holding Pouch", desc: "Convert an inert cell into a holding cell" },
    { from: "digest", to: "fast", label: "Upgrade to Fast Stomach", desc: "Upgrade a digest cell to fast (1.5x speed)" },
    { from: "digest", to: "acid", label: "Upgrade to Acid Sac", desc: "Upgrade a digest cell to acid (2x yield)" },
  ];

  const available = CONVERT_OPTIONS.filter((opt) =>
    state.inventory.some((c) => c.kind === opt.from)
  );

  eventTitleEl.textContent = "🧙 Slime Elder";
  eventChoicesEl.innerHTML = "";
  eventResultEl.classList.add("hidden");
  eventContinueBtn.classList.add("hidden");

  if (available.length === 0) {
    eventTextEl.textContent = "The Elder studies you, but sees no cells to transform.";
    eventContinueBtn.classList.remove("hidden");
    eventContinueBtn.textContent = "Continue ▶";
    eventContinueBtn.onclick = () => openOverworld();
    return;
  }

  eventTextEl.textContent = "An ancient slime offers to reshape one of your cells...";

  for (const opt of available) {
    const toKind = STOMACH_KINDS[opt.to] || STOMACH_KINDS.none;
    const btn = document.createElement("button");
    btn.className = "event-choice mutation-choice";
    btn.type = "button";
    btn.innerHTML = `<span class="mc-icon">${toKind.icon}</span><span class="mc-name">${opt.label}</span><span class="mc-desc">${opt.desc}</span>`;
    btn.addEventListener("click", () => {
      const idx = state.inventory.findIndex((c) => c.kind === opt.from);
      if (idx >= 0) {
        state.inventory[idx].kind = opt.to;
        pushLog(`Elder transforms a cell: ${opt.from} → ${opt.to}`);
      }
      trackIncrement("elderVisits");
      eventResultEl.textContent = `The Elder reshapes your cell into a ${toKind.label}.`;
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

  const skip = document.createElement("button");
  skip.className = "event-choice subtle";
  skip.type = "button";
  skip.textContent = "Leave";
  skip.addEventListener("click", () => openOverworld());
  eventChoicesEl.appendChild(skip);
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

export function addMutation(key) {
  if (!MUTATIONS[key] || state.mutations.includes(key)) return;
  state.mutations.push(key);
  refreshMutationBonuses();
  pushLog(`Mutation: ${MUTATIONS[key].name}`);
  // Refresh HP cap in case maxHp grew.
  if (state.hp > effectiveMaxHp()) state.hp = effectiveMaxHp();

  // Stomach-granting mutations: prepend a new typed cell to the inventory
  // (new cells enter at the front so items flow through them toward the
  // digestive sac at the back). The player can move it around with arrange
  // mode.
  const def = MUTATIONS[key];
  const stomachKind = def.effect && def.effect.addStomach;
  if (stomachKind && STOMACH_KINDS[stomachKind]) {
    state.inventory.unshift({ kind: stomachKind, item: null });
    pushLog(`Grew a ${STOMACH_KINDS[stomachKind].label}`);
  }
}

export function onDeath() {
  state.running = false;
  openRunEndScreen(false);
}

// Build a fresh run from current meta. Called by Hub "Begin Adventure" and
// by dev tools "Reset Run". Leaves the game in the run scene at row 0.
export function beginNewRun() {
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
  state.scrap = 0;
  state.mana = 0;
  state.lane = 1;
  state.level = 1;
  state.levelTicks = 0;
  state.terminusSpawned = false;
  state.terminusDefeated = false;
  state.entities = [];
  state.levelSchedule = [];
  // Unified inventory: 6 default cells + any extras granted by meta upgrades.
  // The last cell is a digestive sac; everything else is inert until a player
  // mutation adds a typed stomach. Held/Stomach meta upgrades both contribute
  // generic extra cells now that the two zones are unified.
  const baseInventorySize = 6 + (mods.heldCells || 0) + (mods.stomachCells || 0);
  state.inventory = makeFreshInventory(baseInventorySize);
  // Meta upgrades: convert the first N cells to holding pouches, and insert
  // extra digest cells before the existing back-end digest sac.
  if (mods.heldCells > 0) {
    for (let i = 0; i < mods.heldCells && i < state.inventory.length; i++) {
      state.inventory[i].kind = "holding";
    }
  }
  if (mods.stomachCells > 0) {
    let placed = 0;
    for (let i = state.inventory.length - 2; i >= 0 && placed < mods.stomachCells; i--) {
      if (state.inventory[i].kind === "none") {
        state.inventory[i].kind = "digest";
        placed++;
      }
    }
  }
  state.selected = null;
  state.arrangeMode = false;
  state.buffs = {};
  state.shield = 0;
  state.blessings = [];
  state.regenCounter = 0;
  state.passiveCounter = 0;
  state.growthLevel = 0;
  state.subclass = null;
  state.abilityCooldown = 0;
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
  // Apply lab-unlocked starting mutations.
  if (state.meta.labUnlocks) {
    for (const key of Object.keys(state.meta.labUnlocks)) {
      if (MUTATIONS[key] && !state.mutations.includes(key)) {
        addMutation(key);
      }
    }
  }
  state.map = generateRunMap();
  state.mapNode = { row: 0, col: 0 };
  state._petBonuses = getPetBonuses();
  refreshDailies();
  closeModal();
  setScene("run");
  updatePauseBtn();
  renderAll();
  showBanner("— Level 1: Start —");
}

// Legacy alias retained so dev tools and run-end keep working.
export function restartRun() {
  beginNewRun();
}

// Return to the village hub. Used after run-end and from a future "give up"
// button. Stops the tick loop by leaving scene !== "run".
export function goToHub() {
  state.running = false;
  state.paused = true;
  setScene("hub");
  closeModal();
  renderHub();
}

export function renderHub() {
  const line = document.getElementById("hub-meta-line");
  if (line && state.meta) {
    line.textContent = `XP: ${state.meta.availableXp} · 🪙 ${state.meta.gold || 0} · 🔩 ${state.meta.scrap || 0} · 🔮 ${state.meta.mana || 0} · 💠 ${state.meta.gems || 0}`;
  }
  const hubSlime = document.querySelector(".hub-slime");
  if (hubSlime) hubSlime.textContent = getEquippedSkinEmoji();
}

// ---------- Run end + meta menu ----------
// Guard so re-opening the run-end screen from the meta menu doesn't re-award XP.
let runEndAwarded = false;

export function openRunEndScreen(victory) {
  state.paused = true;
  updatePauseBtn();

  syncRunStats();
  const xp = calculateRunXp(state.runStats);
  if (!runEndAwarded) {
    grantXp(state.meta, xp.total);
    state.meta.gold = (state.meta.gold || 0) + (state.gold || 0);
    state.meta.scrap = (state.meta.scrap || 0) + (state.scrap || 0);
    state.meta.mana = (state.meta.mana || 0) + (state.mana || 0);
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
    ? `Victory! Reached Level ${state.level}.`
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

export function openMetaMenu() {
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

// ---------- Mutation Lab (hub building, uses scrap/mana) ----------
const LAB_RECIPES = [
  { id: "acidic_skin", name: "Acidic Skin", desc: "Reflect 1 damage to attackers", icon: "🧪", cost: { scrap: 5 } },
  { id: "iron_stomach", name: "Iron Stomach", desc: "Digest items 50% faster", icon: "⚙️", cost: { scrap: 8 } },
  { id: "crystalline_membrane", name: "Crystalline Membrane", desc: "-1 damage from all sources", icon: "💎", cost: { scrap: 12 } },
  { id: "pulsing_core", name: "Pulsing Core", desc: "Regen 1 HP every 6 ticks", icon: "💗", cost: { mana: 5 } },
  { id: "bouncy_body", name: "Bouncy Body", desc: "25% chance to dodge attacks", icon: "🟢", cost: { mana: 8 } },
  { id: "magnetic_membrane", name: "Magnetic Membrane", desc: "Auto-collect items in adjacent lanes", icon: "🧲", cost: { mana: 10 } },
  { id: "hungry_void", name: "Hungry Void", desc: "Heal 2 HP every time you digest", icon: "🕳️", cost: { scrap: 6, mana: 6 } },
];

export function openMutationLab() {
  const wrap = document.createElement("div");
  wrap.className = "meta-menu";

  const header = document.createElement("div");
  header.className = "meta-header";
  header.textContent = `🔩 Scrap: ${state.meta.scrap || 0} · 🔮 Mana: ${state.meta.mana || 0}`;
  wrap.appendChild(header);

  const desc = document.createElement("div");
  desc.style.cssText = "color:#aaa;font-size:12px;margin-bottom:8px;";
  desc.textContent = "Spend scrap and mana earned from digesting items to unlock starting mutations for future runs.";
  wrap.appendChild(desc);

  const grid = document.createElement("div");
  grid.className = "meta-grid";

  for (const recipe of LAB_RECIPES) {
    const owned = !!(state.meta.labUnlocks && state.meta.labUnlocks[recipe.id]);
    const card = document.createElement("div");
    card.className = "meta-upgrade";

    const costParts = [];
    if (recipe.cost.scrap) costParts.push(`🔩${recipe.cost.scrap}`);
    if (recipe.cost.mana) costParts.push(`🔮${recipe.cost.mana}`);
    const canAfford =
      (!recipe.cost.scrap || (state.meta.scrap || 0) >= recipe.cost.scrap) &&
      (!recipe.cost.mana || (state.meta.mana || 0) >= recipe.cost.mana);

    if (owned) card.classList.add("owned");
    else if (canAfford) card.classList.add("available");
    else card.classList.add("unavailable");

    const name = document.createElement("div");
    name.className = "meta-name";
    name.textContent = `${recipe.icon} ${recipe.name}`;
    card.appendChild(name);

    const descEl = document.createElement("div");
    descEl.className = "meta-desc";
    descEl.textContent = recipe.desc;
    card.appendChild(descEl);

    const foot = document.createElement("div");
    foot.className = "meta-foot";
    foot.textContent = owned ? "✓ Unlocked" : costParts.join(" + ");
    card.appendChild(foot);

    if (!owned && canAfford) {
      card.addEventListener("click", () => {
        if (recipe.cost.scrap) state.meta.scrap -= recipe.cost.scrap;
        if (recipe.cost.mana) state.meta.mana -= recipe.cost.mana;
        if (!state.meta.labUnlocks) state.meta.labUnlocks = {};
        state.meta.labUnlocks[recipe.id] = true;
        saveMeta(state.meta);
        trackIncrement("labRecipes");
        openMutationLab();
      });
    }
    grid.appendChild(card);
  }

  wrap.appendChild(grid);

  openModal({
    title: "🧬 Mutation Lab",
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

// ---------- Wardrobe (cosmetics) ----------
const WARDROBE_SKINS = [
  { id: "default", name: "Classic Slime", emoji: "🟢", desc: "The original. Simple. Hungry.", color: "#3a8a3a", unlocked: true },
  { id: "moss", name: "Mosscloak", emoji: "🌿", desc: "Draped in living moss and tiny ferns.", color: "#2a6a2a", cost: { gold: 0 } },
  { id: "amber", name: "Amber Heart", emoji: "🟡", desc: "Crystallized tree resin, warm to the touch.", color: "#b8860b", cost: { gold: 50 } },
  { id: "clockwork", name: "Cogslime", emoji: "⚙️", desc: "Gears visible through translucent gel.", color: "#8a7a5a", cost: { scrap: 15 } },
  { id: "mycelium", name: "Sporeling", emoji: "🍄", desc: "Threaded with bioluminescent mycelium.", color: "#6a3a6a", cost: { mana: 10 } },
  { id: "frost", name: "Frostbloom", emoji: "🧊", desc: "Frozen dew clings to a pale blue body.", color: "#5a8aaa", cost: { gold: 80 } },
  { id: "magma", name: "Cinder Gel", emoji: "🔥", desc: "Molten veins glow beneath dark slag.", color: "#8a3a2a", cost: { scrap: 10, mana: 10 } },
  { id: "void", name: "Nullslime", emoji: "🔮", desc: "Translucent purple. Stars drift inside.", color: "#4a2a6a", cost: { mana: 20 } },
  { id: "bark", name: "Barkbound", emoji: "🌲", desc: "Encased in living wood. Roots trail behind.", color: "#5a4a2a", cost: { scrap: 8, gold: 40 } },
  { id: "gilded", name: "Gilded Ooze", emoji: "✨", desc: "Leafed in gold recovered from the depths.", color: "#aa8a2a", cost: { gold: 150 } },
  { id: "crystal", name: "Prism Jelly", emoji: "💎", desc: "Refracts light in all directions.", color: "#7aaabb", cost: { scrap: 15, mana: 15 } },
];

export function openWardrobe() {
  const wrap = document.createElement("div");
  wrap.className = "meta-menu";

  const header = document.createElement("div");
  header.className = "meta-header";
  header.textContent = `🪙 ${state.meta.totalXp || 0} XP · 🔩 ${state.meta.scrap || 0} · 🔮 ${state.meta.mana || 0}`;
  wrap.appendChild(header);

  if (!state.meta.wardrobe) state.meta.wardrobe = { owned: ["default"], equipped: "default" };
  const wd = state.meta.wardrobe;

  const grid = document.createElement("div");
  grid.className = "meta-grid";

  for (const skin of WARDROBE_SKINS) {
    const owned = skin.unlocked || wd.owned.includes(skin.id);
    const equipped = wd.equipped === skin.id;
    const card = document.createElement("div");
    card.className = "meta-upgrade";

    let canAfford = true;
    let costStr = "";
    if (!owned && skin.cost) {
      const parts = [];
      if (skin.cost.gold && (state.meta.totalXp || 0) < skin.cost.gold) canAfford = false;
      if (skin.cost.scrap && (state.meta.scrap || 0) < skin.cost.scrap) canAfford = false;
      if (skin.cost.mana && (state.meta.mana || 0) < skin.cost.mana) canAfford = false;
      if (skin.cost.gold) parts.push(`${skin.cost.gold}🪙`);
      if (skin.cost.scrap) parts.push(`${skin.cost.scrap}🔩`);
      if (skin.cost.mana) parts.push(`${skin.cost.mana}🔮`);
      costStr = parts.join(" + ");
    }

    if (equipped) card.classList.add("owned");
    else if (owned) card.classList.add("available");
    else if (canAfford) card.classList.add("available");
    else card.classList.add("unavailable");

    const name = document.createElement("div");
    name.className = "meta-name";
    name.textContent = `${skin.emoji} ${skin.name}`;
    card.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "meta-desc";
    desc.textContent = skin.desc;
    card.appendChild(desc);

    const foot = document.createElement("div");
    foot.className = "meta-foot";
    if (equipped) foot.textContent = "✓ Equipped";
    else if (owned) foot.textContent = "Click to equip";
    else foot.textContent = costStr || "Free";
    card.appendChild(foot);

    card.addEventListener("click", () => {
      if (equipped) return;
      if (owned) {
        wd.equipped = skin.id;
        saveMeta(state.meta);
        openWardrobe();
        return;
      }
      if (!canAfford) return;
      if (skin.cost?.gold) state.meta.totalXp -= skin.cost.gold;
      if (skin.cost?.scrap) state.meta.scrap -= skin.cost.scrap;
      if (skin.cost?.mana) state.meta.mana -= skin.cost.mana;
      wd.owned.push(skin.id);
      wd.equipped = skin.id;
      saveMeta(state.meta);
      trackIncrement("skinsOwned");
      openWardrobe();
    });
    grid.appendChild(card);
  }

  wrap.appendChild(grid);

  openModal({
    title: "🎨 Wardrobe",
    bodyEl: wrap,
    actions: [{
      label: "Back to Hub",
      primary: true,
      onClick: () => { closeModal(); renderHub(); },
    }],
  });
}

function getEquippedSkinEmoji() {
  if (!state.meta?.wardrobe?.equipped) return "🟢";
  const skin = WARDROBE_SKINS.find(s => s.id === state.meta.wardrobe.equipped);
  return skin ? skin.emoji : "🟢";
}

// Placeholder hub screens for not-yet-built buildings.
export function openPlaceholder(title, msg) {
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
