// Hall of fame: brains saved from the page, with the rules they lived under, so they can be watched again.
// Kept in this browser (localStorage) and in files (export / import), since browser storage can be wiped.
import { DEFAULT_RULES, type Rules } from "../engine/world.ts";

export interface FameEntry {
  id: string;
  name: string; // e.g. "Gen 37, family 4, 52 food so far" (per food map, when saved)
  savedAt: string; // ISO date
  seed: string; // the run's seed text
  generation: number;
  eaten: number; // food per layout when saved
  hue: number; // its colour
  rules: Rules;
  genome: number[]; // the inborn brain (creature.g)
}

export const FAME_LIMIT = 50;
const KEY = "evolution-lab.hall-of-fame"; // old project name kept on purpose: renaming the key would lose saved halls of fame

// Reads a hall-of-fame file (or stored text). Entries that aren't usable are skipped; rules saved by an
// older version get today's defaults for anything they lack. Throws if the text isn't a list at all.
export function parseFame(text: string): FameEntry[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Not a hall-of-fame file (expected a list of brains)");
  const out: FameEntry[] = [];
  for (const e of data as Record<string, unknown>[]) {
    if (!e || typeof e !== "object") continue;
    const genome = e.genome;
    if (!Array.isArray(genome) || genome.length === 0 || !genome.every((x) => typeof x === "number" && Number.isFinite(x))) continue;
    const rules: Rules = { ...DEFAULT_RULES };
    if (e.rules && typeof e.rules === "object") {
      for (const k of Object.keys(DEFAULT_RULES) as (keyof Rules)[]) {
        const v = (e.rules as Record<string, unknown>)[k];
        if (typeof v === "number" && Number.isFinite(v)) rules[k] = v;
      }
    }
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    out.push({
      id: typeof e.id === "string" ? e.id : `${Date.now().toString(36)}-${out.length}`,
      name: typeof e.name === "string" ? e.name.slice(0, 80) : "Saved brain",
      savedAt: typeof e.savedAt === "string" ? e.savedAt : "",
      seed: typeof e.seed === "string" ? e.seed : "42",
      generation: num(e.generation, 0),
      eaten: num(e.eaten, 0),
      hue: num(e.hue, 0),
      rules,
      genome: genome as number[],
    });
  }
  return out;
}

// Newest first, no duplicates (same id), at most FAME_LIMIT.
export function mergeFame(a: FameEntry[], b: FameEntry[]): FameEntry[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((x, y) => (y.savedAt > x.savedAt ? 1 : y.savedAt < x.savedAt ? -1 : 0))
    .slice(0, FAME_LIMIT);
}

// Browser storage can be missing or blocked (private windows, file:// in some browsers): then the list
// only lives until the page closes, and the page says so.
export function loadFame(): { list: FameEntry[]; stored: boolean } {
  try {
    const text = localStorage.getItem(KEY);
    return { list: text ? parseFame(text) : [], stored: true };
  } catch {
    return { list: [], stored: false };
  }
}

export function storeFame(list: FameEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
