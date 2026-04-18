// SlimeVenture — Random Events
// Text-based encounters served on `event` map nodes. Each event has a title,
// flavor text, and a list of choices with declarative effect payloads.
// Themed around slime biology, clockwork ruins, and nature overgrowth.

export const EVENTS = {
  wandering_merchant: {
    id: "wandering_merchant",
    title: "Tinker's Cart",
    text:
      "A hunched figure pushes a cart of salvaged clockwork through the " +
      "undergrowth. Gears click softly as they study your gelatinous form.",
    choices: [
      {
        label: "Buy Mossbloom (10🪙)",
        requires: { gold: 10 },
        effects: [{ gold: -10 }, { item: "healing_herb" }],
        result: "The tinker wraps the moss in oiled cloth and hands it over.",
      },
      {
        label: "Buy Gear Scrap (8🪙)",
        requires: { gold: 8 },
        effects: [{ gold: -8 }, { item: "gear_scrap" }],
        result: "Bent cogs and sprockets, still warm from some buried engine.",
      },
      {
        label: "Wave goodbye",
        effects: [],
        result: "The tinker nods and wheels deeper into the forest.",
      },
    ],
  },

  glowing_pool: {
    id: "glowing_pool",
    title: "Bioluminescent Wellspring",
    text:
      "A pool of phosphorescent slime hums in a hollow stump. The light " +
      "pulses in rhythm with your own body.",
    choices: [
      {
        label: "Drink deeply (heal 12, but -3 max HP)",
        effects: [{ heal: 12 }, { maxHp: -3 }],
        result: "Vitality surges, but your membrane thins permanently.",
      },
      {
        label: "Bathe in it (+5 max HP, -8 HP)",
        effects: [{ maxHp: 5 }, { hp: -8 }],
        result: "Your membrane stretches painfully — but holds more now.",
      },
      {
        label: "Don't risk it",
        effects: [],
        result: "The pool burbles to itself as you slither past.",
      },
    ],
  },

  ancient_shrine: {
    id: "ancient_shrine",
    title: "Overgrown Shrine",
    text:
      "Vines have nearly consumed a weathered idol of the Slime Mother. " +
      "A bowl at its base overflows with rainwater and tiny gears.",
    choices: [
      {
        label: "Offer 20🪙",
        requires: { gold: 20 },
        effects: [{ gold: -20 }, { mutation: true }],
        result: "The idol's eyes flash. A new strangeness blooms inside you.",
      },
      {
        label: "Offer your ichor (-10 HP)",
        effects: [{ hp: -10 }, { heal: 0, randomItem: "uncommon" }],
        result: "You smear ichor across the idol; something materializes in the bowl.",
      },
      {
        label: "Bow respectfully",
        effects: [{ heal: 4 }],
        result: "A faint warmth fills you. The forest remembers kindness.",
      },
    ],
  },

  clockwork_cache: {
    id: "clockwork_cache",
    title: "Rusted Automaton",
    text:
      "A deactivated automaton lies half-buried in roots and moss. Its " +
      "chest cavity hangs open, gears frozen mid-turn. Something glints inside.",
    choices: [
      {
        label: "Reach inside",
        effects: [{ randomItem: "uncommon" }, { hp: -4 }],
        result: "A spring snaps! But you snatched something useful first.",
      },
      {
        label: "Carefully disassemble",
        effects: [{ randomItem: "uncommon" }],
        result: "Patient work yields clean salvage.",
      },
      {
        label: "Leave it undisturbed",
        effects: [],
        result: "The forest will claim it eventually.",
      },
    ],
  },

  lost_sapling: {
    id: "lost_sapling",
    title: "Withered Sapling",
    text:
      "A young tree has uprooted itself and wanders the path, its roots " +
      "dragging behind it. It looks exhausted.",
    choices: [
      {
        label: "Share nutrients (-15🪙)",
        requires: { gold: 15 },
        effects: [{ gold: -15 }, { mutation: true }],
        result: "It presses a seed into your membrane. Ancient knowledge flows in.",
      },
      {
        label: "Shelter it briefly (heal 3)",
        effects: [{ heal: 3 }],
        result: "The sapling's gratitude is palpable, if wordless.",
      },
      {
        label: "Continue on",
        effects: [],
        result: "It watches you leave with bark-rimmed eyes.",
      },
    ],
  },

  echoing_cavern: {
    id: "echoing_cavern",
    title: "Resonance Grotto",
    text:
      "A cave of crystallized amber echoes with the hum of ancient " +
      "clockwork far below. Mineral deposits glint in the walls.",
    choices: [
      {
        label: "Explore the depths",
        effects: [{ randomItem: "common" }, { randomItem: "common" }],
        result: "You emerge with two finds and a faint ringing in your membrane.",
      },
      {
        label: "Sing into the dark",
        effects: [{ gold: 12 }],
        result: "Amber fragments rain from the ceiling. You don't ask why.",
      },
      {
        label: "Keep moving",
        effects: [],
        result: "Some depths are best left undisturbed.",
      },
    ],
  },

  blob_brethren: {
    id: "blob_brethren",
    title: "Ooze Pilgrims",
    text:
      "A cluster of small green blobs bows reverently before you. Their tiny " +
      "elder gestures with three pseudopods, offering communion.",
    choices: [
      {
        label: "Absorb one (+8 max HP)",
        effects: [{ maxHp: 8 }, { heal: 8 }],
        result: "The cluster mourns briefly, then resumes their pilgrimage.",
      },
      {
        label: "Trade lessons (gain a mutation)",
        effects: [{ mutation: true }],
        result: "They share an ancient ooze technique passed through generations.",
      },
      {
        label: "Bless and depart",
        effects: [{ heal: 5 }],
        result: "You feel spiritually refreshed.",
      },
    ],
  },

  fungal_ring: {
    id: "fungal_ring",
    title: "Fairy Ring",
    text:
      "A perfect circle of luminous mushrooms pulses with spore-light. " +
      "The air tastes of petrichor and possibility.",
    choices: [
      {
        label: "Step inside the ring",
        effects: [{ randomItem: "rare" }, { hp: -6 }],
        result: "Reality blinks. You stumble out clutching something strange.",
      },
      {
        label: "Harvest the mushrooms",
        effects: [{ item: "toxic_mushroom" }, { item: "toxic_mushroom" }],
        result: "The ring dims as you pluck its children. Two fine specimens.",
      },
      {
        label: "Observe from safety",
        effects: [{ heal: 6 }],
        result: "The spores drift over you, knitting small wounds closed.",
      },
    ],
  },

  gear_storm: {
    id: "gear_storm",
    title: "Gear Storm",
    text:
      "The sky darkens with spinning cogs — a cascade of clockwork debris " +
      "rains from the canopy above. Something massive broke apart up there.",
    choices: [
      {
        label: "Dash through (risk damage)",
        effects: [{ hp: -5 }, { item: "automaton_core" }],
        result: "Gears slice your membrane, but you snatch a glowing core from the rain.",
      },
      {
        label: "Shield and collect scraps",
        effects: [{ item: "gear_scrap" }, { item: "gear_scrap" }],
        result: "You hunker down and gather what falls safely.",
      },
      {
        label: "Wait it out",
        effects: [],
        result: "The storm passes. The forest floor glitters with bent metal.",
      },
    ],
  },

  ancient_mechanism: {
    id: "ancient_mechanism",
    title: "Dormant Engine",
    text:
      "A massive gear-driven mechanism sits in a clearing, its brass housing " +
      "strangled by ivy. A single lever protrudes, trembling slightly.",
    choices: [
      {
        label: "Pull the lever",
        effects: [{ randomItem: "rare" }, { gold: 15 }],
        result: "Gears screech to life! A compartment opens, spilling treasures.",
      },
      {
        label: "Digest part of the mechanism",
        effects: [{ heal: 15 }, { gold: 10 }],
        result: "The brass dissolves nicely. Nutritious and profitable.",
      },
      {
        label: "Study the markings",
        effects: [{ mutation: true }],
        result: "The engravings teach you something about your own internal clockwork.",
      },
    ],
  },

  symbiotic_grove: {
    id: "symbiotic_grove",
    title: "Symbiotic Grove",
    text:
      "Trees here have grown around clockwork scaffolding — living wood " +
      "threaded with copper veins. The boundary between machine and nature " +
      "has dissolved completely.",
    choices: [
      {
        label: "Commune with the grove (+10 HP, +10🪙)",
        effects: [{ heal: 10 }, { gold: 10 }],
        result: "The grove accepts you as kin. Sap and oil flow freely.",
      },
      {
        label: "Extract a copper-root (rare item)",
        effects: [{ randomItem: "rare" }, { hp: -3 }],
        result: "The grove shudders as you pull, but yields its treasure.",
      },
      {
        label: "Rest under the canopy",
        effects: [{ heal: 8 }],
        result: "Filtered light and the tick of hidden gears lull you to peace.",
      },
    ],
  },
};

export const EVENT_KEYS = Object.keys(EVENTS);

export function rollEvent() {
  return EVENT_KEYS[Math.floor(Math.random() * EVENT_KEYS.length)];
}
