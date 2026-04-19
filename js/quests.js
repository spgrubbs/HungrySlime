// SlimeVenture — Quest & Achievement System
// Daily quests (randomized, reset at midnight UTC, reward resources),
// story quests (sequential milestones, reward XP), and achievements
// (one-time accomplishments, award Gems 💠 — premium cosmetic currency).

import { state } from "./state.js";
import { saveMeta, grantXp } from "./meta.js";
import {
  openModal,
  closeModal,
  showBanner,
  pushLog,
  updateHUD,
} from "./ui.js";

// ---------- Daily quest templates ----------
// Each template has a `stat` key that maps to run-level counters tracked in
// state.questProgress, and a `target` value. Rewards are resources.
const DAILY_POOL = [
  { id: "defeat_enemies_10",  desc: "Defeat 10 enemies",           stat: "enemiesDefeated",  target: 10, reward: { scrap: 6 } },
  { id: "defeat_enemies_15",  desc: "Defeat 15 enemies",           stat: "enemiesDefeated",  target: 15, reward: { scrap: 8 } },
  { id: "defeat_enemies_25",  desc: "Defeat 25 enemies",           stat: "enemiesDefeated",  target: 25, reward: { scrap: 12 } },
  { id: "digest_items_5",     desc: "Digest 5 items",              stat: "itemsDigested",    target: 5,  reward: { mana: 5 } },
  { id: "digest_items_10",    desc: "Digest 10 items",             stat: "itemsDigested",    target: 10, reward: { mana: 8 } },
  { id: "earn_gold_50",       desc: "Earn 50 gold in one run",     stat: "goldEarned",       target: 50, reward: { scrap: 4, mana: 4 } },
  { id: "earn_gold_100",      desc: "Earn 100 gold in one run",    stat: "goldEarned",       target: 100,reward: { scrap: 6, mana: 6 } },
  { id: "reach_level_3",      desc: "Reach level 3",               stat: "levelsCompleted",  target: 3,  reward: { scrap: 8 } },
  { id: "reach_level_5",      desc: "Reach level 5",               stat: "levelsCompleted",  target: 5,  reward: { scrap: 12 } },
  { id: "reach_level_7",      desc: "Reach level 7",               stat: "levelsCompleted",  target: 7,  reward: { mana: 12 } },
  { id: "use_ability_3",      desc: "Use your ability 3 times",    stat: "abilitiesUsed",    target: 3,  reward: { mana: 6 } },
  { id: "use_ability_5",      desc: "Use your ability 5 times",    stat: "abilitiesUsed",    target: 5,  reward: { mana: 10 } },
  { id: "pickup_items_8",     desc: "Pick up 8 items",             stat: "itemsPickedUp",    target: 8,  reward: { gold: 25 } },
  { id: "pickup_items_15",    desc: "Pick up 15 items",            stat: "itemsPickedUp",    target: 15, reward: { gold: 50 } },
  { id: "clear_dangerous",    desc: "Clear a Dangerous node",      stat: "dangerousCleared", target: 1,  reward: { scrap: 8, mana: 8 } },
];

