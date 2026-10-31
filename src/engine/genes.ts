// Sense genes (Rey 2026-10-31: senses evolved, not handed out). With rules.senseGenes the last SENSE_GENES
// numbers of a genome switch the optional senses on (> 0) or off, in this order: 2nd food, neighbour, poison,
// hunter. A switched-off sense reads "nothing there"; each switched-on sense costs rules.senseCost energy per
// tick. No imports at run time (creature.ts and senses.ts both use this; they must not import each other).
import type { Rules } from "./world.ts";
import type { Genome } from "./brain.ts";

export const SENSE_GENES = 4;
export const senseOn = (r: Rules, g: Genome, s: number): boolean => !(r.senseGenes > 0) || g[g.length - SENSE_GENES + s] > 0;
