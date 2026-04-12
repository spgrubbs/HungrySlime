# SlimeVenture — Game Design Document

## 1. Overview

**Genre:** Roguelike / Inventory Management / Real-Time Strategy
**Platform Target:** Android (portrait orientation), with web prototype first
**Inspirations:** Backpack Brawler, Backpack Hero, Slay the Spire (meta-structure), slime fantasy tropes
**Perspective:** 2D, top-down/side-hybrid, pixel art style

**Elevator Pitch:** You are a slime hopping down a dangerous path. Your body *is* your inventory. Eat items to digest them into resources, hold items for passive effects, and dodge obstacles across three lanes — all in real time. Grow bigger to carry more, but never stop moving.

---

## 2. Core Pillars

1. **Your body is your bag.** Inventory size = slime size. Growing is powerful but costly.
2. **Digestion as a mechanic.** The stomach isn't just storage — it's a converter. Choosing *what* to eat and *when* is the central decision.
3. **Real-time with breathing room.** The treadmill ticks at a steady pace (not framerate-dependent action). A pause button lets players think. Strategy over reflexes.
4. **Roguelike tension.** Permadeath runs across ~5 levels with branching paths, escalating difficulty, and meta-progression between runs.

---

## 3. Screen Layout (Portrait Orientation)

The screen is split into two panels stacked vertically:

```
┌─────────────────────────┐
│                         │
│     PATH VIEWPORT       │
│   (top ~45% of screen)  │
│                         │
│  [Lane 1] ──────────▶   │
│  [Lane 2] ──────────▶   │
│  [Lane 3] ──────────▶   │
│                         │
├─────────────────────────┤
│                         │
│   INVENTORY / SLIME     │
│   (bottom ~45%)         │
│                         │
│  ┌───────────────────┐  │
│  │  Held Items Grid  │  │
│  │                   │  │
│  │  ┌─── Stomach ──┐ │  │
│  │  │ (digesting)   │ │  │
│  │  └───────────────┘ │  │
│  └───────────────────┘  │
│                         │
├─────────────────────────┤
│ [HP] [Gold] [▲][▼] [⏸] │
│     (bottom ~10% HUD)   │
└─────────────────────────┘
```

### HUD Bar (bottom strip)
- **HP** — current / max health
- **Gold** — currency for growing, shops, etc.
- **Lane Buttons (▲ / ▼)** — move the slime up or down one lane; bottom-right placement for right-thumb accessibility
- **Pause (⏸)** — freezes the treadmill and all timers; inventory can still be rearranged while paused

---

## 4. The Path Viewport (Top Half)

### 4.1 Treadmill Mechanic

The slime sits at the left-center of the viewport, bobbing in place. The world scrolls right-to-left in discrete **ticks**.

| Parameter | Default Value | Notes |
|---|---|---|
| Tick interval | 1.5 seconds | Time between each scroll step |
| Scroll distance per tick | 1 tile width | Each entity on the path moves one tile left |
| Columns visible | 6–8 | How far ahead the player can see |

Between ticks the scene is static (aside from idle animations). This gives the game a board-game-like rhythm.

### 4.2 Three Lanes

Lanes are horizontal rows. The slime occupies exactly one lane at a time. Lane-switching is instant and can be done between or during ticks (no cooldown).

### 4.3 Entities on the Path

Entities spawn at the right edge and scroll left. When an entity reaches the slime's column, an **encounter** triggers.

| Entity Type | Encounter Behavior |
|---|---|
| **Enemy** | Enters melee range. Slime and enemy trade damage each tick until one is dead. Enemy blocks forward progress (treadmill pauses for that lane) while alive. |
| **Item Pickup** | Auto-collected into the first open inventory slot. If inventory is full, the item is pushed past and lost. |
| **Obstacle** | Deals a fixed amount of damage and is destroyed. Cannot be fought — must be dodged or tanked. |
| **Location / Building** | Triggers a modal interaction (shop, shrine, event) when the slime's column overlaps it. Treadmill pauses during interaction. |
| **Terminus** | A large enemy/obstacle at the end of the level. Must be defeated to complete the level. |

### 4.4 Combat (Passive / Bump)

Combat is automatic. When an enemy occupies the same column and lane as the slime:

1. **Each tick**, the slime deals its attack value to the enemy, and the enemy deals its attack value to the slime.
2. The slime's attack value is determined by held weapon items and buffs.
3. If the slime has no weapon, it deals a small base damage (1).
4. Enemies do not advance while in combat (they are "stuck" bumping the slime).
5. Multiple enemies can queue up behind each other in the same lane.

