import { registerSystem } from "../engine";
import { environmentSystem } from "./environment";
import { crisesSystem } from "./crises";
import { resourcesSystem } from "./resources";
import { constructionSystem } from "./construction";
import { populationSystem } from "./population";
import { earthSystem } from "./earth";

// Register simulation systems in fixed tick order. Called once at startup, BEFORE boot, so
// the boot catch-up fast-forward runs the economy too.
let registered = false;
export function registerSystems(): void {
  if (registered) return;
  registered = true;
  registerSystem(environmentSystem);
  registerSystem(crisesSystem); // after environment (owns storm dust), before resources
  registerSystem(resourcesSystem);
  registerSystem(constructionSystem);
  registerSystem(populationSystem);
  registerSystem(earthSystem);
  // WP-11 will append: milestones.
}
