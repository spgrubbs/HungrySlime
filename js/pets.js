// SlimeVenture — Pet / Ranch System
// Hub building where players hatch, feed, and level pets that grant passive
// run bonuses. Pets cost resources to acquire and feed, acting as a resource
// sink with long-term payoff.

import { state } from "./state.js";
import { saveMeta } from "./meta.js";
import {
  openModal,
  closeModal,
  showBanner,
  pushLog,
  updateHUD,
} from "./ui.js";
import { trackEvent } from "./quests.js";

// ---------- Pet definitions ----------
export const PET_DEFS = {
  moss_pup: {
    id: "moss_pup",
    name: "Moss Pup",
    emoji: "🐸",
    desc: "A tiny amphibian coated in living moss. Boosts gold from enemies.",
    buyCost: { gold: 20 },
    feedCost: { gold: 10 },
    bonusPerLevel: { enemyGoldPct: 5 },
    maxLevel: 5,
  },
  gear_beetle: {
    id: "gear_beetle",
    name: "Gear Beetle",
    emoji: "🪲",
    desc: "A clockwork insect that scrounges extra scrap.",
    buyCost: { scrap: 15 },
    feedCost: { scrap: 8 },
    bonusPerLevel: { bonusScrap: 1 },
    maxLevel: 5,
  },
  ember_sprite: {
    id: "ember_sprite",
    name: "Ember Sprite",
    emoji: "🔥",
    desc: "A hovering flame mote. Gathers residual mana.",
    buyCost: { mana: 15 },
    feedCost: { mana: 8 },
    bonusPerLevel: { bonusMana: 1 },
    maxLevel: 5,
  },
  root_hare: {
    id: "root_hare",
    name: "Root Hare",
    emoji: "🐇",
    desc: "A burrowing creature that exudes restorative sap.",
    buyCost: { gold: 40 },
    feedCost: { gold: 15 },
    bonusPerLevel: { passiveHeal: 1 },
    maxLevel: 5,
  },
  clockwork_owl: {
    id: "clockwork_owl",
    name: "Clockwork Owl",
    emoji: "🦉",
    desc: "A mechanical raptor that spots hidden treasure.",
    buyCost: { scrap: 25 },
    feedCost: { scrap: 12 },
    bonusPerLevel: { itemDropPct: 10 },
    maxLevel: 5,
  },
  spore_puffling: {
    id: "spore_puffling",
    name: "Spore Puffling",
    emoji: "🍄",
    desc: "A puffy mushroom companion. Speeds digestion.",
    buyCost: { mana: 20 },
    feedCost: { mana: 10 },
    bonusPerLevel: { digestSpeedPct: 5 },
    maxLevel: 5,
  },
  crystal_moth: {
    id: "crystal_moth",
    name: "Crystal Moth",
    emoji: "🦋",
    desc: "A gossamer insect with prismatic wings. Deflects harm.",
    buyCost: { scrap: 30, mana: 30 },
    feedCost: { scrap: 10, mana: 10 },
    bonusPerLevel: { damageReduction: 1 },
    maxLevel: 3,
  },
  golden_toad: {
    id: "golden_toad",
    name: "Golden Toad",
    emoji: "🐸",
    desc: "A gilded amphibian that sweats gold dust.",
    buyCost: { gold: 100 },
    feedCost: { gold: 25 },
    bonusPerLevel: { passiveGold: 1 },
    maxLevel: 5,
  },
};

export const PET_KEYS = Object.keys(PET_DEFS);

// ---------- Ranch helpers ----------
function ensureRanch() {
  if (!state.meta.ranch) {
    state.meta.ranch = { pets: {}, activeSlots: 3 };
  }
  return state.meta.ranch;
}

export function ownsPet(id) {
  const ranch = ensureRanch();
  return !!ranch.pets[id];
}

