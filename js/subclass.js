// SlimeVenture — slime subclass definitions and active ability logic
//
// An Evolution Pool event offers 3 random subclasses per run. Choosing one
// modifies the slime's passives and grants a unique active ability triggered
// by the ability button (or long-press).

import { state, SLIME_COL, LANES, pick } from "./state.js";
import { ITEMS } from "./data.js";
import { STOMACH_KINDS } from "./mutations.js";
import {
  effectiveMaxHp,
  randomItemKey,
  tryPickupItem,
  pushIntoInventory,
  makeItemInstance,
} from "./inventory.js";
import { spawnEntity, removeEntity } from "./combat.js";
import { pushLog, floatText, showBanner, renderAll, updateHUD } from "./ui.js";

// ---------- Subclass definitions ----------
export const SUBCLASSES = {
  stoneslime: {
    id: "stoneslime",
    name: "Stoneslime",
    emoji: "🪨",
    desc: "Immune to obstacle damage. Slower lane changes (1-tick delay). +5 max HP.",
    color: "#7a6f5a",
    passive: {
      obstacleImmune: true,
      maxHpBonus: 5,
    },
    ability: {
      name: "Fortify",
      desc: "Gain a 10-HP shield.",
      cooldown: 12,
      icon: "🛡️",
    },
  },
  spitslime: {
    id: "spitslime",
    name: "Spitslime",
    emoji: "💦",
    desc: "Eject a held item as a projectile. Deals 8 + item-based bonus damage.",
    color: "#5a8a6f",
    passive: {},
    ability: {
      name: "Spit",
      desc: "Launch the first held item at the nearest enemy.",
      cooldown: 6,
      icon: "💦",
    },
  },
  cauldronslime: {
    id: "cauldronslime",
    name: "Cauldronslime",
    emoji: "🧪",
    desc: "Active ability consumes 2 items and produces 1 of higher rarity. +1 stomach cell.",
    color: "#6a5a8a",
    passive: {
      extraStomach: 1,
    },
    ability: {
      name: "Brew",
      desc: "Consume 2 items to create 1 of higher rarity.",
      cooldown: 10,
      icon: "🧪",
    },
  },
  sparkslime: {
    id: "sparkslime",
    name: "Sparkslime",
    emoji: "⚡",
    desc: "Burns enemies on contact. Active ability deals AoE fire damage to all lanes.",
    color: "#8a6a3a",
    passive: {
      contactBurn: 3,
    },
    ability: {
      name: "Firestorm",
      desc: "Deal 5 fire damage to all enemies on screen.",
      cooldown: 15,
      icon: "🔥",
    },
  },
  acidslime: {
    id: "acidslime",
    name: "Acidslime",
    emoji: "🟢",
    desc: "All cells can digest. Digest yields doubled. Items cannot be held.",
    color: "#3a8a3a",
    passive: {
      allDigest: true,
      digestYieldMult: 2,
    },
    ability: {
      name: "Dissolve",
      desc: "Instantly digest the frontmost item.",
      cooldown: 8,
      icon: "🫠",
    },
  },
};

export const SUBCLASS_KEYS = Object.keys(SUBCLASSES);

