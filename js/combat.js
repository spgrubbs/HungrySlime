// SlimeVenture — combat, encounters, entity spawning

import {
  state,
  devState,
  $,
  COLS,
  LANES,
  SLIME_COL,
  rand,
  pick,
  currentNodeConfig,
} from "./state.js";
import {
  ITEMS,
  ENEMIES,
  ENEMY_POOL_BY_LEVEL,
  TERMINI,
  OBSTACLES,
  LOCATIONS,
  SHOP_PRICES,
  SHRINE_BLESSINGS,
} from "./data.js";
import { getMutationBonuses } from "./mutations.js";
import {
  tryPickupItem,
  getHeldBonuses,
  addGold,
  randomItemKey,
  effectiveMaxHp,
} from "./inventory.js";
import {
  pushLog,
  floatText,
  showBanner,
  openModal,
  closeModal,
  updatePauseBtn,
  updateHUD,
  renderAll,
} from "./ui.js";

// ---------- DOM refs ----------
const slimeEl = $("slime");

// ---------- Entity management ----------
let entityIdSeq = 1;

export function spawnEntity(def, type, lane, col) {
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

export function removeEntity(ent) {
  const idx = state.entities.indexOf(ent);
  if (idx >= 0) state.entities.splice(idx, 1);
}

export function spawnRandomPathEntity() {
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
    const def = ENEMIES[enemyKey];
    if (def.swarm) {
      for (let l = 0; l < LANES; l++) {
        if (!state.entities.some((e) => e.lane === l && e.col === col)) {
          spawnEntity({ ...def }, "enemy", l, col);
        }
      }
    } else if (def.mimic) {
      spawnEntity(
        { id: def.id, emoji: "🎁", itemKey: null, mimicDef: def },
        "item",
        lane,
        col
      );
    } else {
      spawnEntity(def, "enemy", lane, col);
    }
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
    const locRoll = Math.random();
    let loc;
    if (locRoll < 0.35) loc = LOCATIONS.fountain;
    else if (locRoll < 0.6) loc = LOCATIONS.shop;
    else if (locRoll < 0.8) loc = LOCATIONS.shrine;
    else loc = LOCATIONS.merchant;
    spawnEntity(loc, "location", lane, col);
  }
}

