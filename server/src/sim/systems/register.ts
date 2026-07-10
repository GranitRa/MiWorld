import { registerSystem } from "../engine";
import { environmentSystem } from "./environment";
import { resourcesSystem } from "./resources";
import { constructionSystem } from "./construction";

// Register simulation systems in fixed tick order. Called once at startup, BEFORE boot, so
// the boot catch-up fast-forward runs the economy too.
let registered = false;
export function registerSystems(): void {
  if (registered) return;
  registered = true;
  registerSystem(environmentSystem);
  registerSystem(resourcesSystem);
  registerSystem(constructionSystem);
  // WP-7+ will append: population, earth, crises, milestones.
}