export function canAfford(cost, source) {
  if (!cost) return false;
  if (cost.gold && (source.gold || 0) < cost.gold) return false;
  if (cost.scrap && (source.scrap || 0) < cost.scrap) return false;
  if (cost.mana && (source.mana || 0) < cost.mana) return false;
  return true;
}

function payCost(cost, source) {
  if (cost.gold) source.gold = (source.gold || 0) - cost.gold;
  if (cost.scrap) source.scrap = (source.scrap || 0) - cost.scrap;
  if (cost.mana) source.mana = (source.mana || 0) - cost.mana;
}

function feedXpRequired(level) {
  return 3 + level * 2;
}

export function buyPet(id) {
  const def = PET_DEFS[id];
  if (!def || ownsPet(id)) return false;
  if (!canAfford(def.buyCost, state.meta)) return false;
  payCost(def.buyCost, state.meta);
  const ranch = ensureRanch();
  ranch.pets[id] = { level: 1, xp: 0, active: false };
  saveMeta(state.meta);
  trackEvent("petsOwned", Object.keys(ranch.pets).length);
  return true;
}

export function feedPet(id) {
  const def = PET_DEFS[id];
  if (!def || !ownsPet(id)) return false;
  const ranch = ensureRanch();
  const pet = ranch.pets[id];
  if (pet.level >= def.maxLevel) return false;
  const scaledCost = {};
  for (const [k, v] of Object.entries(def.feedCost)) {
    scaledCost[k] = Math.ceil(v * (1 + (pet.level - 1) * 0.5));
  }
  if (!canAfford(scaledCost, state.meta)) return false;
  payCost(scaledCost, state.meta);
  pet.xp++;
  const needed = feedXpRequired(pet.level);
  if (pet.xp >= needed) {
    pet.level++;
    pet.xp = 0;
    const maxLvl = Math.max(...Object.values(ranch.pets).map((p) => p.level));
    trackEvent("petMaxLevel", maxLvl);
  }
  saveMeta(state.meta);
  return true;
}

export function togglePetActive(id) {
  const ranch = ensureRanch();
  const pet = ranch.pets[id];
  if (!pet) return;
  if (pet.active) {
    pet.active = false;
  } else {
    const activeCount = Object.values(ranch.pets).filter((p) => p.active).length;
    if (activeCount >= ranch.activeSlots) return;
    pet.active = true;
  }
  saveMeta(state.meta);
}

// ---------- Pet bonuses (applied at run start) ----------
export function getPetBonuses() {
  const out = {
    enemyGoldPct: 0,
    bonusScrap: 0,
    bonusMana: 0,
    passiveHeal: 0,
    itemDropPct: 0,
    digestSpeedPct: 0,
    damageReduction: 0,
    passiveGold: 0,
  };
  const ranch = state.meta?.ranch;
  if (!ranch) return out;
  for (const [id, pet] of Object.entries(ranch.pets)) {
    if (!pet.active) continue;
    const def = PET_DEFS[id];
    if (!def) continue;
    for (const [bonus, perLevel] of Object.entries(def.bonusPerLevel)) {
      out[bonus] = (out[bonus] || 0) + perLevel * pet.level;
    }
  }
  return out;
}

