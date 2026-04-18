// SlimeVenture — shared state, constants, and utilities

import { NODE_TYPES } from "./map.js";
import { getMutationBonuses } from "./mutations.js";

// ---------- Config ----------
export const COLS = 6;
export const LANES = 3;
export const SLIME_COL = 0; // slime is anchored at leftmost visible column
export const BASE_TICK_MS = 1500;
export const DEFAULT_LEVEL_TICK_LENGTH = 42; // fallback when a node has no tickLength
export const MAX_LEVEL = 5;

// ---------- DOM helper ----------
export const $ = (id) => document.getElementById(id);

// ---------- Utility ----------
export const rand = (n) => Math.floor(Math.random() * n);
export const pick = (arr) => arr[rand(arr.length)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- State ----------
export const state = {
  // "hub" | "run" | "overworld" | "event"
  scene: "hub",
  tick: 0,
  tickInterval: BASE_TICK_MS,
  paused: false,
  running: false,
  hp: 20,
  maxHp: 20,
  gold: 0,
  scrap: 0,
  mana: 0,
  lane: 1,
  level: 1,
  levelTicks: 0,
  terminusSpawned: false,
  terminusDefeated: false,
  // Run map (Slay-the-Spire style branching grid). Generated when starting a run.
  map: null,
  mapNode: { row: 0, col: 0 },
  // Path entities: keyed by id, each has {id,type,def,lane,col,hp,maxHp}
  entities: [],
  levelSchedule: [],
  // Inventory: a single flat array of cells. Each cell has a stomach kind
  // (see STOMACH_KINDS) and may hold one item instance.
  // Items enter at index 0 and cascade toward the end as new items push them.
  // Cell shape: { kind: "none"|"digest"|"fast"|"acid"|"holding", item: instance|null }
  // Item instance shape: { key, def, digestProgress }
  inventory: [],
  // selected = { index: number } when something is picked up. arrangeMode
  // toggles whether the next click swaps items or swaps entire cells.
  selected: null,
  arrangeMode: false,
  buffs: {}, // name -> remaining ticks (Infinity for permanent blessings)
  shield: 0, // shield HP absorbs damage before real HP
  blessings: [], // shrine blessing keys earned this run
  regenCounter: 0,
  passiveCounter: 0, // separate counter for mutation passive regen
  growthLevel: 0, // number of times player has grown
  subclass: null, // chosen subclass key (e.g. "spitslime")
  abilityCooldown: 0, // ticks until active ability is usable again
  evolutionOffered: false, // whether evolution pool has appeared this run
  log: [],
  // Mutations earned this run (powerful relic-like passives, no inv slot).
  mutations: [],
  // Per-run counters, used for XP calculation at run end.
  runStats: {
    levelsCompleted: 0,
    enemiesDefeated: 0,
    goldEarned: 0,
    itemsDigested: 0,
    bossDefeated: false,
  },
  // Meta save (loaded in start, persisted on XP grant / purchase).
  meta: null,
  // Modifier accumulator derived from state.meta.unlocks, recomputed at the
  // start of every run.
  runMods: null,
  // Cached mutation-bonus accumulator, refreshed when mutations change.
  mutBonuses: null,
};

// Dev tools state — toggled from the dev panel, consulted by combat/grow code.
export const devState = {
  godMode: false,
  freeGrowth: false,
};

// ---------- Derived helpers ----------
export function currentMapNode() {
  if (!state.map) return null;
  const { row, col } = state.mapNode;
  return state.map[row] && state.map[row][col];
}

export function currentNodeConfig() {
  const node = currentMapNode();
  return (node && NODE_TYPES[node.type]) || NODE_TYPES.combat;
}

export function levelTickLength() {
  return currentNodeConfig().tickLength || DEFAULT_LEVEL_TICK_LENGTH;
}

export function refreshMutationBonuses() {
  state.mutBonuses = getMutationBonuses(state.mutations);
}
