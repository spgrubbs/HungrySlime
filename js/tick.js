// SlimeVenture — tick loop, entity movement, level progression

import { state, SLIME_COL, LANES, clamp, levelTickLength } from "./state.js";
import { STOMACH_KINDS, getMutationBonuses } from "./mutations.js";
import { getHeldBonuses, effectiveMaxHp, tryPickupItem, applyDigest, addGold } from "./inventory.js";
import { floatText, pushLog, renderAll } from "./ui.js";
import { tickAbilityCooldown, getSubclassPassive } from "./subclass.js";
import {
  handleEncounter,
  handleSlideInteraction,
  removeEntity,
  resolveCombatRound,
  applyObstacleDamageToSlime,
  spawnRandomPathEntity,
  spawnTerminus,
  spawnScheduledEntity,
} from "./combat.js";
import { onLevelComplete, onDeath } from "./scenes.js";

// ---------- DOM refs ----------
const slimeEl = document.getElementById("slime");

// ---------- Tick timer ----------
let tickTimer = null;

export function setTickIntervalMs(ms) {
  state.tickInterval = ms;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, ms);
}

// ---------- Tick logic ----------
export function tick() {
  // Tick only advances during a live run. Hub/overworld/event scenes are inert.
  if (state.scene !== "run" || !state.running || state.paused) return;
  state.tick++;
  state.levelTicks++;

  const mut = state.mutBonuses || getMutationBonuses(state.mutations);

  // 1. Apply passive regen from held items
  const bonuses = getHeldBonuses();
  state.regenCounter++;
  if (bonuses.regen > 0 && state.regenCounter >= bonuses.regenInterval) {
    state.regenCounter = 0;
    if (state.hp < effectiveMaxHp()) {
      state.hp = Math.min(effectiveMaxHp(), state.hp + bonuses.regen);
      floatText("heal", `+${bonuses.regen}`, slimeEl);
    }
  }

  // 1b. Mutation passive regen (Pulsing Core).
  if (mut.passiveRegen > 0 && mut.passiveRegenInterval > 0) {
    state.passiveCounter++;
    if (state.passiveCounter >= mut.passiveRegenInterval) {
      state.passiveCounter = 0;
      if (state.hp < effectiveMaxHp()) {
        state.hp = Math.min(effectiveMaxHp(), state.hp + mut.passiveRegen);
        floatText("heal", `+${mut.passiveRegen}`, slimeEl);
      }
    }
  }

  // 2. Tick active buffs and apply buff effects
  const hadHaste = !!state.buffs.haste;
  for (const [name, ticks] of Object.entries(state.buffs)) {
    if (ticks === Infinity) continue; // permanent blessings never expire
    state.buffs[name] = ticks - 1;
    if (state.buffs[name] <= 0) {
      delete state.buffs[name];
      // Bloat: remove temporary cells when buff expires.
      if (name === "bloat") {
        for (let i = 0; i < 2 && state.inventory.length > 1; i++) {
          const idx = state.inventory.findIndex(
            (c) => c.kind === "none" && !c.item
          );
          if (idx >= 0) state.inventory.splice(idx, 1);
          else state.inventory.pop();
        }
        pushLog("Bloat fades — shrank by 2 cells");
      }
    }
  }
  // Haste: adjust tick speed when buff appears or disappears.
  if (!!state.buffs.haste !== hadHaste) {
    const base = state.baseTickInterval || state.tickInterval;
    if (state.buffs.haste) {
      state.baseTickInterval = base;
      setTickIntervalMs(Math.round(base * 0.75));
    } else {
      setTickIntervalMs(state.baseTickInterval || base);
      delete state.baseTickInterval;
    }
  }
  // Burn DoT: slime takes 1 damage per tick while burning.
  if (state.buffs.burn) {
    state.hp -= 1;
    floatText("dmg", "-1🔥", slimeEl);
  }
  // Poison Coat: adjacent enemies take 2 damage per tick.
  if (state.buffs.poison_coat) {
    const poisoned = state.entities.filter(
      (e) =>
        (e.type === "enemy" || e.type === "terminus") &&
        e.lane === state.lane &&
        e.col === SLIME_COL + 1
    );
    for (const enemy of poisoned) {
      enemy.hp -= 2;
      floatText("dmg", "-2🧪", slimeEl);
      if (enemy.hp <= 0) {
        state.runStats.enemiesDefeated++;
        const goldDrop = Math.round(
          (enemy.def.gold || 0) * (mut.enemyGoldMult || 1)
        );
        addGold(goldDrop);
        pushLog(`Poison dissolved ${enemy.def.name} (+${goldDrop}🪙)`);
        removeEntity(enemy);
      }
    }
  }

  // 3. Advance digestion across the unified inventory. Only cells whose kind
  //    has digests=true tick down their item's digestion timer; inert/holding
  //    cells leave their items alone. Each cell's speedMult and yieldMult come
  //    from STOMACH_KINDS and stack with global modifiers.
  const blessingDigest = state.buffs.swift_stomach ? 1.25 : 1;
  const acidBuff = state.buffs.acid ? 2 : 1;
  const baseDigestStep =
    (state.runMods?.digestSpeedMult || 1) * (mut.digestSpeedMult || 1) * blessingDigest * acidBuff;
  const acidSlimeYield = getSubclassPassive().digestYieldMult || 1;
  for (let i = 0; i < state.inventory.length; i++) {
    const cell = state.inventory[i];
    if (!cell.item) continue;
    const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
    if (!kindCfg.digests) continue;
    cell.item.digestProgress += baseDigestStep * (kindCfg.speedMult || 1);
    if (cell.item.digestProgress >= cell.item.def.digestTime) {
      applyDigest(cell.item, (kindCfg.yieldMult || 1) * acidSlimeYield);
      cell.item = null;
    }
  }

  // 4. Move entities. Movement is one column to the left per tick (some enemies
  //    are slowed). Special collision rules:
  //    - Enemies and "blocking" obstacles (boulders) refuse to enter the slime's
  //      cell when the slime is in their lane: they stop one column away and
  //      keep attacking / barricading from there. Items can pile up behind them.
  //    - Items / locations / regular obstacles trigger interaction the moment
  //      they slide onto the slime's cell.
  //    - When two entities collide mid-path, items/obstacles sliding into a
  //      stuck enemy interact with it (obstacles damage, fountains heal),
  //      otherwise the moving entity just stalls a tick.

  // Sort entities by col ascending so the leftmost moves first to avoid races.
  const sorted = [...state.entities].sort((a, b) => a.col - b.col);
  for (const ent of sorted) {
    // Speed: some enemies act every N ticks
    const speed = ent.def.speed || 1;
    if (speed > 1 && state.tick % speed !== 0) continue;

    const nextCol = ent.col - 1;

    if (nextCol < 0) {
      if (ent.type === "terminus") {
        pushLog(`${ent.def.name} broke through! You lose!`);
        state.hp = 0;
        onDeath();
        return;
      }
      removeEntity(ent);
      continue;
    }

    // Slime in the way? (next col is slime cell in slime's lane)
    if (nextCol === SLIME_COL && ent.lane === state.lane) {
      const isBlocker =
        ent.type === "enemy" ||
        ent.type === "terminus" ||
        (ent.type === "obstacle" && ent.def.blocking);
      if (isBlocker) {
        // Refuse to advance; stay at current col bumping the slime.
        continue;
      }
      // Items / locations / non-blocking obstacles slide onto the slime cell
      // and interact immediately.
      handleEncounter(ent);
      continue;
    }

    // Another entity already in nextCol?
    const blocker = state.entities.find(
      (e) => e !== ent && e.lane === ent.lane && e.col === nextCol
    );
    if (blocker) {
      handleSlideInteraction(ent, blocker);
      continue;
    }

    ent.col = nextCol;
  }

  // 4a. Enemy behaviors: chasers track the slime's lane, fleers run away,
  //     lane-switchers change lane periodically.
  for (const ent of state.entities) {
    if (ent.type !== "enemy" && ent.type !== "terminus") continue;
    const beh = ent.def.behavior;
    if (!beh) continue;

    if (beh === "chaser") {
      if (ent.lane !== state.lane && ent.col > SLIME_COL + 1) {
        const dir = ent.lane < state.lane ? 1 : -1;
        const target = ent.lane + dir;
        if (
          target >= 0 &&
          target < LANES &&
          !state.entities.some((e) => e !== ent && e.lane === target && e.col === ent.col)
        ) {
          ent.lane = target;
        }
      }
    } else if (beh === "fleer") {
      ent.fleeCounter = (ent.fleeCounter || 0) + 1;
      if (ent.fleeCounter >= (ent.def.fleeTimer || 8)) {
        pushLog(`${ent.def.name} escapes!`);
        removeEntity(ent);
        continue;
      }
      if (ent.lane === state.lane && ent.col > SLIME_COL + 1) {
        const away = ent.lane === 0 ? 1 : ent.lane === LANES - 1 ? LANES - 2 : (Math.random() < 0.5 ? ent.lane - 1 : ent.lane + 1);
        if (!state.entities.some((e) => e !== ent && e.lane === away && e.col === ent.col)) {
          ent.lane = away;
        }
      }
    } else if (beh === "lane_switcher") {
      const interval = ent.def.switchInterval || 3;
      if (state.tick % interval === 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const target = clamp(ent.lane + dir, 0, LANES - 1);
        if (!state.entities.some((e) => e !== ent && e.lane === target && e.col === ent.col)) {
          ent.lane = target;
        }
      }
    }
  }

  // 4b. Magnetic Body / Magnetic Membrane: vacuum items from adjacent lanes.
  if (state.runMods?.magneticBody || mut.magneticBody) {
    const magnetTargets = state.entities.filter(
      (e) =>
        e.type === "item" &&
        e.col === SLIME_COL &&
        Math.abs(e.lane - state.lane) === 1
    );
    for (const ent of magnetTargets) {
      tryPickupItem(ent.def.itemKey);
      removeEntity(ent);
    }
  }

  // 5. Combat happens for any enemy adjacent to the slime (one cell ahead in
  //    the slime's lane). Enemies that survive remain there next tick.
  const adjacentEnemies = state.entities.filter(
    (e) =>
      (e.type === "enemy" || e.type === "terminus") &&
      e.lane === state.lane &&
      e.col === SLIME_COL + 1
  );
  for (const enemy of adjacentEnemies) {
    resolveCombatRound(enemy);
    if (state.hp <= 0 || !state.running) break;
  }

  // 5b. Blocking obstacles (boulders) deal contact damage every tick while
  //     adjacent to the slime in the same lane.
  if (state.hp > 0 && state.running) {
    const adjacentBlockers = state.entities.filter(
      (e) =>
        e.type === "obstacle" &&
        e.def.blocking &&
        e.lane === state.lane &&
        e.col === SLIME_COL + 1
    );
    for (const obs of adjacentBlockers) {
      applyObstacleDamageToSlime(obs);
      if (state.hp <= 0) break;
    }
  }

  // 6. Despawn any entities that slipped past (col < 0)
  state.entities = state.entities.filter((e) => e.col >= 0);

  // 7. Level progression — spawn from pre-generated schedule or fallback
  const lvlLen = levelTickLength();
  if (state.levelTicks < lvlLen && !state.terminusSpawned) {
    if (state.levelSchedule && state.levelSchedule.length > 0) {
      while (
        state.levelSchedule.length > 0 &&
        state.levelSchedule[0].tick <= state.levelTicks
      ) {
        spawnScheduledEntity(state.levelSchedule.shift());
      }
    } else if (state.levelTicks % 2 === 0) {
      spawnRandomPathEntity();
    }
  } else if (!state.terminusSpawned && state.levelTicks >= lvlLen) {
    spawnTerminus();
  }

  // 8. Check terminus cleared
  if (state.terminusSpawned) {
    const terminus = state.entities.find((e) => e.type === "terminus");
    if (!terminus) {
      state.terminusDefeated = true;
      onLevelComplete();
      return;
    }
  }

  // 9. Check death
  if (state.hp <= 0) {
    state.hp = 0;
    onDeath();
    return;
  }

  // 10. Tick ability cooldown
  tickAbilityCooldown();

  // 11. Sparkslime contact burn: enemies adjacent to slime take burn damage.
  const sub = getSubclassPassive();
  if (sub.contactBurn) {
    const adjacent = state.entities.filter(
      (e) =>
        (e.type === "enemy" || e.type === "terminus") &&
        e.lane === state.lane &&
        e.col === SLIME_COL + 1
    );
    for (const enemy of adjacent) {
      enemy.hp -= sub.contactBurn;
      if (enemy.hp <= 0) {
        state.runStats.enemiesDefeated++;
        removeEntity(enemy);
      }
    }
  }

  // 12. Render
  renderAll();
}