// ---------- Story quests (sequential) ----------
export const STORY_QUESTS = [
  { id: "first_steps",       title: "First Steps",          desc: "Complete level 1",                     stat: "levelsCompleted",   target: 1,  reward: { xp: 10 } },
  { id: "growing_pains",     title: "Growing Pains",        desc: "Grow your slime once",                 stat: "growCount",         target: 1,  reward: { xp: 15 } },
  { id: "lab_rat",           title: "Lab Rat",              desc: "Visit the Upgrade Lab",                stat: "labVisits",         target: 1,  reward: { xp: 20 } },
  { id: "survival_instinct", title: "Survival Instinct",    desc: "Reach level 3 in a run",               stat: "levelsCompleted",   target: 3,  reward: { xp: 25 } },
  { id: "evolution",         title: "Evolution",            desc: "Choose a subclass",                    stat: "subclassChosen",    target: 1,  reward: { xp: 30, scrap: 10 } },
  { id: "stomach_of_steel",  title: "Stomach of Steel",     desc: "Digest 20 items (lifetime)",           stat: "totalItemsDigested",target: 20, reward: { xp: 30 } },
  { id: "dangerous_ground",  title: "Dangerous Ground",     desc: "Clear a Dangerous node",               stat: "dangerousCleared",  target: 1,  reward: { xp: 40 } },
  { id: "cell_biology",      title: "Cell Biology",         desc: "Visit the Slime Elder",                stat: "elderVisits",       target: 1,  reward: { xp: 30 } },
  { id: "halfway_there",     title: "Halfway There",        desc: "Reach level 5 in a run",               stat: "levelsCompleted",   target: 5,  reward: { xp: 50 } },
  { id: "mutation_master",   title: "Mutation Master",      desc: "Collect 5 mutations in one run",       stat: "mutationsCollected",target: 5,  reward: { xp: 50 } },
  { id: "well_equipped",     title: "Well Equipped",        desc: "Fill every inventory cell at once",    stat: "inventoryFull",     target: 1,  reward: { xp: 40 } },
  { id: "pet_owner",         title: "Pet Owner",            desc: "Adopt your first pet",                 stat: "petsOwned",         target: 1,  reward: { xp: 30, mana: 10 } },
  { id: "deep_delver",       title: "Deep Delver",          desc: "Reach level 8 in a run",               stat: "levelsCompleted",   target: 8,  reward: { xp: 60 } },
  { id: "alchemist",         title: "Alchemist",            desc: "Unlock a Mutation Lab recipe",         stat: "labRecipes",        target: 1,  reward: { xp: 40 } },
  { id: "ranch_hand",        title: "Ranch Hand",           desc: "Level a pet to level 3",               stat: "petMaxLevel",       target: 3,  reward: { xp: 50 } },
  { id: "fashion_forward",   title: "Fashion Forward",      desc: "Buy a wardrobe skin",                  stat: "skinsOwned",        target: 2,  reward: { xp: 30 } },
  { id: "elite_hunter",      title: "Elite Hunter",         desc: "Defeat 5 terminus elites (lifetime)",  stat: "totalElitesDefeated",target: 5, reward: { xp: 60, scrap: 15 } },
  { id: "master_chef",       title: "Master Chef",          desc: "Digest 100 items (lifetime)",          stat: "totalItemsDigested",target: 100,reward: { xp: 80 } },
  { id: "the_long_road",     title: "The Long Road",        desc: "Reach the final boss",                 stat: "levelsCompleted",   target: 9,  reward: { xp: 100 } },
  { id: "sovereign_slayer",  title: "Sovereign Slayer",     desc: "Defeat the Gelatinous Sovereign",      stat: "bossDefeated",      target: 1,  reward: { xp: 200 } },
];

// ---------- Achievements ----------
export const ACHIEVEMENTS = {
  first_blood:     { name: "First Blood",       desc: "Defeat your first enemy",                stat: "totalEnemiesDefeated",  target: 1,   gems: 5 },
  hungry_hungry:   { name: "Hungry Hungry",      desc: "Digest 100 items (lifetime)",           stat: "totalItemsDigested",    target: 100, gems: 10 },
  fashionista:     { name: "Fashionista",         desc: "Buy a wardrobe skin",                   stat: "skinsOwned",            target: 2,   gems: 5 },
  full_belly:      { name: "Full Belly",          desc: "Fill all inventory cells at once",      stat: "inventoryFull",         target: 1,   gems: 10 },
  untouchable:     { name: "Untouchable",         desc: "Clear a level taking zero damage",      stat: "flawlessLevels",        target: 1,   gems: 25 },
  speed_demon:     { name: "Speed Demon",         desc: "Clear level 1 in under 20 ticks",      stat: "speedClears",           target: 1,   gems: 15 },
  pet_collector:   { name: "Pet Collector",       desc: "Own 5 pets",                            stat: "petsOwned",             target: 5,   gems: 20 },
  veteran:         { name: "Veteran",             desc: "Complete 10 runs (lifetime)",           stat: "totalRunsCompleted",    target: 10,  gems: 15 },
  gold_hoarder:    { name: "Gold Hoarder",        desc: "Earn 500 gold in a single run",        stat: "goldEarned",            target: 500, gems: 20 },
  cell_master:     { name: "Cell Master",         desc: "Have 15+ inventory cells",             stat: "maxCells",              target: 15,  gems: 15 },
  mutation_lord:   { name: "Mutation Lord",        desc: "Collect 8 mutations in one run",       stat: "mutationsCollected",    target: 8,   gems: 20 },
  subclass_master: { name: "Subclass Master",      desc: "Win runs as 3 different subclasses",   stat: "uniqueSubclassWins",    target: 3,   gems: 50 },
  sovereign_slain: { name: "Sovereign Slayer",     desc: "Defeat the Gelatinous Sovereign",      stat: "bossDefeated",          target: 1,   gems: 100 },
};

export const ACHIEVEMENT_KEYS = Object.keys(ACHIEVEMENTS);

// ---------- Quest state helpers ----------
function ensureQuestState() {
  if (!state.meta.quests) {
    state.meta.quests = {
      daily: { lastReset: "", active: [], completed: [] },
      story: { current: 0, completed: [] },
    };
  }
  if (!state.meta.achievements) {
    state.meta.achievements = { unlocked: {}, stats: {} };
  }
  if (state.meta.gems == null) state.meta.gems = 0;
  return state.meta.quests;
}

function getStats() {
  return state.meta.achievements?.stats || {};
}

