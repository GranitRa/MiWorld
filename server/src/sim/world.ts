// World bootstrap. A fresh world is deliberately near-empty at WP-2 — the landing crew,
// terrain resources and buildings arrive in later work packages. WP-2 only needs a world
// that can tick and survive restarts.

import { GOODS, type ResourceLedger, type World } from "@miworld/shared";

function emptyLedger(): ResourceLedger {
  const ledger = {} as ResourceLedger;
  for (const good of GOODS) ledger[good] = { amount: 0, cap: 1000 };
  return ledger;
}

export function createWorld(seed: number): World {
  return {
    seed,
    epoch: 1,
    worldTimeSec: 0,
    status: "alive",
    settlementName: null,
    treasury: emptyLedger(),
    buildings: [],
    colonists: [],
    pools: {},
  };
}
