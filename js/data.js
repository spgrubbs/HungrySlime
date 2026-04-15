// SlimeVenture — data definitions
// Items, enemies, obstacles, locations. Kept data-driven per GDD §12.4.

export const RARITIES = {
  common: "C",
  uncommon: "U",
  rare: "R",
  legendary: "L",
};

/** Items. Shapes simplified to 1x1 for now (Tetris-style shapes are planned). */
export const ITEMS = {
  rusty_sword: {
    id: "rusty_sword",
    name: "Rusty Sword",
    emoji: "🗡️",
    rarity: "common",
    held: { attack: 2 },
    digest: { gold: 3 },
    digestTime: 8,
    tags: ["weapon", "metal"],
    flavor: "+2 attack while held.",
  },
  healing_herb: {
    id: "healing_herb",
    name: "Healing Herb",
    emoji: "🌿",
    rarity: "common",
    held: { regen: 1, regenInterval: 5 },
    digest: { heal: 10 },
    digestTime: 3,
    tags: ["organic", "healing"],
    flavor: "Regen 1 HP / 5 ticks while held.",
  },
  gold_nugget: {
    id: "gold_nugget",
    name: "Gold Nugget",
    emoji: "🪙",
    rarity: "common",
    held: null,
    digest: { gold: 15 },
    digestTime: 4,
    tags: ["mineral"],
    flavor: "Eat for +15 gold.",
  },
  flame_core: {
    id: "flame_core",
    name: "Flame Core",
    emoji: "🔥",
    rarity: "uncommon",
    held: { attack: 1 },
    digest: { heal: 2, buff: "burn_aura" },
    digestTime: 6,
    tags: ["elemental", "fire"],
    flavor: "+1 attack while held. Eat for Burn Aura.",
  },
  shield_fragment: {
    id: "shield_fragment",
    name: "Shield Fragment",
    emoji: "🛡️",
    rarity: "uncommon",
    held: { damageReduction: 1 },
    digest: { gold: 5 },
    digestTime: 10,
    tags: ["armor", "metal"],
    flavor: "-1 damage taken while held.",
  },
  slime_jelly: {
    id: "slime_jelly",
    name: "Slime Jelly",
    emoji: "🟣",
    rarity: "common",
    held: { maxHpBonus: 1 },
    digest: { heal: 5, permMaxHp: 1 },
    digestTime: 2,
    tags: ["organic", "slime"],
    flavor: "+1 max HP while held; eat for perm +1 max HP.",
  },
  bomb: {
    id: "bomb",
    name: "Bomb",
    emoji: "💣",
    rarity: "uncommon",
    held: null,
    digest: { enemyDamage: 20 },
    digestTime: 1,
    tags: ["explosive"],
    flavor: "Eat to hurl 20 dmg at the enemy in your lane.",
  },
};

export const ITEM_POOL_BY_RARITY = {
  common: ["rusty_sword", "healing_herb", "gold_nugget", "slime_jelly"],
  uncommon: ["flame_core", "shield_fragment", "bomb"],
  rare: [],
  legendary: [],
};

/** Enemies */
export const ENEMIES = {
  green_blob: {
    id: "green_blob",
    name: "Green Blob",
    emoji: "🟩",
    hp: 5,
    attack: 1,
    speed: 1,
    gold: 2,
    dropChance: 0,
    cost: 1,
  },
  skeleton: {
    id: "skeleton",
    name: "Skeleton",
    emoji: "💀",
    hp: 10,
    attack: 3,
    speed: 1,
    gold: 5,
    dropChance: 0.3,
    dropPool: ["rusty_sword"],
    cost: 2,
  },
  fire_imp: {
    id: "fire_imp",
    name: "Fire Imp",
    emoji: "👺",
    hp: 8,
    attack: 2,
    speed: 1,
    gold: 3,
    dropChance: 0.25,
    dropPool: ["flame_core"],
    cost: 2,
  },
  stone_golem: {
    id: "stone_golem",
    name: "Stone Golem",
    emoji: "🗿",
    hp: 20,
    attack: 4,
    speed: 2,
    gold: 10,
    dropChance: 0.5,
    dropPool: ["shield_fragment"],
    cost: 4,
  },
};

export const ENEMY_POOL_BY_LEVEL = {
  1: ["green_blob", "green_blob", "skeleton"],
  2: ["green_blob", "skeleton", "fire_imp"],
  3: ["skeleton", "fire_imp", "stone_golem"],
  4: ["fire_imp", "stone_golem", "stone_golem"],
  5: ["stone_golem", "stone_golem"],
};

/** Terminus enemies per level */
export const TERMINI = {
  1: { id: "t1", name: "Bloated Blob", emoji: "🫠", hp: 20, attack: 2, speed: 1, gold: 15, dropChance: 1, dropPool: ["flame_core", "shield_fragment"] },
  2: { id: "t2", name: "Bone Knight", emoji: "☠️", hp: 35, attack: 4, speed: 1, gold: 25, dropChance: 1, dropPool: ["rusty_sword", "shield_fragment"] },
  3: { id: "t3", name: "Ember Drake", emoji: "🐉", hp: 50, attack: 5, speed: 1, gold: 35, dropChance: 1, dropPool: ["flame_core"] },
  4: { id: "t4", name: "Ancient Golem", emoji: "🧱", hp: 70, attack: 6, speed: 2, gold: 50, dropChance: 1, dropPool: ["shield_fragment"] },
  5: { id: "t5", name: "Gelatinous King", emoji: "👑", hp: 100, attack: 7, speed: 1, gold: 100, dropChance: 1, dropPool: ["bomb"] },
};

/** Obstacles */
export const OBSTACLES = {
  rock: { id: "rock", name: "Rock", emoji: "🪨", damage: 3, cost: 1 },
  spikes: { id: "spikes", name: "Spikes", emoji: "⚡", damage: 5, cost: 2 },
};

/** Locations */
export const LOCATIONS = {
  fountain: { id: "fountain", name: "Fountain", emoji: "⛲", cost: 0 },
  shop: { id: "shop", name: "Shop", emoji: "🏪", cost: 0 },
};