The player's agency in combat comes from:
- **Lane choice:** avoid enemies entirely, or choose which to engage.
- **Inventory management:** equip/eat items mid-combat to change stats.
- **Pause and plan:** pause to rearrange inventory during a tough fight.

---

## 5. The Inventory System (Bottom Half)

### 5.1 Slime Body Grid

The inventory is a grid of cells representing the slime's body. It is divided into two regions:

```
┌─────────────────────────────┐
│  HELD ZONE                  │
│  ┌──┬──┬──┬──┐              │
│  │  │  │  │  │  ← items     │
│  ├──┼──┼──┼──┤    held here │
│  │  │  │  │  │    provide   │
│  └──┴──┴──┴──┘    passive   │
│                    effects  │
│  ┌──────────────┐           │
│  │  STOMACH     │ ← items   │
│  │  ┌──┬──┐     │   placed  │
│  │  │  │  │     │   here    │
│  │  └──┴──┘     │   digest  │
│  └──────────────┘           │
└─────────────────────────────┘
```

- **Held Zone:** items here provide continuous passive effects (stat bonuses, auras, resource generation). Items occupy 1 or more cells (Tetris-style shapes).
- **Stomach Zone:** items placed here are consumed over a digestion timer. When digestion completes, the item is destroyed and yields its digestion output (resources, HP, buffs). Stomach has fewer cells than the held zone.

### 5.2 Slime Size and Growth

| Attribute | Starting Value | Growth Mechanic |
|---|---|---|
| Total grid cells | 6 (4 held + 2 stomach) | Spend gold to add cells |
| Growth cost | 10 gold (first), scaling +5 per growth | Exponential-ish cost curve |
| Max grid cells | 24 (base, upgradeable via meta) | Hard cap per run |
| Stomach ratio | ~33% of total cells are stomach | Ratio stays roughly consistent as slime grows; player chooses whether new cells are held or stomach |

Growing the slime is done at any time via a button on the inventory panel (if the player has enough gold). A growth modal lets the player choose where to add the new cell (expanding the grid in a chosen direction) and whether it is a held cell or a stomach cell.

### 5.3 Item Properties

Every item has the following attributes:

```
Item {
  name: string
  shape: Cell[]            // which cells it occupies (e.g., 1x1, 2x1, L-shape)
  rarity: Common | Uncommon | Rare | Legendary
  heldEffect: Effect | null      // passive effect while in the held zone
  digestOutput: DigestResult     // what it yields when fully digested
  digestTime: number             // ticks to fully digest
  tags: string[]                 // e.g., ["weapon", "organic", "fire"]
  flavorText: string
}
```

### 5.4 Example Items

| Item | Shape | Held Effect | Digest Output | Digest Time | Tags |
|---|---|---|---|---|---|
| Rusty Sword | 2x1 | +2 attack | 3 scrap metal | 8 ticks | weapon, metal |
| Healing Herb | 1x1 | +1 HP regen / 5 ticks | Restore 10 HP | 3 ticks | organic, healing |
| Gold Nugget | 1x1 | None | +15 gold | 4 ticks | mineral, valuable |
| Flame Core | 1x1 | +1 fire damage to attacks | Grants "Burn Aura" buff (10 ticks) | 6 ticks | elemental, fire |
| Shield Fragment | 1x2 | -1 damage taken | 5 scrap metal | 10 ticks | armor, metal |
| Slime Jelly | 1x1 | +1 max HP (while held) | Restore 5 HP + gain 1 permanent max HP | 2 ticks | organic, slime |
| Bomb | 1x1 | None (dangerous to hold — explodes if held > 10 ticks, dealing 5 self-damage) | Deals 20 damage to current enemy | 1 tick | explosive, dangerous |
| Magnet Stone | 1x1 | Auto-collects items from adjacent lanes | 2 scrap metal | 6 ticks | mineral, utility |

### 5.5 Interaction Rules

- **Drag and drop:** player drags items between held zone and stomach, or rearranges within zones. This works while paused or in real time.
- **Auto-pickup placement:** items picked up from the path are placed in the first available held-zone slot. If held zone is full, overflow goes to stomach (and starts digesting immediately). If both are full, item is lost.
- **Discard:** items can be dragged off the grid to discard them.
- **Stomach queue:** only items fully inside the stomach zone digest. Digestion progress is shown as a radial timer overlay on the item.

---

## 6. Resources and Economy

| Resource | Source | Use |
|---|---|---|
| **Gold** | Enemy drops, item digestion, pickups | Growing the slime, shop purchases, some ability activations |
| **Scrap Metal** | Digesting metal-tagged items | Upgrading/reforging items at anvil locations |
| **Essence** | Digesting elemental items, rare drops | Unlocking elemental abilities, powering strong buffs |
| **HP** | Digesting organic items, regen effects | Staying alive |

