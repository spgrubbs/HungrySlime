// SlimeVenture — difficulty-budget path generator (GDD §7.2)
//
// Instead of spawning random entities every 2 ticks, each level is pre-planned
// as a schedule of spawn events. A difficulty budget scales per level and is
// spent on enemies/obstacles; items and locations are placed for free as pacing.
// The schedule is generated when a level begins and consumed tick-by-tick.

import { state, LANES, pick, rand, currentNodeConfig, levelTickLength } from "./state.js";
import {
  ITEMS,
  ENEMIES,
  ENEMY_POOL_BY_LEVEL,
  OBSTACLES,
  LOCATIONS,
} from "./data.js";
import { randomItemKey } from "./inventory.js";

// ---------- Pre-planned patterns ----------
// Formations placed as a unit. Tick offsets are relative to the base tick.
// Lane -1 means "all lanes". Cost is deducted from the difficulty budget.
const PATTERNS = [
  {
    id: "mountain_squeeze",
    cost: 6,
    minLevel: 2,
    entries: [
      { dt: 0, lane: 0, type: "obstacle", obsKey: "boulder" },
      { dt: 0, lane: 2, type: "obstacle", obsKey: "boulder" },
    ],
  },
  {
    id: "zigzag_maze",
    cost: 12,
    minLevel: 4,
    entries: [
      { dt: 0, lane: 0, type: "obstacle", obsKey: "boulder" },
      { dt: 0, lane: 1, type: "obstacle", obsKey: "boulder" },
      { dt: 2, lane: 1, type: "obstacle", obsKey: "boulder" },
      { dt: 2, lane: 2, type: "obstacle", obsKey: "boulder" },
      { dt: 4, lane: 0, type: "obstacle", obsKey: "boulder" },
      { dt: 4, lane: 1, type: "obstacle", obsKey: "boulder" },
    ],
  },
  {
    id: "spike_corridor",
    cost: 8,
    minLevel: 3,
    entries: [
      { dt: 0, lane: 0, type: "obstacle", obsKey: "spikes" },
      { dt: 0, lane: 2, type: "obstacle", obsKey: "spikes" },
      { dt: 2, lane: 0, type: "obstacle", obsKey: "spikes" },
      { dt: 2, lane: 2, type: "obstacle", obsKey: "spikes" },
    ],
  },
  {
    id: "fallen_log",
    cost: 5,
    minLevel: 2,
    entries: [
      { dt: 0, lane: 0, type: "obstacle", obsKey: "fallen_log" },
      { dt: 0, lane: 1, type: "obstacle", obsKey: "fallen_log" },
    ],
  },
  {
    id: "fallen_log_high",
    cost: 5,
    minLevel: 2,
    entries: [
      { dt: 0, lane: 1, type: "obstacle", obsKey: "fallen_log" },
      { dt: 0, lane: 2, type: "obstacle", obsKey: "fallen_log" },
    ],
  },
  {
    id: "ambush_alley",
    cost: 8,
    minLevel: 3,
    entries: [
      { dt: 0, lane: 0, type: "obstacle", obsKey: "boulder" },
      { dt: 0, lane: 2, type: "obstacle", obsKey: "boulder" },
      { dt: 1, lane: 1, type: "enemy", enemyKey: "hornet" },
    ],
  },
  {
    id: "gauntlet",
    cost: 10,
    minLevel: 5,
    entries: [
      { dt: 0, lane: 0, type: "obstacle", obsKey: "boulder" },
      { dt: 0, lane: 2, type: "obstacle", obsKey: "boulder" },
      { dt: 3, lane: 1, type: "obstacle", obsKey: "boulder" },
      { dt: 3, lane: 2, type: "obstacle", obsKey: "boulder" },
      { dt: 6, lane: 0, type: "obstacle", obsKey: "boulder" },
      { dt: 6, lane: 1, type: "obstacle", obsKey: "boulder" },
    ],
  },
];

const DIFFICULTY_BY_LEVEL = {
  1: 12,
  2: 20,
  3: 30,
  4: 42,
  5: 55,
  6: 60,
  7: 68,
  8: 78,
  9: 88,
  10: 100,
};

const LOCATION_KEYS = ["fountain", "shop", "shrine", "merchant"];