function setStat(key, value) {
  ensureQuestState();
  if (!state.meta.achievements.stats) state.meta.achievements.stats = {};
  state.meta.achievements.stats[key] = value;
}

function getStat(key) {
  return (state.meta.achievements?.stats || {})[key] || 0;
}

// ---------- Daily quest rotation ----------
function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function rollDailies() {
  const shuffled = [...DAILY_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map((tpl) => ({
    id: tpl.id,
    desc: tpl.desc,
    stat: tpl.stat,
    target: tpl.target,
    progress: 0,
    reward: { ...tpl.reward },
    completed: false,
  }));
}

export function refreshDailies() {
  const q = ensureQuestState();
  const today = todayString();
  if (q.daily.lastReset !== today) {
    q.daily.lastReset = today;
    q.daily.active = rollDailies();
    q.daily.completed = [];
    saveMeta(state.meta);
  }
}

// ---------- Event tracking ----------
// Called from game systems when something happens. Updates daily quests,
// story quest, and achievement stats. `key` is one of the stat names;
// `value` is the new total for that stat this run (or lifetime, depending).
export function trackEvent(key, value) {
  ensureQuestState();

  // Update daily quest progress (dailies track run-session values).
  for (const quest of state.meta.quests.daily.active) {
    if (quest.completed) continue;
    if (quest.stat === key) {
      quest.progress = Math.max(quest.progress, value);
      if (quest.progress >= quest.target) {
        quest.completed = true;
        grantQuestReward(quest.reward);
        pushLog(`Daily quest complete: ${quest.desc}`);
        showBanner("📋 Quest complete!", 1500);
      }
    }
  }

  // Update lifetime stats for achievements/story.
  const lifetimeKeys = [
    "totalEnemiesDefeated", "totalItemsDigested", "totalRunsCompleted",
    "totalElitesDefeated", "petsOwned", "skinsOwned", "labRecipes",
    "petMaxLevel", "uniqueSubclassWins", "bossDefeated", "flawlessLevels",
    "speedClears",
  ];
  if (lifetimeKeys.includes(key)) {
    setStat(key, Math.max(getStat(key), value));
  }

  // Per-run stats that also track to lifetime (take the max).
  const perRunKeys = [
    "levelsCompleted", "enemiesDefeated", "goldEarned", "itemsDigested",
    "itemsPickedUp", "abilitiesUsed", "dangerousCleared", "growCount",
    "labVisits", "elderVisits", "subclassChosen", "mutationsCollected",
    "inventoryFull", "maxCells",
  ];
  if (perRunKeys.includes(key)) {
    setStat(key, Math.max(getStat(key), value));
  }

  checkStoryProgress();
  checkAchievements();
  saveMeta(state.meta);
}

// Snapshot run stats to quest system at run end.
export function syncRunStats() {
  const rs = state.runStats;
  trackEvent("enemiesDefeated", rs.enemiesDefeated);
  trackEvent("itemsDigested", rs.itemsDigested);
  trackEvent("goldEarned", rs.goldEarned);
  trackEvent("levelsCompleted", rs.levelsCompleted);
  trackEvent("totalEnemiesDefeated", getStat("totalEnemiesDefeated") + rs.enemiesDefeated);
  trackEvent("totalItemsDigested", getStat("totalItemsDigested") + rs.itemsDigested);
  if (rs.bossDefeated) trackEvent("bossDefeated", 1);
  trackEvent("totalRunsCompleted", getStat("totalRunsCompleted") + 1);
  trackEvent("mutationsCollected", state.mutations.length);
  trackEvent("maxCells", state.inventory.length);
  if (state.inventory.every((c) => c.item)) {
    trackEvent("inventoryFull", 1);
  }
  // Unique subclass wins
  if (rs.bossDefeated && state.subclass) {
    const won = new Set(JSON.parse(getStat("_subclassWinsRaw") || "[]"));
    won.add(state.subclass);
    setStat("_subclassWinsRaw", JSON.stringify([...won]));
    trackEvent("uniqueSubclassWins", won.size);
  }
}

// Quick event fires — called inline from game code.
export function trackIncrement(key) {
  trackEvent(key, getStat(key) + 1);
}

function grantQuestReward(reward) {
  if (reward.xp) grantXp(state.meta, reward.xp);
  if (reward.gold) state.meta.gold = (state.meta.gold || 0) + reward.gold;
  if (reward.scrap) state.meta.scrap = (state.meta.scrap || 0) + reward.scrap;
  if (reward.mana) state.meta.mana = (state.meta.mana || 0) + reward.mana;
  if (reward.gems) state.meta.gems = (state.meta.gems || 0) + reward.gems;
}

// ---------- Story quest progress ----------
function checkStoryProgress() {
  const q = state.meta.quests;
  if (q.story.current >= STORY_QUESTS.length) return;
  const current = STORY_QUESTS[q.story.current];
  const statVal = getStat(current.stat);
  if (statVal >= current.target) {
    q.story.completed.push(q.story.current);
    grantQuestReward(current.reward);
    pushLog(`Story quest complete: ${current.title}`);
    showBanner(`📜 ${current.title}!`, 2000);
    q.story.current++;
    // Chain-check in case multiple quests are satisfied.
    checkStoryProgress();
  }
}

// ---------- Achievement checks ----------
function checkAchievements() {
  const ach = state.meta.achievements;
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    if (ach.unlocked[id]) continue;
    const statVal = getStat(def.stat);
    if (statVal >= def.target) {
      ach.unlocked[id] = true;
      state.meta.gems = (state.meta.gems || 0) + def.gems;
      pushLog(`Achievement unlocked: ${def.name} (+${def.gems}💠)`);
      showBanner(`🏆 ${def.name}!`, 2500);
    }
  }
}