Resources are displayed as small counters on the HUD bar.

---

## 7. Level Structure

### 7.1 Single Level Flow

```
[Spawn] → [Treadmill Path: enemies, items, obstacles, buildings] → [Terminus Enemy/Obstacle]
```

A level lasts approximately 40–60 ticks (~1–1.5 minutes of real time at default tick speed). The path is procedurally generated from a difficulty budget that scales per level.

### 7.2 Path Generation Parameters

Each level has a **difficulty budget** spent on spawning entities:

| Entity | Difficulty Cost | Spawn Rules |
|---|---|---|
| Weak enemy | 1 | Can appear in any lane |
| Strong enemy | 3 | Appears alone in its lane (no adjacent lane enemies on same column) |
| Item pickup | 0 | Spawns to reward or bait the player |
| Obstacle | 1–2 | Often placed to force lane switches |
| Location | 0 | 1–2 per level, spaced apart |
| Terminus | fixed per level | Always last entity |

Items and locations have a 0 cost because they benefit the player — they're placed for pacing and reward, not difficulty.

### 7.3 Run Structure

A full run consists of ~5 levels connected by a branching path map (Slay the Spire style):

```
Level 1 (easy)
   ├── Level 2a (combat-heavy)
   │     ├── Level 3a (treasure-rich)
   │     └── Level 3b (event-heavy)
   └── Level 2b (event-heavy)
         ├── Level 3a (shared node)
         └── Level 3c (combat-heavy)
               ...
Level 5: BOSS
```

**Node types on the map:**
- **Combat:** more enemies, more loot
- **Treasure:** more item pickups, fewer enemies
- **Event:** more locations/buildings with special interactions
- **Elite:** a mini-boss terminus with better rewards
- **Boss:** final level of the run; unique boss enemy with special mechanics

### 7.4 Between Levels

