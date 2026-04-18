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
import { pushLog, floatText, showBanner, renderAll, updateHUD, launchProjectile } from "./ui.js";

// ---------- Subclass definitions ----------
export const SUBCLASSES = {
  stoneslime: {
    id: "stoneslime",
    name: "Petrified Ooze",
    emoji: "🪨",
    desc: "Encased in mineral deposits. Immune to obstacle damage. +5 max HP.",
    color: "#7a6f5a",
    passive: {
      obstacleImmune: true,
      maxHpBonus: 5,
    },
    ability: {
      name: "Calcify",
      desc: "Harden your shell — gain a 10-HP shield.",
      cooldown: 12,
      icon: "🛡️",
    },
  },
  spitslime: {
    id: "spitslime",
    name: "Thornspitter",
    emoji: "🌿",
    desc: "Launch digesting items as thorned projectiles across the lane.",
    color: "#5a8a6f",
    passive: {},
    ability: {
      name: "Thorn Spit",
      desc: "Eject the first held item at the nearest enemy in your lane.",
      cooldown: 6,
      icon: "🌿",
    },
  },
  cauldronslime: {
    id: "cauldronslime",
    name: "Alchemical Gel",
    emoji: "🧪",
    desc: "A living crucible. Consumes 2 items to forge 1 of higher rarity. +1 stomach cell.",
    color: "#6a5a8a",
    passive: {
      extraStomach: 1,
    },
    ability: {
      name: "Transmute",
      desc: "Dissolve 2 items inside you to create 1 of higher rarity.",
      cooldown: 10,
      icon: "🧪",
    },
  },
  sparkslime: {
    id: "sparkslime",
    name: "Ember Jelly",
    emoji: "🔥",
    desc: "Geothermal heat burns enemies on contact. Active: AoE fire burst.",
    color: "#8a6a3a",
    passive: {
      contactBurn: 3,
    },
    ability: {
      name: "Eruption",
      desc: "Deal 5 fire damage to all enemies on screen.",
      cooldown: 15,
      icon: "🔥",
    },
  },
  acidslime: {
    id: "acidslime",
    name: "Corrosive Mass",
    emoji: "🟢",
    desc: "Every cell digests. Yields doubled. Nothing survives inside you.",
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
  cogslime: {
    id: "cogslime",
    name: "Cogwork Symbiote",
    emoji: "⚙️",
    desc: "Fused with clockwork. Scrap drops doubled. Active: overclock for haste.",
    color: "#8a7a5a",
    passive: {
      scrapMult: 2,
    },
    ability: {
      name: "Overclock",
      desc: "Gain 10 ticks of haste.",
      cooldown: 12,
      icon: "⚙️",
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
      // Find first enemy in slime's lane across the whole path.
      const targets = state.entities
        .filter(
          (e) =>
            (e.type === "enemy" || e.type === "terminus") &&
            e.lane === state.lane &&
            e.col > SLIME_COL
        )
        .sort((a, b) => a.col - b.col);
      const target = targets[0] || null;
      // Launch visual projectile.
      launchProjectile(ejected.def.emoji, state.lane, target ? target.col : 5);
      if (target) {
        setTimeout(() => {
          target.hp -= totalDmg;
          floatText("dmg", `-${totalDmg}`, slimeEl);
          pushLog(`Spit ${ejected.def.name} at ${target.def.name} for ${totalDmg}!`);
          if (target.hp <= 0) {
            state.runStats.enemiesDefeated++;
            removeEntity(target);
            pushLog(`${target.def.name} destroyed!`);
          }
          renderAll();
          updateHUD();
        }, 300);
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
    case "cogslime": {
      state.buffs.haste = (state.buffs.haste || 0) + 10;
      floatText("heal", "⚙️ HASTE", slimeEl);
      pushLog("Overclock! +10 ticks of haste");
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
