// SlimeVenture — Meta-Progression
// Persistent Slime XP, upgrade unlocks, and the modifier accumulator that
// transforms a fresh run's starting state based on those unlocks.
//
// Storage: a single JSON blob in localStorage under STORAGE_KEY. The save
// format is versioned so schema changes can reset without crashing.

const STORAGE_KEY = "slimeventure_meta_v1";
const SCHEMA_VERSION = 1;

// ---- Tier gates: total-XP-earned thresholds ----
// Tier access is based on lifetime XP (not spendable XP) so a player who
// buys out a tier can't fall back out of access to that tier.
export const TIER_THRESHOLDS = {
  1: 0,
  2: 50,
  3: 150,
};

// ---- Upgrade catalog ----
// Each entry's `effect` is folded into a flat mods object by
// computeRunModifiers() and then applied at run start.
export const UPGRADES = {
  // --- Tier 1: Body ---
  hp1: {
    tier: 1,
    cost: 5,
    name: "Hardy I",
    desc: "+5 max HP",
    effect: { maxHpBonus: 5 },
  },
  hp2: {
    tier: 1,
    cost: 10,
    name: "Hardy II",
    desc: "+5 max HP",
    requires: "hp1",
    effect: { maxHpBonus: 5 },
  },
  hp3: {
    tier: 1,
    cost: 20,
    name: "Hardy III",
    desc: "+10 max HP",
    requires: "hp2",
    effect: { maxHpBonus: 10 },
  },
  extraHeld: {
    tier: 1,
    cost: 10,
    name: "Extra Held Cell",
    desc: "+1 starting held cell",
    effect: { heldCells: 1 },
  },
  extraStomach: {
    tier: 1,
    cost: 15,
    name: "Bigger Stomach",
    desc: "+1 starting stomach cell",
    effect: { stomachCells: 1 },
  },
  startGold: {
    tier: 1,
    cost: 8,
    name: "Pocket Change",
    desc: "Start each run with 20 gold",
    effect: { startGold: 20 },
  },

  // --- Tier 2: Abilities ---
  quickDigest: {
    tier: 2,
    cost: 20,
    name: "Quick Digest",
    desc: "Digestion 25% faster",
    effect: { digestSpeedMult: 1.25 },
  },
  magneticBody: {
    tier: 2,
    cost: 25,
    name: "Magnetic Body",
    desc: "Auto-collect items from adjacent lanes",
    effect: { magneticBody: true },
  },
  secondStomach: {
    tier: 2,
    cost: 30,
    name: "Second Stomach",
    desc: "+2 starting stomach cells",
    effect: { stomachCells: 2 },
  },
  growDiscount: {
    tier: 2,
    cost: 20,
    name: "Efficient Growth",
    desc: "Growth costs 25% less gold",
    effect: { growCostMult: 0.75 },
  },

  // --- Tier 3: Starting Loadout ---
  startHerb: {
    tier: 3,
    cost: 10,
    name: "Green Thumb",
    desc: "Start with a Healing Herb",
    effect: { startItem: "healing_herb" },
  },
  startSword: {
    tier: 3,
    cost: 15,
    name: "Thorned Awakening",
    desc: "Start with a Thorn Branch",
    effect: { startItem: "thorn_branch" },
  },
  startJelly: {
    tier: 3,
    cost: 18,
    name: "Slime Core",
    desc: "Start with a Slime Jelly",
    effect: { startItem: "slime_jelly" },
  },
  startShield: {
    tier: 3,
    cost: 20,
    name: "Salvaged Plating",
    desc: "Start with a Clockwork Plate",
    effect: { startItem: "clockwork_plate" },
  },
  startFlame: {
    tier: 3,
    cost: 25,
    name: "Geothermal Core",
    desc: "Start with a Magma Geode",
    effect: { startItem: "magma_geode" },
  },
};

const DEFAULT_META = {
  version: SCHEMA_VERSION,
  totalXp: 0,
  availableXp: 0,
  unlocks: {},
  lastRun: null, // { xp, stats } — for display on the meta menu
};

// ---- Persistence ----
export function loadMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshMeta();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SCHEMA_VERSION) return freshMeta();
    return {
      ...freshMeta(),
      ...parsed,
      unlocks: { ...(parsed.unlocks || {}) },
    };
  } catch (e) {
    console.warn("Meta load failed:", e);
    return freshMeta();
  }
}

export function saveMeta(meta) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn("Meta save failed:", e);
  }
}

export function resetMeta() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
  return freshMeta();
}

function freshMeta() {
  return {
    version: SCHEMA_VERSION,
    totalXp: 0,
    availableXp: 0,
    unlocks: {},
    lastRun: null,
    gold: 0,
    scrap: 0,
    mana: 0,
    gems: 0,
  };
}

// ---- XP ----
export function calculateRunXp(stats) {
  const levels = (stats.levelsCompleted || 0) * 5;
  const enemies = stats.enemiesDefeated || 0;
  const gold = Math.floor((stats.goldEarned || 0) / 10);
  const items = (stats.itemsDigested || 0) * 2;
  const boss = stats.bossDefeated ? 50 : 0;
  return {
    total: levels + enemies + gold + items + boss,
    breakdown: { levels, enemies, gold, items, boss },
  };
}

export function grantXp(meta, amount) {
  if (!amount || amount <= 0) return;
  meta.totalXp += amount;
  meta.availableXp += amount;
}

// ---- Unlock rules ----
export function tierUnlocked(meta, tier) {
  return meta.totalXp >= (TIER_THRESHOLDS[tier] || 0);
}

export function isOwned(meta, id) {
  return !!meta.unlocks[id];
}

export function canPurchase(meta, id) {
  const def = UPGRADES[id];
  if (!def) return false;
  if (isOwned(meta, id)) return false;
  if (!tierUnlocked(meta, def.tier)) return false;
  if (def.requires && !isOwned(meta, def.requires)) return false;
  if (meta.availableXp < def.cost) return false;
  return true;
}

export function purchase(meta, id) {
  if (!canPurchase(meta, id)) return false;
  const def = UPGRADES[id];
  meta.availableXp -= def.cost;
  meta.unlocks[id] = true;
  return true;
}

// ---- Modifier fold ----
// Returns a flat accumulator of everything the game needs to apply at the
// start of a run. Default values correspond to "no upgrades owned".
export function computeRunModifiers(meta) {
  const mods = {
    maxHpBonus: 0,
    heldCells: 0,
    stomachCells: 0,
    startGold: 0,
    digestSpeedMult: 1,
    magneticBody: false,
    growCostMult: 1,
    startItems: [],
  };
  if (!meta || !meta.unlocks) return mods;
  for (const id of Object.keys(meta.unlocks)) {
    if (!meta.unlocks[id]) continue;
    const def = UPGRADES[id];
    if (!def || !def.effect) continue;
    const e = def.effect;
    if (e.maxHpBonus) mods.maxHpBonus += e.maxHpBonus;
    if (e.heldCells) mods.heldCells += e.heldCells;
    if (e.stomachCells) mods.stomachCells += e.stomachCells;
    if (e.startGold) mods.startGold += e.startGold;
    if (e.digestSpeedMult) mods.digestSpeedMult *= e.digestSpeedMult;
    if (e.magneticBody) mods.magneticBody = true;
    if (e.growCostMult) mods.growCostMult *= e.growCostMult;
    if (e.startItem) mods.startItems.push(e.startItem);
  }
  return mods;
}
