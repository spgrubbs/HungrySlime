// SlimeVenture — entry point. Wires modules together and boots the game.

import {
  state,
  devState,
  COLS,
  BASE_TICK_MS,
  MAX_LEVEL,
  levelTickLength,
  refreshMutationBonuses,
} from "./state.js";
import { loadMeta, saveMeta, resetMeta, grantXp } from "./meta.js";
import { generateRunMap } from "./map.js";
import {
  tryPickupItem,
  effectiveMaxHp,
} from "./inventory.js";
import {
  renderAll,
  showBanner,
  updatePauseBtn,
} from "./ui.js";
import {
  spawnEntity,
  spawnTerminus,
} from "./combat.js";
import { tick, setTickIntervalMs } from "./tick.js";
import {
  setScene,
  onLevelComplete,
  onNodeSelected,
  restartRun,
  goToHub,
  renderHub,
  openMetaMenu,
} from "./scenes.js";
import { hookInput, hookHub, hookEventView } from "./input.js";
import { initDevTools } from "./devtools.js";

function start() {
  hookInput();
  hookHub();
  hookEventView();
  state.meta = loadMeta();
  refreshMutationBonuses();
  // Boot lands in the hub — no run is in progress.
  setScene("hub");
  renderHub();
  renderAll();
  setTickIntervalMs(state.tickInterval);
  initDevTools({
    state,
    devState,
    setTickIntervalMs,
    tick,
    renderAll,
    effectiveMaxHp,
    restartRun,
    spawnEntity,
    tryPickupItem,
    updatePauseBtn,
    showBanner,
    onLevelComplete,
    spawnTerminus,
    advanceToNode: onNodeSelected,
    rerollMap: () => {
      state.map = generateRunMap();
      state.mapNode = { row: 0, col: 0 };
      state.level = 1;
      state.levelTicks = 0;
      state.terminusSpawned = false;
      state.terminusDefeated = false;
      state.entities = [];
      state.paused = false;
      setScene("run");
      updatePauseBtn();
      renderAll();
      showBanner("— Level 1: Start —");
    },
    openMetaMenu,
    goToHub,
    grantMetaXp: (amount) => {
      grantXp(state.meta, amount);
      saveMeta(state.meta);
      renderHub();
    },
    resetMeta: () => {
      state.meta = resetMeta();
      saveMeta(state.meta);
      renderHub();
    },
    COLS,
    levelTickLength,
    MAX_LEVEL,
    BASE_TICK_MS,
  });
}

start();
