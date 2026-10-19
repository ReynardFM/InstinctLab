// Which mode is running right now. Ecosystem mode first runs `ecoWarmup` ordinary generations, so the
// ecosystem starts with brains that already know how to eat; after that it runs continuously.
import type { World } from "./world.ts"; // types only, no import at run time

export function inEcosystem(w: World): boolean {
  return w.rules.mode === 1 && w.generation > w.rules.ecoWarmup;
}
