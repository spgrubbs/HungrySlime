// SlimeVenture — Mutations (relics)
// Mutations are powerful passive effects awarded by treasure nodes and rare
// rewards. They live outside inventory and persist for the whole run.
// Slime-themed: each one is a structural change to the slime's body chemistry.
//
// Effects are read at the appropriate spot in the game loop via the helpers
// at the bottom of this module.

export const MUTATIONS = {
  acidic_skin: {
    id: "acidic_skin",
    name: "Acidic Skin",
    icon: "🧪",
    desc: "Reflect 1 damage to attackers when struck.",
    effect: { thorns: 1 },
  },
  bouncy_body: {
    id: "bouncy_body",
    name: "Bouncy Body",
    icon: "🟢",
    desc: "25% chance to dodge incoming attacks.",
    effect: { dodgeChance: 0.25 },
  },
  pulsing_core: {
    id: "pulsing_core",
    name: "Pulsing Core",
    icon: "💗",
    desc: "Regenerate 1 HP every 6 ticks.",
    effect: { passiveRegen: 1, passiveRegenInterval: 6 },
  },
  forked_pseudopod: {
    id: "forked_pseudopod",
    name: "Forked Pseudopod",
    icon: "🦑",
    desc: "+1 attack permanently.",
    effect: { attackBonus: 1 },
  },
  calcium_deposits: {
    id: "calcium_deposits",
    name: "Calcium Deposits",
    icon: "🦴",
    desc: "+8 max HP.",
    effect: { maxHpBonus: 8 },
  },
  iron_stomach: {
    id: "iron_stomach",
    name: "Iron Stomach",
    icon: "⚙️",
    desc: "Digest items 50% faster.",
    effect: { digestSpeedMult: 1.5 },
  },
  magnetic_membrane: {
    id: "magnetic_membrane",
    name: "Magnetic Membrane",
    icon: "🧲",
    desc: "Auto-collect items in adjacent lanes.",
    effect: { magneticBody: true },
  },
  greedy_vacuole: {
    id: "greedy_vacuole",
    name: "Greedy Vacuole",
    icon: "💰",
    desc: "+50% gold from defeated enemies.",
    effect: { enemyGoldMult: 1.5 },
  },
  crystalline_membrane: {
    id: "crystalline_membrane",
    name: "Crystalline Membrane",
    icon: "💎",
    desc: "-1 damage from all sources.",
    effect: { damageReduction: 1 },
  },
  hungry_void: {
    id: "hungry_void",
    name: "Hungry Void",
    icon: "🕳️",
    desc: "Heal 2 HP every time you digest something.",
    effect: { digestHeal: 2 },
  },
  swift_ooze: {
    id: "swift_ooze",
    name: "Swift Ooze",
    icon: "💨",
    desc: "Lane changes restore 1 HP (max once per tick).",
    effect: { laneRegen: 1 },
  },
  glowing_core: {
    id: "glowing_core",
    name: "Glowing Core",
    icon: "✨",
    desc: "Start each level with +5 HP.",
    effect: { levelStartHeal: 5 },
  },
};

export const MUTATION_KEYS = Object.keys(MUTATIONS);

// Pull a random mutation the slime doesn't already own. Returns null if all
// mutations have been collected.
export function rollMutation(ownedSet) {
  const pool = MUTATION_KEYS.filter((k) => !ownedSet.has(k));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Roll N distinct mutations as a choice menu.
export function rollMutationChoices(ownedSet, n = 3) {
  const pool = MUTATION_KEYS.filter((k) => !ownedSet.has(k));
  // Shuffle by sort
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Fold all owned mutations into a flat bonus accumulator. Counterpart to
// getHeldBonuses() in game.js — read every tick.
export function getMutationBonuses(ownedKeys) {
  const out = {
    thorns: 0,
    dodgeChance: 0,
    passiveRegen: 0,
    passiveRegenInterval: 0,
    attackBonus: 0,
    maxHpBonus: 0,
    digestSpeedMult: 1,
    magneticBody: false,
    enemyGoldMult: 1,
    damageReduction: 0,
    digestHeal: 0,
    laneRegen: 0,
    levelStartHeal: 0,
  };
  for (const key of ownedKeys || []) {
    const def = MUTATIONS[key];
    if (!def) continue;
    const e = def.effect || {};
    if (e.thorns) out.thorns += e.thorns;
    if (e.dodgeChance) out.dodgeChance = Math.max(out.dodgeChance, e.dodgeChance);
    if (e.passiveRegen) {
      out.passiveRegen += e.passiveRegen;
      out.passiveRegenInterval = e.passiveRegenInterval || out.passiveRegenInterval;
    }
    if (e.attackBonus) out.attackBonus += e.attackBonus;
    if (e.maxHpBonus) out.maxHpBonus += e.maxHpBonus;
    if (e.digestSpeedMult) out.digestSpeedMult *= e.digestSpeedMult;
    if (e.magneticBody) out.magneticBody = true;
    if (e.enemyGoldMult) out.enemyGoldMult *= e.enemyGoldMult;
    if (e.damageReduction) out.damageReduction += e.damageReduction;
    if (e.digestHeal) out.digestHeal += e.digestHeal;
    if (e.laneRegen) out.laneRegen += e.laneRegen;
    if (e.levelStartHeal) out.levelStartHeal += e.levelStartHeal;
  }
  return out;
}