// ---------- Ranch UI (hub building) ----------
export function openRanch() {
  const ranch = ensureRanch();

  const wrap = document.createElement("div");
  wrap.className = "meta-menu";

  const header = document.createElement("div");
  header.className = "meta-header";
  const activeCount = Object.values(ranch.pets).filter((p) => p.active).length;
  header.textContent = `🪙 ${state.meta.gold || 0}  🔩 ${state.meta.scrap || 0}  🔮 ${state.meta.mana || 0}  ·  Active: ${activeCount}/${ranch.activeSlots}`;
  wrap.appendChild(header);

  const desc = document.createElement("div");
  desc.style.cssText = "color:#aaa;font-size:12px;margin-bottom:8px;";
  desc.textContent = "Raise pets to earn passive bonuses during runs. Up to 3 active pets accompany you.";
  wrap.appendChild(desc);

  const grid = document.createElement("div");
  grid.className = "meta-grid";

  for (const id of PET_KEYS) {
    const def = PET_DEFS[id];
    const owned = ownsPet(id);
    const pet = ranch.pets[id];

    const card = document.createElement("div");
    card.className = "meta-upgrade";

    if (owned && pet.active) card.classList.add("owned");
    else if (owned) card.classList.add("available");
    else if (canAfford(def.buyCost, state.meta)) card.classList.add("available");
    else card.classList.add("unavailable");

    const name = document.createElement("div");
    name.className = "meta-name";
    name.textContent = `${def.emoji} ${def.name}`;
    card.appendChild(name);

    const descEl = document.createElement("div");
    descEl.className = "meta-desc";
    if (owned) {
      const bonusDesc = Object.entries(def.bonusPerLevel)
        .map(([k, v]) => `${formatBonus(k, v * pet.level)}`)
        .join(", ");
      descEl.textContent = `Lv ${pet.level}/${def.maxLevel} · ${bonusDesc}`;
    } else {
      descEl.textContent = def.desc;
    }
    card.appendChild(descEl);

    const foot = document.createElement("div");
    foot.className = "meta-foot";

    if (owned) {
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:6px;";

      if (pet.level < def.maxLevel) {
        const feedBtn = document.createElement("button");
        feedBtn.style.cssText = "font-size:11px;padding:2px 6px;";
        const scaledCost = {};
        for (const [k, v] of Object.entries(def.feedCost)) {
          scaledCost[k] = Math.ceil(v * (1 + (pet.level - 1) * 0.5));
        }
        const feedStr = costString(scaledCost);
        const xpNeeded = feedXpRequired(pet.level);
        feedBtn.textContent = `Feed (${feedStr}) [${pet.xp}/${xpNeeded}]`;
        feedBtn.disabled = !canAfford(scaledCost, state.meta);
        feedBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (feedPet(id)) openRanch();
        });
        actions.appendChild(feedBtn);
      } else {
        const maxEl = document.createElement("span");
        maxEl.textContent = "MAX";
        maxEl.style.cssText = "color:#ffd84d;font-size:11px;";
        actions.appendChild(maxEl);
      }

      const toggleBtn = document.createElement("button");
      toggleBtn.style.cssText = "font-size:11px;padding:2px 6px;";
      toggleBtn.textContent = pet.active ? "✓ Active" : "Set Active";
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePetActive(id);
        openRanch();
      });
      actions.appendChild(toggleBtn);

      foot.appendChild(actions);
    } else {
      foot.textContent = costString(def.buyCost);
      card.addEventListener("click", () => {
        if (buyPet(id)) openRanch();
      });
    }
    card.appendChild(foot);
    grid.appendChild(card);
  }

  wrap.appendChild(grid);

  openModal({
    title: "🐾 Slime Ranch",
    bodyEl: wrap,
    actions: [
      {
        label: "Back to Hub",
        primary: true,
        onClick: () => {
          closeModal();
        },
      },
    ],
  });
}

function costString(cost) {
  const parts = [];
  if (cost.gold) parts.push(`${cost.gold}🪙`);
  if (cost.scrap) parts.push(`${cost.scrap}🔩`);
  if (cost.mana) parts.push(`${cost.mana}🔮`);
  return parts.join(" + ");
}

function formatBonus(key, value) {
  const labels = {
    enemyGoldPct: `+${value}% enemy gold`,
    bonusScrap: `+${value} scrap/digest`,
    bonusMana: `+${value} mana/digest`,
    passiveHeal: `+${value} HP/8 ticks`,
    itemDropPct: `+${value}% item drops`,
    digestSpeedPct: `+${value}% digest speed`,
    damageReduction: `-${value} damage taken`,
    passiveGold: `+${value} gold/tick`,
  };
  return labels[key] || `${key}: ${value}`;
}
