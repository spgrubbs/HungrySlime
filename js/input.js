// SlimeVenture — input handling: lane changes, pause, hub/event buttons

import { state, $, LANES, SLIME_COL, clamp } from "./state.js";
import { getMutationBonuses } from "./mutations.js";
import {
  effectiveMaxHp,
  growSlime,
  discardSelected,
} from "./inventory.js";
import { handleEncounter } from "./combat.js";
import {
  renderAll,
  floatText,
  updateHUD,
  updatePauseBtn,
  openEventLog,
} from "./ui.js";
import {
  beginNewRun,
  openMetaMenu,
  openMutationLab,
  openWardrobe,
  openPlaceholder,
} from "./scenes.js";
import { useAbility } from "./subclass.js";
import { openRanch } from "./pets.js";
import { openQuestTracker } from "./quests.js";
import { trackIncrement } from "./quests.js";

// ---------- DOM refs ----------
const slimeEl = $("slime");
const laneUpBtn = $("lane-up");
const laneDownBtn = $("lane-down");
const pauseBtn = $("pause-btn");
const growBtn = $("grow-btn");
const discardBtn = $("discard-btn");
const eventContinueBtn = $("event-continue");
const abilityBtn = $("ability-btn");
const questBtn = $("quest-btn");
const logBtn = $("log-btn");

// ---------- Lane + pause ----------
function applyLaneRegen() {
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  if (mut.laneRegen > 0 && state.hp < effectiveMaxHp()) {
    state.hp = Math.min(effectiveMaxHp(), state.hp + mut.laneRegen);
    floatText("heal", `+${mut.laneRegen}`, slimeEl);
    updateHUD();
  }
}

function checkLaneEntry() {
  const ent = state.entities.find(
    (e) => e.lane === state.lane && e.col === SLIME_COL
  );
  if (ent) handleEncounter(ent);
}

function onLaneUp() {
  if (state.scene !== "run") return;
  const prev = state.lane;
  state.lane = clamp(state.lane - 1, 0, LANES - 1);
  if (state.lane !== prev) {
    applyLaneRegen();
    checkLaneEntry();
  }
  renderAll();
}

function onLaneDown() {
  if (state.scene !== "run") return;
  const prev = state.lane;
  state.lane = clamp(state.lane + 1, 0, LANES - 1);
  if (state.lane !== prev) {
    applyLaneRegen();
    checkLaneEntry();
  }
  renderAll();
}

function onPause() {
  if (!state.running) return;
  state.paused = !state.paused;
  updatePauseBtn();
}

function onAbility() {
  if (state.scene !== "run" || !state.subclass) return;
  useAbility();
  trackIncrement("abilitiesUsed");
}

// ---------- Hookups ----------
export function hookInput() {
  laneUpBtn.addEventListener("click", onLaneUp);
  laneDownBtn.addEventListener("click", onLaneDown);
  pauseBtn.addEventListener("click", onPause);
  if (abilityBtn) abilityBtn.addEventListener("click", onAbility);
  if (questBtn) questBtn.addEventListener("click", () => openQuestTracker());
  if (logBtn) logBtn.addEventListener("click", () => openEventLog());
  growBtn.addEventListener("click", () => {
    growSlime();
    trackIncrement("growCount");
  });
  discardBtn.addEventListener("click", discardSelected);

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "w") onLaneUp();
    else if (e.key === "ArrowDown" || e.key === "s") onLaneDown();
    else if (e.key === " " || e.key === "p") {
      e.preventDefault();
      onPause();
    } else if (e.key === "e" || e.key === "q") {
      onAbility();
    }
  });
}

export function hookHub() {
  const startBtn = document.getElementById("hub-start");
  const upgradesBtn = document.getElementById("hub-upgrades");
  const mutationsBtn = document.getElementById("hub-mutations");
  const ranchBtn = document.getElementById("hub-ranch");
  const questsBtn = document.getElementById("hub-quests");
  const codexBtn = document.getElementById("hub-codex");
  const cosmeticsBtn = document.getElementById("hub-cosmetics");
  if (startBtn) startBtn.addEventListener("click", () => beginNewRun());
  if (upgradesBtn) upgradesBtn.addEventListener("click", () => {
    openMetaMenu();
    trackIncrement("labVisits");
  });
  if (mutationsBtn) mutationsBtn.addEventListener("click", () => openMutationLab());
  if (ranchBtn) ranchBtn.addEventListener("click", () => openRanch());
  if (questsBtn) questsBtn.addEventListener("click", () => openQuestTracker());
  if (codexBtn) {
    codexBtn.addEventListener("click", () =>
      openPlaceholder(
        "📖 Slime Codex",
        "Lore, item entries, and bestiary. Coming soon."
      )
    );
  }
  if (cosmeticsBtn) cosmeticsBtn.addEventListener("click", () => openWardrobe());
}

export function hookEventView() {
  if (eventContinueBtn) {
    // The onclick handler is rebound per-event in resolveEventChoice.
  }
}