// Generate a flat array of spawn descriptors, each with a `tick` field
// indicating when to spawn it. Stored on state.levelSchedule.
export function generateLevelSchedule() {
  const cfg = currentNodeConfig();
  const w = cfg.spawnWeights;
  const lvl = state.level || 1;
  const totalTicks = levelTickLength();
  let budget = DIFFICULTY_BY_LEVEL[lvl] || DIFFICULTY_BY_LEVEL[1];

  // Adjust budget by node type: elite gets +40%, treasure gets -50%.
  const node = state.map && state.map[state.mapNode.row]?.[state.mapNode.col];
  if (node?.type === "dangerous") budget = Math.round(budget * 1.4);
  else if (node?.type === "treasure") budget = Math.round(budget * 0.5);
  else if (node?.type === "event") budget = Math.round(budget * 0.6);

  const schedule = [];
  const usedSlots = new Set(); // "tick:lane" strings to avoid collisions

  function slotKey(t, l) { return `${t}:${l}`; }
  function findFreeLane(t) {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    for (const l of lanes) {
      if (!usedSlots.has(slotKey(t, l))) return l;
    }
    return -1;
  }

  // 1. Place locations (free, 1-3 per level, spread evenly).
  const numLocations = 1 + Math.floor(Math.random() * 2) + (w.location > 0.2 ? 1 : 0);
  const locSpacing = Math.floor(totalTicks / (numLocations + 1));
  for (let i = 0; i < numLocations; i++) {
    const t = locSpacing * (i + 1) + rand(4) - 2;
    const tick = Math.max(2, Math.min(totalTicks - 4, t));
    const lane = findFreeLane(tick);
    if (lane < 0) continue;
    usedSlots.add(slotKey(tick, lane));
    const locRoll = Math.random();
    let locKey;
    if (locRoll < 0.3) locKey = "fountain";
    else if (locRoll < 0.5) locKey = "shop";
    else if (locRoll < 0.7) locKey = "shrine";
    else if (locRoll < 0.85) locKey = "merchant";
    else locKey = "pool";
    schedule.push({ tick, lane, type: "location", locKey });
  }

  // 2a. Place pre-planned patterns (spend ~30% of budget on patterns).
  const patternBudget = Math.floor(budget * 0.3);
  let patternSpent = 0;
  const eligible = PATTERNS.filter((p) => p.minLevel <= lvl);
  if (eligible.length > 0) {
    let patternAttempts = 0;
    while (patternSpent < patternBudget && patternAttempts < 30) {
      patternAttempts++;
      const pat = pick(eligible);
      if (pat.cost > budget - patternSpent) continue;
      const baseTick = 4 + rand(totalTicks - 10);
      let fits = true;
      for (const e of pat.entries) {
        const t = baseTick + e.dt;
        if (t < 1 || t >= totalTicks - 2) { fits = false; break; }
        if (usedSlots.has(slotKey(t, e.lane))) { fits = false; break; }
      }
      if (!fits) continue;
      for (const e of pat.entries) {
        const t = baseTick + e.dt;
        usedSlots.add(slotKey(t, e.lane));
        schedule.push({ tick: t, lane: e.lane, type: e.type, obsKey: e.obsKey, enemyKey: e.enemyKey });
      }
      patternSpent += pat.cost;
    }
    budget -= patternSpent;
  }

  // 2b. Spend remaining budget on enemies and obstacles.
  const enemyPool = ENEMY_POOL_BY_LEVEL[lvl] || ENEMY_POOL_BY_LEVEL[1];
  let attempts = 0;
  while (budget > 0 && attempts < 200) {
    attempts++;
    // Decide enemy vs obstacle based on spawn weights.
    const eWeight = w.enemy;
    const oWeight = w.obstacle;
    const isEnemy = Math.random() < eWeight / (eWeight + oWeight);

    if (isEnemy) {
      const key = pick(enemyPool);
      const def = ENEMIES[key];
      const cost = def.cost || 1;
      if (cost > budget) continue;

      const tick = 2 + rand(totalTicks - 4);
      const lane = findFreeLane(tick);
      if (lane < 0) continue;

      if (def.swarm) {
        // Swarms occupy all lanes at this tick.
        for (let l = 0; l < LANES; l++) usedSlots.add(slotKey(tick, l));
        schedule.push({ tick, lane: -1, type: "swarm", enemyKey: key });
      } else if (def.mimic) {
        usedSlots.add(slotKey(tick, lane));
        schedule.push({ tick, lane, type: "mimic", enemyKey: key });
      } else {
        usedSlots.add(slotKey(tick, lane));
        schedule.push({ tick, lane, type: "enemy", enemyKey: key });
      }
      budget -= cost;
    } else {
      const r = Math.random();
      let obsKey, cost;
      if (r < 0.55) { obsKey = "rock"; cost = 1; }
      else if (r < 0.8) { obsKey = "spikes"; cost = 2; }
      else { obsKey = "boulder"; cost = 3; }
      if (cost > budget) continue;

      const tick = 2 + rand(totalTicks - 4);
      const lane = findFreeLane(tick);
      if (lane < 0) continue;
      usedSlots.add(slotKey(tick, lane));
      schedule.push({ tick, lane, type: "obstacle", obsKey });
      budget -= cost;
    }
  }

  // 3. Scatter free items based on item weight. More items in treasure nodes.
  const itemRatio = w.item / (w.enemy + w.item + w.obstacle + w.location);
  const numItems = Math.round(totalTicks * 0.375 * itemRatio) + 2;
  for (let i = 0; i < numItems; i++) {
    const tick = 1 + rand(totalTicks - 2);
    const lane = findFreeLane(tick);
    if (lane < 0) continue;
    usedSlots.add(slotKey(tick, lane));
    schedule.push({ tick, lane, type: "item" });
  }

  // Sort by tick so consumption is a simple queue.
  schedule.sort((a, b) => a.tick - b.tick);
  return schedule;
}
