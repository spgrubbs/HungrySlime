// SlimeVenture — Random Events
// Text-based encounters served on `event` map nodes. Each event has a title,
// flavor text, and a list of choices with declarative effect payloads.
//
// The game module owns scene routing and effect resolution: events.js is pure
// data + tiny helpers so it can be expanded without touching game.js.

export const EVENTS = {
  wandering_merchant: {
    id: "wandering_merchant",
    title: "Wandering Merchant",
    text:
      "A robed figure rolls a creaking cart out of the mist. They eye your " +
      "gelatinous form curiously and gesture at their wares.",
    choices: [
      {
        label: "Buy a Healing Herb (10🪙)",
        requires: { gold: 10 },
        effects: [{ gold: -10 }, { item: "healing_herb" }],
        result: "You trade coins for the bundle of herbs.",
      },
      {
        label: "Buy a Slime Jelly (15🪙)",
        requires: { gold: 15 },
        effects: [{ gold: -15 }, { item: "slime_jelly" }],
        result: "The jelly throbs gently in your pseudopod.",
      },
      {
        label: "Wave goodbye",
        effects: [],
        result: "The merchant nods and rolls onward.",
      },
    ],
  },

  glowing_pool: {
    id: "glowing_pool",
    title: "Glowing Pool",
    text:
      "A small pool of phosphorescent liquid hums softly. It smells faintly " +
      "of ozone and ambition.",
    choices: [
      {
        label: "Drink deeply (heal 12, but -3 max HP)",
        effects: [{ heal: 12 }, { maxHp: -3 }],
        result: "Vitality surges, but something feels permanently thinner.",
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
    title: "Ancient Shrine",
    text:
      "A weathered idol of some forgotten slime-god watches the path. A bowl " +
      "at its base waits expectantly.",
    choices: [
      {
        label: "Offer 20🪙",
        requires: { gold: 20 },
        effects: [{ gold: -20 }, { mutation: true }],
        result: "The idol's eyes flash. A new strangeness blooms inside you.",
      },
      {
        label: "Offer your blood (-10 HP)",
        effects: [{ hp: -10 }, { heal: 0, randomItem: "uncommon" }],
        result:
          "You smear ichor across the idol; an item appears in the bowl.",
      },
      {
        label: "Bow respectfully",
        effects: [{ heal: 4 }],
        result: "A faint warmth fills you. Small mercies.",
      },
    ],
  },

  trapped_chest: {
    id: "trapped_chest",
    title: "Suspicious Chest",
    text:
      "An ornate chest sits in the middle of the path. The hinges look... " +
      "twitchy.",
    choices: [
      {
        label: "Open it",
        effects: [{ randomItem: "uncommon" }, { hp: -4 }],
        result: "Sprung! But you snatched something useful first.",
      },
      {
        label: "Inspect carefully (+2 ticks)",
        effects: [{ randomItem: "uncommon" }],
        result: "You disarm the trap and pocket the loot.",
      },
      {
        label: "Leave well enough alone",
        effects: [],
        result: "Probably for the best.",
      },
    ],
  },

  starving_traveler: {
    id: "starving_traveler",
    title: "Starving Traveler",
    text:
      "A gaunt adventurer slumps by the trail. They look up at you with a " +
      "wary, hungry hope.",
    choices: [
      {
        label: "Share 15🪙",
        requires: { gold: 15 },
        effects: [{ gold: -15 }, { mutation: true }],
        result:
          "They press a glowing nodule into your jelly. 'Saved my life,' they whisper.",
      },
      {
        label: "Offer comfort (heal 3 to self)",
        effects: [{ heal: 3 }],
        result: "Just being kind feels nice.",
      },
      {
        label: "Continue on",
        effects: [],
        result: "You leave them to their fate.",
      },
    ],
  },

  echoing_cavern: {
    id: "echoing_cavern",
    title: "Echoing Cavern",
    text:
      "A side cave whispers your name back at you in twelve different voices.",
    choices: [
      {
        label: "Enter the cave",
        effects: [{ randomItem: "common" }, { randomItem: "common" }],
        result: "You emerge with two trinkets and a faint headache.",
      },
      {
        label: "Shout into the dark",
        effects: [{ gold: 12 }],
        result: "Coins rain from the ceiling. You don't ask why.",
      },
      {
        label: "Keep moving",
        effects: [],
        result: "Some mysteries are best left buried.",
      },
    ],
  },

  blob_brethren: {
    id: "blob_brethren",
    title: "Blob Brethren",
    text:
      "A cluster of small green blobs bows reverently before you. Their tiny " +
      "leader gestures with three pseudopods.",
    choices: [
      {
        label: "Absorb one (+8 max HP)",
        effects: [{ maxHp: 8 }, { heal: 8 }],
        result:
          "The cluster mourns briefly, then resumes their pilgrimage.",
      },
      {
        label: "Trade lessons (gain a mutation)",
        effects: [{ mutation: true }],
        result: "They share an ancient ooze technique.",
      },
      {
        label: "Bless and depart",
        effects: [{ heal: 5 }],
        result: "You feel spiritually refreshed.",
      },
    ],
  },
};

export const EVENT_KEYS = Object.keys(EVENTS);

export function rollEvent() {
  return EVENT_KEYS[Math.floor(Math.random() * EVENT_KEYS.length)];
}
