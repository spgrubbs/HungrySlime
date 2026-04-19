// SlimeVenture — slime class definitions, specializations, and active abilities
//
// A Class Selection event offers 3 random classes per run. Choosing one
// modifies the slime's passives and grants a unique active ability triggered
// by the ability button (or long-press). At level 5, a specialization further
// refines the chosen class with one of two upgrades.

import { state, SLIME_COL, LANES, pick } from "./state.js";
import { ITEMS } from "./data.js";
import { STOMACH_KINDS } from "./mutations.js";
import {
  effectiveMaxHp,
  randomItemKey,
  tryPickupItem,
  pushIntoInventory,
  makeItemInstance,
  addGold,
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
  gourmetslime: {
    id: "gourmetslime",
    name: "Epicurean Ooze",
    emoji: "🍽️",
    desc: "A refined palate. Can rearrange stomach cells. Ferment speeds all digestion.",
    color: "#6a5a3a",
    passive: {
      cellSwap: true,
    },
    ability: {
      name: "Ferment",
      desc: "Advance all digesting items by 50% of their remaining time.",
      cooldown: 10,
      icon: "🍽️",
    },
  },
};

export const SUBCLASS_KEYS = Object.keys(SUBCLASSES);

// ---------- Specializations (2 per class) ----------
export const SPECIALIZATIONS = {
  stoneslime: [
    {
      id: "ironhide",
      name: "Ironhide",
      emoji: "🏔️",
      desc: "Calcify grants double shield (+20). +3 max HP.",
      passive: { maxHpBonus: 3 },
      abilityMod: { shieldAmount: 20 },
    },
    {
      id: "juggernaut",
      name: "Juggernaut",
      emoji: "💪",
      desc: "Blocking obstacles deal no damage. +2 attack.",
      passive: { obstacleImmune: true, attackBonus: 2 },
    },
  ],
  spitslime: [
    {
      id: "volley",
      name: "Volley",
      emoji: "🎯",
      desc: "Thorn Spit hits all enemies in your lane. -2 cooldown.",
      abilityMod: { hitAllInLane: true, cooldownReduction: 2 },
    },
    {
      id: "venomspitter",
      name: "Venomspitter",
      emoji: "☠️",
      desc: "Spit applies 3 ticks of poison. +50% spit damage.",
      abilityMod: { poisonTicks: 3, damageMult: 1.5 },
    },
  ],
  cauldronslime: [
    {
      id: "philosopher",
      name: "Philosopher",
      emoji: "📜",
      desc: "Transmute requires only 1 item. Result is always rare+.",
      abilityMod: { singleItem: true, minRarity: "rare" },
    },
    {
      id: "goldweaver",
      name: "Goldweaver",
      emoji: "💰",
      desc: "Transmuted items grant 15 bonus gold. +1 stomach cell.",
      passive: { extraStomach: 1 },
      abilityMod: { bonusGold: 15 },
    },
  ],
  sparkslime: [
    {
      id: "inferno",
      name: "Inferno",
      emoji: "🌋",
      desc: "Eruption deals 10 damage (doubled). Contact burn +2.",
      passive: { contactBurn: 2 },
      abilityMod: { aoeDamage: 10 },
    },
    {
      id: "pyroclasm",
      name: "Pyroclasm",
      emoji: "☄️",
      desc: "Eruption inflicts 3-tick burn on all enemies.",
      abilityMod: { burnTicks: 3 },
    },
  ],
  acidslime: [
    {
      id: "vitriolic",
      name: "Vitriolic",
      emoji: "💧",
      desc: "Digesting items heals 2 HP. Dissolve cooldown -3.",
      passive: { digestHeal: 2 },
      abilityMod: { cooldownReduction: 3 },
    },
    {
      id: "caustic",
      name: "Caustic",
      emoji: "🫠",
      desc: "Digesting items deals 5 damage to adjacent enemy. Triple yield.",
      passive: { digestDamage: 5, digestYieldMult: 3 },
    },
  ],
  cogslime: [
    {
      id: "turbocharge",
      name: "Turbocharge",
      emoji: "⚡",
      desc: "Haste lasts 20 ticks (doubled). +2 attack during haste.",
      abilityMod: { hasteDuration: 20 },
      passive: { hasteAttackBonus: 2 },
    },
    {
      id: "machinist",
      name: "Machinist",
      emoji: "🔧",
      desc: "Scrap drops tripled. Clockwork-tagged items digest instantly.",
      passive: { scrapMult: 3, clockworkInstantDigest: true },
    },
  ],
  gourmetslime: [
    {
      id: "sommelier",
      name: "Sommelier",
      emoji: "🍷",
      desc: "Ferment advances by 75%. +1 gold per item digested.",
      abilityMod: { fermentPct: 0.75 },
      passive: { digestGoldBonus: 1 },
    },
    {
      id: "gourmand",
      name: "Gourmand",
      emoji: "🍕",
      desc: "Digesting any item heals 3 HP. Cursed items don't deal damage.",
      passive: { digestHeal: 3, cursedImmune: true },
    },
  ],
};

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

  const specMod = state._specDef?.abilityMod || {};

  switch (state.subclass) {
    case "stoneslime": {
      const shieldAmt = specMod.shieldAmount || 10;
      state.shield = (state.shield || 0) + shieldAmt;
      state.buffs.shield = Infinity;
      floatText("heal", `+🛡${shieldAmt}`, slimeEl);
      pushLog(`Fortify! +${shieldAmt} shield`);
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
      const dmgMult = specMod.damageMult || 1;
      const totalDmg = Math.round((baseDmg + bonusDmg) * dmgMult);
      const hitAll = specMod.hitAllInLane;
      const targets = state.entities
        .filter(
          (e) =>
            (e.type === "enemy" || e.type === "terminus") &&
            e.lane === state.lane &&
            e.col > SLIME_COL
        )
        .sort((a, b) => a.col - b.col);
      const hitTargets = hitAll ? targets : targets.slice(0, 1);
      const firstTarget = targets[0] || null;
      launchProjectile(ejected.def.emoji, state.lane, firstTarget ? firstTarget.col : 5);
      if (hitTargets.length > 0) {
        setTimeout(() => {
          for (const target of hitTargets) {
            target.hp -= totalDmg;
            if (specMod.poisonTicks) {
              target.poisonTicks = (target.poisonTicks || 0) + specMod.poisonTicks;
            }
            floatText("dmg", `-${totalDmg}`, slimeEl);
            pushLog(`Spit ${ejected.def.name} at ${target.def.name} for ${totalDmg}!`);
            if (target.hp <= 0) {
              state.runStats.enemiesDefeated++;
              removeEntity(target);
              pushLog(`${target.def.name} destroyed!`);
            }
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
      const RARITY_UP = { common: "uncommon", uncommon: "rare", rare: "legendary", legendary: "legendary" };
      const occupied = [];
      state.inventory.forEach((cell, idx) => {
        if (cell.item) occupied.push(idx);
      });
      const needCount = specMod.singleItem ? 1 : 2;
      if (occupied.length < needCount) {
        pushLog(`Need ${needCount} item${needCount > 1 ? "s" : ""} to brew!`);
        return;
      }
      const a = state.inventory[occupied[0]].item;
      const names = [a.def.name];
      state.inventory[occupied[0]].item = null;
      let bestRarity = RARITY_UP[a.def.rarity] || "uncommon";
      if (!specMod.singleItem && occupied.length >= 2) {
        const b = state.inventory[occupied[1]].item;
        names.push(b.def.name);
        state.inventory[occupied[1]].item = null;
        bestRarity = RARITY_UP[a.def.rarity] || RARITY_UP[b.def.rarity] || "uncommon";
      }
      if (specMod.minRarity) {
        const RANK = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
        if ((RANK[bestRarity] || 0) < (RANK[specMod.minRarity] || 0)) {
          bestRarity = specMod.minRarity;
        }
      }
      const newKey = randomItemKey(bestRarity);
      tryPickupItem(newKey);
      if (specMod.bonusGold) addGold(specMod.bonusGold);
      pushLog(`Brewed ${names.join(" + ")} → ${ITEMS[newKey].name}!`);
      break;
    }
    case "sparkslime": {
      const aoeDmg = specMod.aoeDamage || 5;
      const targets = state.entities.filter(
        (e) => e.type === "enemy" || e.type === "terminus"
      );
      for (const t of targets) {
        t.hp -= aoeDmg;
        if (specMod.burnTicks) {
          t.burnTicks = (t.burnTicks || 0) + specMod.burnTicks;
        }
        if (t.hp <= 0) {
          state.runStats.enemiesDefeated++;
          removeEntity(t);
        }
      }
      floatText("dmg", `🔥AOE ${aoeDmg}`, slimeEl);
      pushLog(`Firestorm hits ${targets.length} enemies for ${aoeDmg}!`);
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
      const hasteDur = specMod.hasteDuration || 10;
      state.buffs.haste = (state.buffs.haste || 0) + hasteDur;
      floatText("heal", "⚙️ HASTE", slimeEl);
      pushLog(`Overclock! +${hasteDur} ticks of haste`);
      break;
    }
    case "gourmetslime": {
      const fermentPct = specMod.fermentPct || 0.5;
      let advanced = 0;
      for (const cell of state.inventory) {
        if (!cell.item) continue;
        const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
        if (!kindCfg.digests) continue;
        const remaining = cell.item.def.digestTime - cell.item.digestProgress;
        if (remaining > 0) {
          cell.item.digestProgress += remaining * fermentPct;
          advanced++;
        }
      }
      if (advanced === 0) {
        pushLog("Nothing fermenting!");
        return;
      }
      floatText("heal", "🍽️ FERMENT", slimeEl);
      pushLog(`Fermented ${advanced} items!`);
      break;
    }
    default:
      return;
  }

  const cdReduction = specMod.cooldownReduction || 0;
  state.abilityCooldown = Math.max(1, def.ability.cooldown - cdReduction);
  renderAll();
  updateHUD();
}

// Called each tick to count down the ability cooldown.
export function tickAbilityCooldown() {
  if (state.abilityCooldown > 0) state.abilityCooldown--;
}

// Apply a specialization to the current class.
export function applySpecialization(spec) {
  state.spec = spec.id;
  state._specDef = spec;

  if (spec.passive) {
    if (spec.passive.maxHpBonus) {
      state.maxHp += spec.passive.maxHpBonus;
      state.hp = Math.min(effectiveMaxHp(), state.hp + spec.passive.maxHpBonus);
    }
    if (spec.passive.extraStomach) {
      for (let i = 0; i < spec.passive.extraStomach; i++) {
        state.inventory.unshift({ kind: "digest", item: null });
      }
    }
    if (spec.passive.attackBonus) {
      // Stored on spec, applied via getSubclassPassive
    }
  }

  pushLog(`Specialized: ${spec.name}!`);
  showBanner(`${spec.emoji} ${spec.name}!`, 2000);
  renderAll();
  updateHUD();
}

// Get the subclass passive config for the current run (or empty object).
// Merges base class passive with specialization passive.
export function getSubclassPassive() {
  if (!state.subclass) return {};
  const base = { ...(SUBCLASSES[state.subclass]?.passive || {}) };
  if (state._specDef?.passive) {
    for (const [k, v] of Object.entries(state._specDef.passive)) {
      if (typeof v === "number" && typeof base[k] === "number") {
        base[k] = (base[k] || 0) + v;
      } else if (typeof v === "number") {
        base[k] = v;
      } else {
        base[k] = v;
      }
    }
  }
  return base;
}
