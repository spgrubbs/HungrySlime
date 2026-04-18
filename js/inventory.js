// SlimeVenture — inventory management and rendering

import { state, devState, $, rand, pick, SLIME_COL } from "./state.js";
import { ITEMS, ITEM_POOL_BY_RARITY } from "./data.js";
import { STOMACH_KINDS, MUTATIONS, getMutationBonuses } from "./mutations.js";
import { pushLog, floatText, renderAll, updateHUD, formatItemTooltip } from "./ui.js";

// ---------- DOM refs ----------
const slimeEl = $("slime");
const inventoryZoneEl = $("inventory-zone");
const arrangeBtn = $("arrange-btn");
const growBtn = $("grow-btn");
const discardBtn = $("discard-btn");
const mutationStripEl = $("mutation-strip");

// ---------- Item instance helpers ----------
export function makeItemInstance(key) {
  const def = ITEMS[key];
  if (!def) return null;
  return { key, def, digestProgress: 0 };
}

export function randomItemKey(rarity = null) {
  if (!rarity) {
    // Rarity roll scales with level: higher levels have better drop odds.
    const r = Math.random();
    const lvl = state.level || 1;
    if (lvl >= 4 && r < 0.03) rarity = "legendary";
    else if (lvl >= 2 && r < 0.08 + lvl * 0.02) rarity = "rare";
    else if (r < 0.25) rarity = "uncommon";
    else rarity = "common";
  }
  const pool = ITEM_POOL_BY_RARITY[rarity] || ITEM_POOL_BY_RARITY.common;
  if (pool.length === 0) return pick(ITEM_POOL_BY_RARITY.common);
  return pick(pool);
}

// ---------- Inventory ----------
// Build a fresh inventory of `size` cells. The last cell is a default
// digestive sac; all earlier cells are inert. Used at run start.
export function makeFreshInventory(size) {
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
export function pushIntoInventory(itemInstance) {
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

export function tryPickupItem(key) {
  const inst = makeItemInstance(key);
  if (!inst) return false;
  // Sticky buff: bypass cascade, place directly into a digesting cell.
  if (state.buffs.sticky) {
    for (let i = state.inventory.length - 1; i >= 0; i--) {
      const cell = state.inventory[i];
      const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
      if (kindCfg.digests && !cell.item) {
        cell.item = inst;
        inst.digestProgress = 0;
        pushLog(`Sticky! ${ITEMS[key].name} sent to stomach`);
        return true;
      }
    }
  }
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
export function getHeldBonuses() {
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
  if (state.buffs.gearmind) attack += 1;
  return { attack, damageReduction, maxHpBonus, regen, regenInterval };
}

// Centralised positive-gold source so run-stats stay accurate.
export function addGold(amount) {
  if (!amount || amount <= 0) return;
  state.gold += amount;
  state.runStats.goldEarned += amount;
}

export function applyDigest(item, yieldMult = 1) {
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
    const BUFF_DURATIONS = {
      shield: Infinity,
      poison_coat: 12,
      burn_aura: 10,
      haste: 8,
      acid: 10,
      sticky: 10,
      bloat: 12,
    };
    if (d.buff === "shield") {
      state.shield = (state.shield || 0) + 15;
      state.buffs.shield = Infinity;
      pushLog(`Gained shield (${state.shield} HP)`);
    } else if (d.buff === "bloat") {
      if (!state.buffs.bloat) {
        state.inventory.push({ kind: "none", item: null });
        state.inventory.push({ kind: "none", item: null });
      }
      state.buffs.bloat = BUFF_DURATIONS.bloat;
      pushLog("Bloat! +2 temporary cells");
    } else {
      state.buffs[d.buff] = BUFF_DURATIONS[d.buff] || 10;
      pushLog(`Gained buff: ${d.buff}`);
    }
  }
  // Secondary resources from item tags.
  const tags = item.def.tags || [];
  if (tags.includes("metal")) {
    let scrapAmt = Math.ceil(2 * yieldMult);
    if (state.subclass === "cogslime") scrapAmt *= 2;
    state.scrap = (state.scrap || 0) + scrapAmt;
    pushLog(`+${scrapAmt} scrap`);
  }
  if (tags.includes("elemental")) {
    const manaAmt = Math.ceil(2 * yieldMult);
    state.mana = (state.mana || 0) + manaAmt;
    pushLog(`+${manaAmt} mana`);
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

export function effectiveMaxHp() {
  const { maxHpBonus } = getHeldBonuses();
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  return state.maxHp + maxHpBonus + (mut.maxHpBonus || 0);
}

// ---------- Inventory interactions (tap-to-select-then-place) ----------
// Two interaction modes share the same selection state:
//   default → tap any cell with an item to select it, tap another cell to
//             swap items only (cell kinds stay put).
//   arrange → tap any cell to select it, tap another to swap the entire cell
//             (kind + item). Lets the player reposition stomachs they earned.
export function onSlotClick(index) {
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

  // Default mode: tap to select (for discard). Items are locked in place.
  if (!state.selected) {
    if (cell.item) state.selected = { index };
  } else if (state.selected.index === index) {
    state.selected = null;
  } else {
    // Tap another cell = change selection (no swapping).
    if (cell.item) {
      state.selected = { index };
    } else {
      state.selected = null;
    }
  }
  renderInventory();
  updateHUD();
}

export function discardSelected() {
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

export function toggleArrangeMode() {
  state.arrangeMode = !state.arrangeMode;
  state.selected = null;
  renderInventory();
}

export function growCost() {
  if (devState.freeGrowth) return 0;
  const base = 10 + state.growthLevel * 5;
  const mult = state.runMods?.growCostMult || 1;
  return Math.max(1, Math.round(base * mult));
}

export function growSlime() {
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

// ---------- Inventory rendering ----------
export function renderInventory() {
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
      slot.title = formatItemTooltip(item.def) + `\n[${kindCfg.label}]`;
    } else {
      slot.title = kindCfg.label + " — " + kindCfg.desc;
    }
    slot.addEventListener("click", () => onSlotClick(idx));
    inventoryZoneEl.appendChild(slot);
  });
}