After completing a level, the player sees the branching map and picks their next node. There is no separate shopping phase — shops exist *on* the path as location entities. Between levels, the player can:
- View/rearrange inventory
- Review the map
- Spend resources on growth (if they haven't already)

---

## 8. Enemies

### 8.1 Enemy Data Model

```
Enemy {
  name: string
  hp: number
  attack: number
  speed: number           // some enemies take 2 ticks to act instead of 1
  loot: LootTable
  tags: string[]          // e.g., ["undead", "fire-resistant"]
  specialAbility: Ability | null
  spriteKey: string
}
```

### 8.2 Example Enemies

| Enemy | HP | ATK | Speed | Special | Loot |
|---|---|---|---|---|---|
| Green Blob | 5 | 1 | 1 | None | 2 gold |
| Skeleton | 10 | 3 | 1 | None | Rusty Sword (30%) or 5 gold |
| Fire Imp | 8 | 2 | 1 | Burns the slime for 1 damage/tick for 3 ticks after death | Flame Core (20%) or 3 gold |
| Stone Golem | 25 | 5 | 2 (acts every 2 ticks) | Takes half damage from non-metal weapons | 10 gold + Shield Fragment (40%) |
| Mimic | 12 | 4 | 1 | Disguised as an item pickup until the slime's column | Random rare item (100%) |
| Rat Swarm | 3 each | 1 each | 1 | Spawns as a group of 3 in the same column across all lanes | 1 gold each |

### 8.3 Terminus Enemies

Each level ends with a tougher enemy. Terminus enemies may have:
- Multiple health phases
- Lane-switching behavior (forcing the player to chase or dodge)
- AoE attacks that hit adjacent lanes
- Damage reduction that requires specific item types to bypass

### 8.4 Boss Enemies (Level 5)

Bosses are unique encounters with scripted phases and dedicated mechanics. Example:

**The Gelatinous King** (fellow slime, gone wrong)
- Phase 1: Standard combat, but absorbs one of the player's items each time it takes a hit (removing it from inventory).
- Phase 2 (50% HP): Splits into two smaller copies across two lanes that must be defeated simultaneously within 3 ticks of each other, or the surviving copy regenerates.
- Phase 3 (25% HP): Uses absorbed items against the player with amplified effects.

---

## 9. Locations and Events

Locations appear as buildings or landmarks on the path. When the slime overlaps one, a modal opens and the treadmill pauses.

| Location | Effect |
|---|---|
| **Shop** | Buy items with gold. 3–5 items on offer, scaling with level. |
| **Anvil** | Spend scrap metal to upgrade a held item (+1 to its primary stat) or reforge it into a random item of the same rarity. |
| **Shrine** | Choose one of 2–3 random blessings (run-long passive buffs). May have a cost (HP, gold, or sacrificing an item). |
| **Fountain** | Restore HP. Amount scales with slime size. |
| **Mysterious Pool** | Gamble: drop an item in, receive a random item of higher rarity (70%) or lose it entirely (30%). |
| **Merchant Caravan** | Sell items for gold. Prices are 50% of shop buy price. |
| **Slime Elder** | Offers a choice: permanently convert 1 held cell into a stomach cell, or vice versa. Free, but irreversible for the run. |

---

## 10. Buffs and Status Effects

Effects can apply to the slime or to enemies.

| Effect | Target | Description | Duration |
|---|---|---|---|
| Burn | Either | Take 1 damage per tick | Ticks-based |
| Poison | Either | Take 1 damage per tick, stacks intensity | Ticks-based |
| Shield | Slime | Absorb next N damage | Until depleted |
| Haste | Slime | Tick interval reduced by 25% (things move faster, but slime also acts faster) | Ticks-based |
| Slow | Either | Affected entity acts every 2 ticks instead of 1 | Ticks-based |
| Burn Aura | Slime | All enemies in combat take 1 fire damage per tick | Ticks-based |
| Sticky | Slime | Items picked up go directly to stomach | Ticks-based |
| Acid | Slime | Digestion speed doubled | Ticks-based |
| Bloat | Slime | +2 temporary held cells | Ticks-based |

---

## 11. Meta-Progression

Between runs (after death or victory), the player earns **Slime XP** based on:
- Levels completed
- Enemies defeated
- Gold earned
- Items digested
- Boss defeated (large bonus)

Slime XP is spent on a permanent upgrade tree:

### 11.1 Upgrade Categories

**Body Upgrades**
- Starting grid size: 6 → 8 → 10
- Max grid size: 24 → 28 → 32
- Starting stomach cells: 2 → 3 → 4
- Base HP: 20 → 25 → 30 → 40

**Ability Unlocks**
- Elemental Affinity: choose a starting element (fire, ice, acid, electric). Grants a free elemental item at run start and bonus damage/effects for matching-element items.
- Quick Digest: stomach digests 25% faster baseline
- Magnetic Body: auto-collect items from adjacent lanes (no magnet stone needed)
- Second Stomach: a second, smaller stomach zone (2 cells) that digests independently

**Starting Equipment**
- Unlock specific items that can be chosen as starting loadout (pick 1–3 depending on upgrade level)
- Examples: "Start with a Rusty Sword," "Start with 2 Healing Herbs," "Start with a Flame Core"

**Cosmetics**
- Slime color variations
- Trail effects
- Idle animation variants

### 11.2 Unlock Flow

Upgrades are arranged in tiers. Each tier requires a total XP threshold to unlock access, then individual upgrades within the tier cost XP to purchase. This prevents players from rushing one branch.

---

## 12. Technical Architecture Notes

### 12.1 Target Stack

- **Engine:** Web-first (HTML5 Canvas or a lightweight framework like Phaser 3), wrapped for Android via Capacitor or similar
- **Language:** TypeScript
- **State Management:** A central game state object that drives all rendering; tick-based updates make this straightforward
- **Rendering:** 2D sprite-based; no physics engine needed (grid/lane positioning is discrete)

### 12.2 Core Systems to Build

1. **Tick Engine** — master clock that fires every N ms. All game logic subscribes to tick events. Pause toggles the clock.
2. **Path Generator** — procedurally creates a sequence of lane-entity placements for a level given a difficulty budget and entity pool.
3. **Inventory Grid Manager** — handles the slime body grid: cell states (held/stomach/empty/locked), item placement with shape collision, drag-and-drop input.
4. **Digestion Processor** — each tick, advances digestion timers for all items in stomach cells. On completion, applies digest output and removes item.
5. **Combat Resolver** — each tick, resolves damage between the slime and any enemy in the same column/lane. Applies buffs, debuffs, loot drops.
6. **Entity Manager** — tracks all entities on the path, handles spawning at the right edge, scrolling per tick, and despawning at the left edge.
7. **Lane Controller** — handles player input for lane switching; validates movement; fires events for encounter checks.
8. **Run Manager** — tracks level progression, branching map state, meta-XP accumulation, and run-end conditions (death or boss victory).
9. **Meta-Progression Store** — persistent storage (localStorage for web, device storage for Android) for XP, unlocks, and cosmetics.
10. **UI Manager** — renders the split-screen layout, HUD, modals (shop, events), and handles touch input routing (path viewport vs. inventory vs. HUD).

### 12.3 Input Considerations (Android)

- All interactions are touch-based.
- Lane switching: large tap targets in the bottom-right corner (thumb zone).
- Inventory management: drag-and-drop with touch; long-press to pick up an item, drag to reposition, release to place. Snap-to-grid.
- Pause button: always accessible, never obscured.
- No pinch-to-zoom or multi-touch required.

### 12.4 Data-Driven Design

All items, enemies, locations, buffs, and level generation parameters should be defined in JSON data files, not hardcoded. This enables:
- Easy balancing iteration
- Modding potential
- Clean separation of logic and content

---

## 13. Prototype Milestones

### Milestone 1 — The Treadmill
- Render the 3-lane path viewport with placeholder sprites
- Implement the tick engine
- Spawn entities at the right edge and scroll them left
- Player can switch lanes via buttons
- Basic collision detection (slime column vs. entity column)

### Milestone 2 — Inventory Grid
- Render the slime body grid with held and stomach zones
- Implement drag-and-drop item placement
- Items auto-placed on pickup
- Digestion timer runs each tick, consuming items and granting outputs

### Milestone 3 — Combat and Enemies
- Enemies have HP and attack values
- Bump combat resolves each tick
- Enemies drop loot
- Slime HP decreases and can trigger game over
- Held weapon items modify attack power

### Milestone 4 — Full Level Loop
- Path generator creates a full level from a difficulty budget
- Terminus enemy at the end of the level
- Locations (shop, fountain) trigger modals
- Obstacles deal damage
- Level-complete screen after terminus is defeated

### Milestone 5 — Run Structure
- Branching map between levels
- 5-level run with boss at the end
- 1 boss implemented with phased behavior
- Run-end screen showing stats

### Milestone 6 — Meta-Progression
- XP awarded at run end
- Persistent upgrade tree (stored in localStorage)
- Starting loadout selection
- At least 2 tiers of upgrades functional

### Milestone 7 — Content and Polish
- Full item roster (~30 items across rarities)
- Full enemy roster (~15 enemies + 3 bosses)
- All location types implemented
- Buff/debuff system complete
- Sound effects and music
- Sprite art pass (replace placeholders)
- Android build via Capacitor

---

## 14. Balance Levers

These are the primary knobs for tuning difficulty and pacing:

| Lever | Effect |
|---|---|
| Tick interval | Faster = harder (less time to think/rearrange) |
| Difficulty budget per level | More = more enemies/obstacles |
| Gold drop rates | Higher = easier (more growth, more shop buys) |
| Slime growth cost curve | Steeper = harder (forces more careful resource management) |
| Digestion speed | Faster = easier (more throughput from stomach) |
| Item spawn density | More items = easier (more resources, more choice) |
| Enemy HP/ATK scaling per level | Steeper = harder |
| Stomach-to-held cell ratio | More stomach = more resource generation but less passive power |
| Terminus enemy stat scaling | Controls how hard the level gate is |

---

## 15. Open Design Questions

These are intentionally left unresolved for playtesting to answer:

1. **Should the slime be able to attack enemies in adjacent lanes?** (e.g., with AoE items or abilities) — this would reduce lane-switching pressure.
2. **Should enemies move between lanes?** Currently only the player lane-switches. Mobile enemies would increase difficulty and variety.
3. **Should there be an "eject" mechanic?** The slime could spit out a held item as a projectile, dealing damage based on the item but losing it.
4. **How punishing should inventory overflow be?** Currently items are simply lost. Alternatives: items bounce to an adjacent lane, items sit on the ground for a few ticks before despawning.
5. **Should digestion be interruptible?** If an item is pulled out of the stomach mid-digest, does it reset progress or retain partial progress?
6. **What is the ideal run length in real-world minutes?** Target is 10–15 minutes per run, but this needs playtesting.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **Tick** | One discrete step of the game clock. All actions resolve per tick. |
| **Treadmill** | The scrolling path in the top viewport. |
| **Held Zone** | The portion of the inventory grid where items provide passive effects. |
| **Stomach Zone** | The portion of the inventory grid where items are digested over time. |
| **Terminus** | The final enemy or obstacle of a level that must be overcome to proceed. |
| **Bump Combat** | Automatic combat that occurs when the slime and an enemy share a column and lane. |
| **Run** | A single playthrough from Level 1 through the boss (or death). |
| **Meta-Progression** | Permanent upgrades purchased with XP between runs. |
| **Difficulty Budget** | A numerical value used by the path generator to determine how many and which enemies/obstacles to spawn in a level. |