export function spawnTerminus() {
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

// ---------- Encounters ----------
// Apply damage from an obstacle to the slime, taking held / mutation
// reductions and god-mode into account.
export function applyObstacleDamageToSlime(ent) {
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  const ironSkin = state.buffs.iron_skin ? 1 : 0;
  const reduction =
    getHeldBonuses().damageReduction + (mut.damageReduction || 0) + ironSkin;
  const rawDmg = Math.max(0, (ent.def.damage || 0) - reduction);
  let dmg = devState.godMode ? 0 : rawDmg;
  if (dmg > 0 && state.shield > 0) {
    const absorbed = Math.min(dmg, state.shield);
    state.shield -= absorbed;
    dmg -= absorbed;
    floatText("heal", `🛡${absorbed}`, slimeEl);
    if (state.shield <= 0) {
      delete state.buffs.shield;
      pushLog("Shield broken!");
    }
  }
  state.hp -= dmg;
  pushLog(`${ent.def.name} hits you for ${dmg}`);
  if (dmg > 0) floatText("dmg", `-${dmg}`, slimeEl);
  return dmg;
}

// The slime "encounters" an entity that is now in its cell. Could be from the
// move loop (the entity slid in) or from a lane change (the slime walked onto
// it). Triggers the appropriate interaction.
export function handleEncounter(ent) {
  if (ent.type === "enemy" || ent.type === "terminus") {
    // Slime walked into a stray enemy at col 0. Run a single combat round and
    // bump any survivor back to col 1 so the normal adjacent-combat rules
    // take over from the next tick.
    resolveCombatRound(ent);
    if (state.entities.includes(ent)) {
      ent.col = SLIME_COL + 1;
    }
  } else if (ent.type === "item") {
    if (ent.def.mimicDef) {
      // Mimic reveals itself!
      showBanner("It's a Mimic!", 1200);
      pushLog("Mimic reveals itself!");
      ent.type = "enemy";
      ent.def = ent.def.mimicDef;
      ent.hp = ent.def.hp;
      ent.maxHp = ent.def.hp;
      resolveCombatRound(ent);
      if (state.entities.includes(ent)) {
        ent.col = SLIME_COL + 1;
      }
    } else {
      tryPickupItem(ent.def.itemKey);
      removeEntity(ent);
    }
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
export function handleSlideInteraction(mover, blocker) {
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

function applyEnemyDeathEffects(def) {
  if (def.onDeath?.burn) {
    state.buffs.burn = (state.buffs.burn || 0) + def.onDeath.burn;
    pushLog(`${def.name}'s dying flame burns you!`);
  }
}

export function resolveCombatRound(enemy) {
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
    const goldenTouch = state.buffs.golden_touch ? 1.5 : 1;
    const goldDrop = Math.round(baseGold * (mut.enemyGoldMult || 1) * goldenTouch);
    addGold(goldDrop);
    pushLog(`Defeated ${enemy.def.name} (+${goldDrop}🪙)`);
    if (enemy.def.dropChance && enemy.def.dropPool && Math.random() < enemy.def.dropChance) {
      const key = pick(enemy.def.dropPool);
      tryPickupItem(key);
    }
    applyEnemyDeathEffects(enemy.def);
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
  const ironSkin = state.buffs.iron_skin ? 1 : 0;
  const reduction = bonuses.damageReduction + (mut.damageReduction || 0) + ironSkin;
  let dmg = devState.godMode ? 0 : Math.max(0, rawDmg - reduction);
  // Shield buff absorbs damage before HP.
  if (dmg > 0 && state.shield > 0) {
    const absorbed = Math.min(dmg, state.shield);
    state.shield -= absorbed;
    dmg -= absorbed;
    floatText("heal", `🛡${absorbed}`, slimeEl);
    if (state.shield <= 0) {
      delete state.buffs.shield;
      pushLog("Shield broken!");
    }
  }
  state.hp -= dmg;
  if (dmg > 0) floatText("dmg", `-${dmg}`, slimeEl);

  // Thorns: Acidic Skin mutation + Thorn Aura blessing.
  const totalThorns = (mut.thorns || 0) + (state.buffs.thorn_aura ? 1 : 0);
  if (dmg > 0 && totalThorns > 0) {
    enemy.hp -= totalThorns;
    floatText("dmg", `-${totalThorns}`, slimeEl);
    if (enemy.hp <= 0) {
      state.runStats.enemiesDefeated++;
      const baseGold = enemy.def.gold || 0;
      const goldDrop = Math.round(baseGold * (mut.enemyGoldMult || 1));
      addGold(goldDrop);
      pushLog(`${enemy.def.name} dissolved on your skin (+${goldDrop}🪙)`);
      applyEnemyDeathEffects(enemy.def);
      removeEntity(enemy);
    }
  }
}

// ---------- Locations ----------
export function openLocation(ent) {
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
    openShop(ent);
  } else if (loc.id === "shrine") {
    openShrine(ent);
  } else if (loc.id === "merchant") {
    openMerchant(ent);
  }
}

function leaveLocation(ent) {
  removeEntity(ent);
  closeModal();
  state.paused = false;
  updatePauseBtn();
  renderAll();
}

function openShop(ent) {
  const numItems = 3 + Math.min(2, Math.floor(state.level / 2));
  const stock = [];
  for (let i = 0; i < numItems; i++) {
    const r = Math.random();
    let rarity;
    if (state.level >= 4 && r < 0.05) rarity = "legendary";
    else if (state.level >= 2 && r < 0.2) rarity = "rare";
    else if (r < 0.5) rarity = "uncommon";
    else rarity = "common";
    const key = randomItemKey(rarity);
    const def = ITEMS[key];
    const price = SHOP_PRICES[def.rarity] || 10;
    stock.push({ key, def, price });
  }

  const wrap = document.createElement("div");
  wrap.className = "shop-grid";

  for (const item of stock) {
    const card = document.createElement("div");
    card.className = "shop-card";
    card.innerHTML = `<span class="shop-emoji">${item.def.emoji}</span><span class="shop-name">${item.def.name}</span><span class="shop-price">${item.price}🪙</span>`;
    if (state.gold < item.price) card.classList.add("too-expensive");
    card.addEventListener("click", () => {
      if (state.gold < item.price || card.classList.contains("sold")) return;
      state.gold -= item.price;
      tryPickupItem(item.key);
      card.classList.add("sold");
      card.querySelector(".shop-price").textContent = "SOLD";
      updateHUD();
    });
    wrap.appendChild(card);
  }

  openModal({
    title: "🏪 Shop",
    bodyEl: wrap,
    actions: [
      {
        label: "Leave Shop",
        primary: true,
        onClick: () => leaveLocation(ent),
      },
    ],
  });
}

function openShrine(ent) {
  const keys = Object.keys(SHRINE_BLESSINGS);
  const available = keys.filter((k) => !state.blessings.includes(k));
  if (available.length === 0) {
    openModal({
      title: "🪬 Shrine",
      body: "The shrine is dim — you've already received all blessings.",
      actions: [{ label: "Leave", primary: true, onClick: () => leaveLocation(ent) }],
    });
    return;
  }
  const shuffled = available.sort(() => Math.random() - 0.5);
  const choices = shuffled.slice(0, Math.min(3, shuffled.length));

  const wrap = document.createElement("div");
  wrap.className = "shrine-grid";

  for (const key of choices) {
    const b = SHRINE_BLESSINGS[key];
    const card = document.createElement("div");
    card.className = "shrine-card";
    card.innerHTML = `<span class="shrine-icon">${b.icon}</span><span class="shrine-name">${b.name}</span><span class="shrine-desc">${b.desc}</span>`;
    card.addEventListener("click", () => {
      state.blessings.push(key);
      if (b.buff === "vitality") {
        state.maxHp += 5;
        state.hp = Math.min(effectiveMaxHp(), state.hp + 5);
        pushLog("Vitality: +5 max HP");
      } else {
        state.buffs[b.buff] = Infinity;
        pushLog(`Blessing: ${b.name}`);
      }
      updateHUD();
      leaveLocation(ent);
    });
    wrap.appendChild(card);
  }

  openModal({
    title: "🪬 Shrine",
    bodyEl: wrap,
    actions: [{ label: "Walk Away", onClick: () => leaveLocation(ent) }],
  });
}

function openMerchant(ent) {
  const sellable = [];
  state.inventory.forEach((cell, idx) => {
    if (cell.item) {
      const price = Math.floor((SHOP_PRICES[cell.item.def.rarity] || 10) / 2);
      sellable.push({ idx, item: cell.item, price });
    }
  });

  if (sellable.length === 0) {
    openModal({
      title: "🐪 Merchant Caravan",
      body: "The merchant eyes your empty pockets and shrugs.",
      actions: [{ label: "Leave", primary: true, onClick: () => leaveLocation(ent) }],
    });
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "shop-grid";

  for (const s of sellable) {
    const card = document.createElement("div");
    card.className = "shop-card sellable";
    card.innerHTML = `<span class="shop-emoji">${s.item.def.emoji}</span><span class="shop-name">${s.item.def.name}</span><span class="shop-price">Sell ${s.price}🪙</span>`;
    card.addEventListener("click", () => {
      if (card.classList.contains("sold")) return;
      addGold(s.price);
      state.inventory[s.idx].item = null;
      card.classList.add("sold");
      card.querySelector(".shop-price").textContent = "SOLD";
      pushLog(`Sold ${s.item.def.name} for ${s.price}🪙`);
      updateHUD();
    });
    wrap.appendChild(card);
  }

  openModal({
    title: "🐪 Merchant Caravan",
    bodyEl: wrap,
    actions: [
      {
        label: "Leave",
        primary: true,
        onClick: () => leaveLocation(ent),
      },
    ],
  });
}
