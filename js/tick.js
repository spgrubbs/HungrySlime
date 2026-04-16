// SlimeVenture — tick loop, entity movement, level progression

import { state, SLIME_COL, levelTickLength } from "./state.js";
import { STOMACH_KINDS, getMutationBonuses } from "./mutations.js";
import { getHeldBonuses, effectiveMaxHp, tryPickupItem, applyDigest } from "./inventory.js";
import { floatText, renderAll } from "./ui.js";
import {
  handleEncounter,
  handleSlideInteraction,
  removeEntity,
  resolveCombatRound,
  applyObstacleDamageToSlime,
  spawnRandomPathEntity,
  spawnTerminus,
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

  // 2. Tick active buffs
  for (const [name, ticks] of Object.entries(state.buffs)) {
    state.buffs[name] = ticks - 1;
    if (state.buffs[name] <= 0) delete state.buffs[name];
  }

  // 3. Advance digestion across the unified inventory. Only cells whose kind
  //    has digests=true tick down their item's digestion timer; inert/holding
  //    cells leave their items alone. Each cell's speedMult and yieldMult come
  //    from STOMACH_KINDS and stack with global modifiers.
  const baseDigestStep =
    (state.runMods?.digestSpeedMult || 1) * (mut.digestSpeedMult || 1);
  for (let i = 0; i < state.inventory.length; i++) {
    const cell = state.inventory[i];
    if (!cell.item) continue;
    const kindCfg = STOMACH_KINDS[cell.kind] || STOMACH_KINDS.none;
    if (!kindCfg.digests) continue;
    cell.item.digestProgress += baseDigestStep * (kindCfg.speedMult || 1);
    if (cell.item.digestProgress >= cell.item.def.digestTime) {
      applyDigest(cell.item, kindCfg.yieldMult || 1);
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
      // Despawned off the left edge
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

  // 7. Level progression — spawn things
  const lvlLen = levelTickLength();
  if (state.levelTicks < lvlLen && !state.terminusSpawned) {
    // Normal spawning
    if (state.levelTicks % 2 === 0) spawnRandomPathEntity();
  } else if (!state.terminusSpawned && state.levelTicks >= lvlLen) {
    // Time for the terminus. Make sure the lane is clear.
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

  // 10. Render
  renderAll();
}