// ---------- Quest Tracker UI (in-run panel) ----------
export function openQuestTracker() {
  ensureQuestState();
  refreshDailies();

  const wrap = document.createElement("div");
  wrap.className = "meta-menu";

  // Gems display
  const gemsLine = document.createElement("div");
  gemsLine.className = "meta-header";
  gemsLine.textContent = `💠 Gems: ${state.meta.gems || 0}`;
  wrap.appendChild(gemsLine);

  // Daily quests
  const dailyHeader = document.createElement("div");
  dailyHeader.style.cssText = "font-weight:bold;margin:8px 0 4px;color:#5bc0de;";
  dailyHeader.textContent = "📋 Daily Quests";
  wrap.appendChild(dailyHeader);

  for (const quest of state.meta.quests.daily.active) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #2a3356;";
    const left = document.createElement("span");
    left.style.cssText = quest.completed ? "color:#5cb85c;text-decoration:line-through;" : "color:#ccc;";
    left.textContent = quest.desc;
    row.appendChild(left);
    const right = document.createElement("span");
    right.style.cssText = "color:#8a93b8;font-size:12px;";
    if (quest.completed) {
      right.textContent = "✓ Done";
    } else {
      right.textContent = `${quest.progress}/${quest.target} → ${rewardString(quest.reward)}`;
    }
    row.appendChild(right);
    wrap.appendChild(row);
  }

  // Story quest
  const storyHeader = document.createElement("div");
  storyHeader.style.cssText = "font-weight:bold;margin:12px 0 4px;color:#f0ad4e;";
  storyHeader.textContent = "📜 Story Quest";
  wrap.appendChild(storyHeader);

  const q = state.meta.quests;
  if (q.story.current < STORY_QUESTS.length) {
    const current = STORY_QUESTS[q.story.current];
    const progress = getStat(current.stat);
    const row = document.createElement("div");
    row.style.cssText = "padding:4px 0;color:#ccc;";
    row.textContent = `${current.title}: ${current.desc} (${Math.min(progress, current.target)}/${current.target})`;
    wrap.appendChild(row);
  } else {
    const row = document.createElement("div");
    row.style.cssText = "padding:4px 0;color:#5cb85c;";
    row.textContent = "All story quests complete!";
    wrap.appendChild(row);
  }

  // Achievements
  const achHeader = document.createElement("div");
  achHeader.style.cssText = "font-weight:bold;margin:12px 0 4px;color:#bb6bd9;";
  achHeader.textContent = "🏆 Achievements";
  wrap.appendChild(achHeader);

  const ach = state.meta.achievements;
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    const unlocked = !!ach.unlocked[id];
    const progress = getStat(def.stat);
    const row = document.createElement("div");
    row.style.cssText = `display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1a2140;color:${unlocked ? "#5cb85c" : "#666"};font-size:13px;`;
    const left = document.createElement("span");
    left.textContent = unlocked ? `✓ ${def.name}` : `${def.name}: ${def.desc}`;
    row.appendChild(left);
    const right = document.createElement("span");
    right.style.cssText = "font-size:11px;";
    if (unlocked) {
      right.textContent = `+${def.gems}💠`;
    } else {
      right.textContent = `${Math.min(progress, def.target)}/${def.target}`;
    }
    row.appendChild(right);
    wrap.appendChild(row);
  }

  openModal({
    title: "📋 Quest Tracker",
    bodyEl: wrap,
    actions: [
      {
        label: "Close",
        primary: true,
        onClick: () => closeModal(),
      },
    ],
  });
}

function rewardString(reward) {
  const parts = [];
  if (reward.gold) parts.push(`${reward.gold}🪙`);
  if (reward.scrap) parts.push(`${reward.scrap}🔩`);
  if (reward.mana) parts.push(`${reward.mana}🔮`);
  if (reward.xp) parts.push(`${reward.xp} XP`);
  return parts.join(" + ");
}
