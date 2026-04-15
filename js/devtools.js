// SlimeVenture — Dev Tools
// Toggleable panel for speed control, god mode, level skipping,
// item/enemy spawning, and live state inspection.
// Activate with the ` (backtick) key or the ⚙ button in the top-right.

import { ITEMS, ENEMIES } from "./data.js";

export function initDevTools(api) {
  const {
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
    advanceToNode,
    rerollMap,
    openMetaMenu,
    grantMetaXp,
    resetMeta,
    COLS,
    levelTickLength,
    MAX_LEVEL,
    BASE_TICK_MS,
  } = api;

  // ---------- Actions ----------
  const actions = {
    setSpeed(mult) {
      setTickIntervalMs(Math.round(BASE_TICK_MS / mult));
    },
    stepTick() {
      if (!state.running) return;
      const wasPaused = state.paused;
      state.paused = false;
      tick();
      // If tick() opened a modal (level complete, fountain, etc.) it will
      // have set paused=true itself — respect that. Otherwise restore.
      if (!state.paused) state.paused = wasPaused;
      updatePauseBtn();
      renderAll();
    },
    addGold(n) {
      state.gold += n;
      renderAll();
    },
    fullHeal() {
      state.hp = effectiveMaxHp();
      renderAll();
    },
    giveItem(key) {
      tryPickupItem(key);
      renderAll();
    },
    spawnEnemyInLane(key) {
      const def = ENEMIES[key];
      if (!def) return;
      // Find rightmost empty column in slime's current lane
      let col = COLS - 1;
      while (
        col > 0 &&
        state.entities.some((e) => e.lane === state.lane && e.col === col)
      ) {
        col--;
      }
      spawnEntity(def, "enemy", state.lane, col);
      renderAll();
    },
    clearPath() {
      state.entities = [];
      renderAll();
    },
    killAllEnemies() {
      const hadTerminus = state.entities.some((e) => e.type === "terminus");
      state.entities = state.entities.filter(
        (e) => e.type !== "enemy" && e.type !== "terminus"
      );
      if (hadTerminus) {
        state.terminusDefeated = true;
        onLevelComplete();
      } else {
        renderAll();
      }
    },
    skipToTerminus() {
      // Sweep path of non-terminus entities; force terminus to spawn now.
      state.entities = state.entities.filter((e) => e.type === "terminus");
      if (!state.terminusSpawned) {
        state.levelTicks = levelTickLength();
        spawnTerminus();
      }
      renderAll();
    },
    skipLevel() {
      // Walk a random outgoing edge in the run map.
      const node = state.map?.[state.mapNode.row]?.[state.mapNode.col];
      if (!node) return;
      const next = [...node.edges]
        .map((c) => state.map[node.row + 1] && state.map[node.row + 1][c])
        .filter(Boolean);
      if (next.length === 0) {
        // Boss row — fake a kill so the run-complete modal shows.
        state.terminusDefeated = true;
        onLevelComplete();
        return;
      }
      const target = next[Math.floor(Math.random() * next.length)];
      advanceToNode(target);
    },
    jumpToLevel(lvl) {
      // Snap to the first active node in that row of the existing map.
      const targetRow = Math.max(0, Math.min(MAX_LEVEL - 1, (lvl | 0) - 1));
      const row = state.map && state.map[targetRow];
      if (!row) return;
      const target = row.find((n) => n.active);
      if (!target) return;
      advanceToNode(target);
    },
    rerollMap() {
      rerollMap();
    },
    resetRun() {
      restartRun();
    },
  };

  // ---------- Build DOM ----------
  const gameEl = document.getElementById("game");

  const toggleBtn = document.createElement("button");
  toggleBtn.id = "dev-toggle";
  toggleBtn.className = "dev-toggle";
  toggleBtn.type = "button";
  toggleBtn.textContent = "⚙";
  toggleBtn.title = "Dev tools (`)";
  gameEl.appendChild(toggleBtn);

  const panel = document.createElement("div");
  panel.id = "dev-panel";
  panel.className = "dev-panel hidden";
  panel.innerHTML = `
    <div class="dev-header">
      <strong>DEV TOOLS</strong>
      <button class="dev-close" type="button" aria-label="Close">✕</button>
    </div>

    <div class="dev-section">
      <label>Speed</label>
      <div class="dev-row" id="dev-speed-row">
        <button type="button" data-speed="0.25">¼x</button>
        <button type="button" data-speed="0.5">½x</button>
        <button type="button" data-speed="1" class="on">1x</button>
        <button type="button" data-speed="2">2x</button>
        <button type="button" data-speed="4">4x</button>
        <button type="button" data-speed="8">8x</button>
        <button type="button" id="dev-step" title="Advance exactly one tick">Step ▶</button>
      </div>
    </div>

    <div class="dev-section">
      <label>Player</label>
      <div class="dev-row">
        <button type="button" id="dev-god">God: OFF</button>
        <button type="button" id="dev-freegrow">Free Grow: OFF</button>
        <button type="button" id="dev-gold">+100 🪙</button>
        <button type="button" id="dev-heal">Full HP</button>
        <button type="button" id="dev-reset">Reset Run</button>
      </div>
    </div>

    <div class="dev-section">
      <label>Level / Map</label>
      <div class="dev-row">
        <button type="button" id="dev-to-terminus">→ Terminus</button>
        <button type="button" id="dev-skip">Skip Level</button>
        <button type="button" id="dev-reroll">Reroll Map</button>
      </div>
      <div class="dev-row">
        <select id="dev-level-sel">
          <option value="1">Level 1</option>
          <option value="2">Level 2</option>
          <option value="3">Level 3</option>
          <option value="4">Level 4</option>
          <option value="5">Level 5</option>
        </select>
        <button type="button" id="dev-jump">Jump to row</button>
      </div>
    </div>

    <div class="dev-section">
      <label>Spawn Item (into inventory)</label>
      <div class="dev-row">
        <select id="dev-item-sel"></select>
        <button type="button" id="dev-give-item">Give</button>
      </div>
    </div>

    <div class="dev-section">
      <label>Spawn Enemy (in slime's lane)</label>
      <div class="dev-row">
        <select id="dev-enemy-sel"></select>
        <button type="button" id="dev-spawn-enemy">Spawn</button>
      </div>
    </div>

    <div class="dev-section">
      <label>World</label>
      <div class="dev-row">
        <button type="button" id="dev-clear">Clear Path</button>
        <button type="button" id="dev-killall">Kill All Enemies</button>
      </div>
    </div>

    <div class="dev-section">
      <label>Meta Progression</label>
      <div class="dev-row">
        <button type="button" id="dev-meta-open">Open Meta</button>
        <button type="button" id="dev-meta-xp">+50 XP</button>
        <button type="button" id="dev-meta-reset">Reset Meta</button>
      </div>
    </div>

    <div class="dev-section">
      <label>State</label>
      <div id="dev-info" class="dev-info">—</div>
    </div>
  `;
  gameEl.appendChild(panel);

  // Populate selects from data.js
  const itemSel = panel.querySelector("#dev-item-sel");
  for (const [key, item] of Object.entries(ITEMS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${item.emoji} ${item.name}`;
    itemSel.appendChild(opt);
  }
  const enemySel = panel.querySelector("#dev-enemy-sel");
  for (const [key, en] of Object.entries(ENEMIES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${en.emoji} ${en.name} (${en.hp}hp / ${en.attack}atk)`;
    enemySel.appendChild(opt);
  }

  // ---------- Toggle ----------
  function togglePanel(show) {
    const isHidden = panel.classList.contains("hidden");
    const shouldShow = show === undefined ? isHidden : show;
    panel.classList.toggle("hidden", !shouldShow);
    toggleBtn.classList.toggle("on", shouldShow);
    if (shouldShow) updateInfo();
  }
  toggleBtn.addEventListener("click", () => togglePanel());
  panel
    .querySelector(".dev-close")
    .addEventListener("click", () => togglePanel(false));

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "SELECT" ||
        t.tagName === "TEXTAREA")
    ) {
      return;
    }
    if (e.key === "`" || e.key === "~") {
      e.preventDefault();
      togglePanel();
    }
  });

  // ---------- Wiring ----------
  // Speed row
  const speedRow = panel.querySelector("#dev-speed-row");
  const speedButtons = speedRow.querySelectorAll("button[data-speed]");
  speedButtons.forEach((b) => {
    b.addEventListener("click", () => {
      actions.setSpeed(parseFloat(b.dataset.speed));
      speedButtons.forEach((x) => x.classList.toggle("on", x === b));
      updateInfo();
    });
  });
  panel.querySelector("#dev-step").addEventListener("click", () => {
    actions.stepTick();
    updateInfo();
  });

  // Player toggles
  const godBtn = panel.querySelector("#dev-god");
  godBtn.addEventListener("click", () => {
    devState.godMode = !devState.godMode;
    godBtn.textContent = `God: ${devState.godMode ? "ON" : "OFF"}`;
    godBtn.classList.toggle("on", devState.godMode);
    updateInfo();
  });
  const freeGrowBtn = panel.querySelector("#dev-freegrow");
  freeGrowBtn.addEventListener("click", () => {
    devState.freeGrowth = !devState.freeGrowth;
    freeGrowBtn.textContent = `Free Grow: ${
      devState.freeGrowth ? "ON" : "OFF"
    }`;
    freeGrowBtn.classList.toggle("on", devState.freeGrowth);
    renderAll();
  });

  panel
    .querySelector("#dev-gold")
    .addEventListener("click", () => actions.addGold(100));
  panel
    .querySelector("#dev-heal")
    .addEventListener("click", () => actions.fullHeal());
  panel
    .querySelector("#dev-reset")
    .addEventListener("click", () => actions.resetRun());

  // Level
  panel
    .querySelector("#dev-to-terminus")
    .addEventListener("click", () => actions.skipToTerminus());
  panel
    .querySelector("#dev-skip")
    .addEventListener("click", () => actions.skipLevel());
  panel.querySelector("#dev-jump").addEventListener("click", () => {
    const lvl = parseInt(panel.querySelector("#dev-level-sel").value, 10);
    actions.jumpToLevel(lvl);
  });
  panel
    .querySelector("#dev-reroll")
    .addEventListener("click", () => actions.rerollMap());

  // Spawning
  panel
    .querySelector("#dev-give-item")
    .addEventListener("click", () => actions.giveItem(itemSel.value));
  panel
    .querySelector("#dev-spawn-enemy")
    .addEventListener("click", () => actions.spawnEnemyInLane(enemySel.value));

  // World
  panel
    .querySelector("#dev-clear")
    .addEventListener("click", () => actions.clearPath());
  panel
    .querySelector("#dev-killall")
    .addEventListener("click", () => actions.killAllEnemies());

  // Meta
  panel.querySelector("#dev-meta-open").addEventListener("click", () => {
    togglePanel(false);
    openMetaMenu(() => {
      state.paused = false;
      updatePauseBtn();
    });
  });
  panel.querySelector("#dev-meta-xp").addEventListener("click", () => {
    grantMetaXp(50);
    showBanner("+50 Slime XP", 1200);
    updateInfo();
  });
  panel.querySelector("#dev-meta-reset").addEventListener("click", () => {
    resetMeta();
    showBanner("Meta progression reset", 1200);
    updateInfo();
  });

  // ---------- Live state inspector ----------
  const infoEl = panel.querySelector("#dev-info");
  function updateInfo() {
    if (panel.classList.contains("hidden")) return;
    const buffs = Object.entries(state.buffs)
      .map(([k, v]) => `${k}(${v})`)
      .join(", ") || "—";
    const speedMult = (BASE_TICK_MS / state.tickInterval).toFixed(2);
    const node = state.map?.[state.mapNode.row]?.[state.mapNode.col];
    const nodeType = node ? node.type : "—";
    const lvlLen = levelTickLength();
    infoEl.innerHTML = `
      <div>tick: <b>${state.tick}</b> · lv: <b>${state.level}</b> · lTicks: <b>${state.levelTicks}/${lvlLen}</b></div>
      <div>node: <b>${nodeType}</b> @ row <b>${state.mapNode.row}</b> col <b>${state.mapNode.col}</b></div>
      <div>hp: <b>${state.hp}/${effectiveMaxHp()}</b> · gold: <b>${state.gold}</b> · lane: <b>${state.lane}</b></div>
      <div>entities: <b>${state.entities.length}</b> · speed: <b>${speedMult}x</b> · paused: <b>${state.paused ? "yes" : "no"}</b></div>
      <div>god: <b>${devState.godMode ? "ON" : "OFF"}</b> · freeGrow: <b>${devState.freeGrowth ? "ON" : "OFF"}</b></div>
      <div>buffs: <b>${buffs}</b></div>
      <div>meta XP: <b>${state.meta?.availableXp ?? 0}</b> / lifetime <b>${state.meta?.totalXp ?? 0}</b> · unlocks <b>${state.meta ? Object.keys(state.meta.unlocks || {}).length : 0}</b></div>
    `;
  }
  // Passive refresh so the inspector stays current without touching the tick loop.
  setInterval(updateInfo, 300);
}
