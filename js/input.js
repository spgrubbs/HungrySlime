// SlimeVenture — input handling: lane changes, pause, hub/event buttons

import { state, $, LANES, SLIME_COL, clamp } from "./state.js";
import { getMutationBonuses } from "./mutations.js";
import {
  effectiveMaxHp,
  growSlime,
  discardSelected,
  toggleArrangeMode,
} from "./inventory.js";
import { handleEncounter } from "./combat.js";
import {
  renderAll,
  floatText,
  updateHUD,
  updatePauseBtn,
} from "./ui.js";
import {
  beginNewRun,
  openMetaMenu,
  openPlaceholder,
} from "./scenes.js";

// ---------- DOM refs ----------
const slimeEl = $("slime");
const laneUpBtn = $("lane-up");
const laneDownBtn = $("lane-down");
const pauseBtn = $("pause-btn");
const growBtn = $("grow-btn");
const discardBtn = $("discard-btn");
const arrangeBtn = $("arrange-btn");
const eventContinueBtn = $("event-continue");

// ---------- Lane + pause ----------
function applyLaneRegen() {
  const mut = state.mutBonuses || getMutationBonuses(state.mutations);
  if (mut.laneRegen > 0 && state.hp < effectiveMaxHp()) {
    state.hp = Math.min(effectiveMaxHp(), state.hp + mut.laneRegen);
    floatText("heal", `+${mut.laneRegen}`, slimeEl);
    updateHUD();
  }
}

// Whenever the slime changes lane, anything sitting in its column in the new
// lane gets walked-on. The encounter triggers immediately — items get picked
// up, fountains open, obstacles damage, lone enemies start a combat round.
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

// ---------- Hookups ----------
export function hookInput() {
  laneUpBtn.addEventListener("click", onLaneUp);
  laneDownBtn.addEventListener("click", onLaneDown);
  pauseBtn.addEventListener("click", onPause);
  growBtn.addEventListener("click", growSlime);
  discardBtn.addEventListener("click", discardSelected);
  if (arrangeBtn) arrangeBtn.addEventListener("click", toggleArrangeMode);

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "w") onLaneUp();
    else if (e.key === "ArrowDown" || e.key === "s") onLaneDown();
    else if (e.key === " " || e.key === "p") {
      e.preventDefault();
      onPause();
    }
  });
}

export function hookHub() {
  const startBtn = document.getElementById("hub-start");
  const upgradesBtn = document.getElementById("hub-upgrades");
  const mutationsBtn = document.getElementById("hub-mutations");
  const codexBtn = document.getElementById("hub-codex");
  const cosmeticsBtn = document.getElementById("hub-cosmetics");
  if (startBtn) startBtn.addEventListener("click", () => beginNewRun());
  if (upgradesBtn) upgradesBtn.addEventListener("click", () => openMetaMenu());
  if (mutationsBtn) {
    mutationsBtn.addEventListener("click", () =>
      openPlaceholder(
        "🧬 Mutation Den",
        "Future home of permanent mutation unlocks. Coming soon."
      )
    );
  }
  if (codexBtn) {
    codexBtn.addEventListener("click", () =>
      openPlaceholder(
        "📖 Slime Codex",
        "Lore, item entries, and bestiary. Coming soon."
      )
    );
  }
  if (cosmeticsBtn) {
    cosmeticsBtn.addEventListener("click", () =>
      openPlaceholder(
        "🎨 Wardrobe",
        "Skins and color variants. Coming soon."
      )
    );
  }
}

export function hookEventView() {
  if (eventContinueBtn) {
    // The onclick handler is rebound per-event in resolveEventChoice; this
    // line just exists so the button is registered in the DOM.
  }
}