// Roll 3 random subclasses for an evolution pool.
export function rollSubclassChoices() {
  const shuffled = [...SUBCLASS_KEYS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

// Apply the chosen subclass to the current run.
export function applySubclass(key) {
  const def = SUBCLASSES[key];
  if (!def) return;
  state.subclass = key;
  state.abilityCooldown = 0;

  // Apply passive bonuses.
  if (def.passive.maxHpBonus) {
    state.maxHp += def.passive.maxHpBonus;
    state.hp = Math.min(effectiveMaxHp(), state.hp + def.passive.maxHpBonus);
  }
  if (def.passive.extraStomach) {
    for (let i = 0; i < def.passive.extraStomach; i++) {
      state.inventory.unshift({ kind: "digest", item: null });
    }
  }
  if (def.passive.allDigest) {
    for (const cell of state.inventory) {
      if (cell.kind === "none") cell.kind = "digest";
    }
  }

  pushLog(`Evolved into ${def.name}!`);
  showBanner(`${def.emoji} ${def.name}!`, 2000);
  renderAll();
  updateHUD();
}

// Execute the active ability for the current subclass.
export function useAbility() {
  if (!state.subclass || !state.running) return;
  if (state.abilityCooldown > 0) {
    pushLog(`Ability on cooldown (${state.abilityCooldown} ticks)`);
    return;
  }
  const def = SUBCLASSES[state.subclass];
  if (!def) return;
  const slimeEl = document.getElementById("slime");

  switch (state.subclass) {
    case "stoneslime": {
      state.shield = (state.shield || 0) + 10;
      state.buffs.shield = Infinity;
      floatText("heal", "+🛡10", slimeEl);
      pushLog("Fortify! +10 shield");
      break;
    }
    case "spitslime": {
      // Find first item in inventory and eject it.
      let ejected = null;
      let ejectedIdx = -1;
      for (let i = 0; i < state.inventory.length; i++) {
        if (state.inventory[i].item) {
          ejected = state.inventory[i].item;
          ejectedIdx = i;
          break;
        }
      }
      if (!ejected) {
        pushLog("Nothing to spit!");
        return;
      }
      state.inventory[ejectedIdx].item = null;
      const baseDmg = 8;
      const bonusDmg = ejected.def.digest?.enemyDamage || ejected.def.held?.attack || 3;
      const totalDmg = baseDmg + bonusDmg;
      const target = state.entities.find(
        (e) =>
          (e.type === "enemy" || e.type === "terminus") &&
          e.lane === state.lane &&
          e.col === SLIME_COL + 1
      );
      if (target) {
        target.hp -= totalDmg;
        floatText("dmg", `-${totalDmg}`, slimeEl);
        pushLog(`Spit ${ejected.def.name} at ${target.def.name} for ${totalDmg}!`);
        if (target.hp <= 0) {
          state.runStats.enemiesDefeated++;
          removeEntity(target);
          pushLog(`${target.def.name} destroyed!`);
        }
      } else {
        pushLog(`Spit ${ejected.def.name} into the void...`);
      }
      break;
    }
    case "cauldronslime": {
      // Consume 2 items, produce 1 of higher rarity.
      const RARITY_UP = { common: "uncommon", uncommon: "rare", rare: "legendary", legendary: "legendary" };
      const occupied = [];
      state.inventory.forEach((cell, idx) => {
        if (cell.item) occupied.push(idx);
      });
      if (occupied.length < 2) {
        pushLog("Need 2 items to brew!");
        return;
      }
      const a = state.inventory[occupied[0]].item;
      const b = state.inventory[occupied[1]].item;
      state.inventory[occupied[0]].item = null;
      state.inventory[occupied[1]].item = null;
      const bestRarity = RARITY_UP[a.def.rarity] || RARITY_UP[b.def.rarity] || "uncommon";
      const newKey = randomItemKey(bestRarity);
      tryPickupItem(newKey);
      pushLog(`Brewed ${a.def.name} + ${b.def.name} → ${ITEMS[newKey].name}!`);
      break;
    }
    case "sparkslime": {
      // AoE fire damage to all enemies.
      const targets = state.entities.filter(
        (e) => e.type === "enemy" || e.type === "terminus"
      );
      for (const t of targets) {
        t.hp -= 5;
        if (t.hp <= 0) {
          state.runStats.enemiesDefeated++;
          removeEntity(t);
        }
      }
      floatText("dmg", "🔥AOE 5", slimeEl);
      pushLog(`Firestorm hits ${targets.length} enemies!`);
      break;
    }
    case "acidslime": {
      // Instantly digest the frontmost item.
      let found = false;
      for (let i = 0; i < state.inventory.length; i++) {
        const cell = state.inventory[i];
        if (cell.item) {
          const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
          // Force-finish digestion.
          cell.item.digestProgress = cell.item.def.digestTime;
          pushLog(`Dissolved ${cell.item.def.name} instantly!`);
          found = true;
          break;
        }
      }
      if (!found) {
        pushLog("Nothing to dissolve!");
        return;
      }
      break;
    }
    default:
      return;
  }

  state.abilityCooldown = def.ability.cooldown;
  renderAll();
  updateHUD();
}

// Called each tick to count down the ability cooldown.
export function tickAbilityCooldown() {
  if (state.abilityCooldown > 0) state.abilityCooldown--;
}

// Get the subclass passive config for the current run (or empty object).
export function getSubclassPassive() {
  if (!state.subclass) return {};
  return SUBCLASSES[state.subclass]?.passive || {};
}
