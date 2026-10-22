// Hunters (predators, first step): rules.hunters dumb hunters that chase the nearest prey. They have no
// brain and don't evolve yet; this is the cheapest test from the predators brief: can prey learn to flee?
// A caught prey is out for the rest of that food map (it eats nothing more, so it scores less).
import type { World } from "./world.ts"; // types only, no import at run time
import type { Creature } from "./creature.ts";
import { H, W, offset } from "./space.ts";

export interface Hunter {
  x: number;
  y: number;
  rest: number; // ticks left digesting after a catch (doesn't move or catch)
}

export const CATCH = 6; // a hunter this close to a prey catches it (same reach as eating)
export const REST = 30; // ticks a hunter rests after a catch

// Hunters' starting spots for a new food map, drawn after the food so the food is the same as without hunters.
export function placeHunters(w: World): void {
  w.hunters = [];
  for (let i = 0; i < w.rules.hunters; i++) w.hunters.push({ x: w.env.next() * W, y: w.env.next() * H, rest: 0 });
}

// One tick for every hunter, after the prey have moved: step towards the nearest living prey; catch it when close.
export function moveHunters(w: World): void {
  const walls = w.rules.walls > 0;
  const speed = w.rules.hunterSpeed;
  for (const h of w.hunters) {
    if (h.rest > 0) {
      h.rest--;
      continue;
    }
    let prey: Creature | null = null;
    let bdx = 0;
    let bdy = 0;
    let bd2 = Infinity;
    for (const c of w.creatures) {
      if (!c.alive) continue;
      const dx = offset(c.x - h.x, W, walls);
      const dy = offset(c.y - h.y, H, walls);
      const d2 = dx * dx + dy * dy;
      if (d2 < bd2) {
        bd2 = d2;
        bdx = dx;
        bdy = dy;
        prey = c;
      }
    }
    if (!prey) continue;
    const d = Math.sqrt(bd2);
    const step = Math.min(speed, d);
    if (d > 0) {
      const nx = h.x + (bdx / d) * step;
      const ny = h.y + (bdy / d) * step;
      h.x = walls ? Math.min(Math.max(nx, 0), W) : (nx + W) % W;
      h.y = walls ? Math.min(Math.max(ny, 0), H) : (ny + H) % H;
    }
    if (d - step < CATCH) {
      prey.alive = false;
      prey.diedAt = w.tick;
      prey.caught++;
      h.rest = REST;
    }
  }
}
