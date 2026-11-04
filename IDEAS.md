# Idea map (Rey 2026-11-02)

Main problem on top. Every new idea or side question gets a line under the idea it came from.
Depth = hops from the main problem. At depth 3 (a branch longer than 2), Claude stops and reminds Rey
to finish the main problem first: park the branch or go on.
Marks: [main] current problem, [open] being discussed, [parked] saved for later, [done], [dropped].

Tonight's tests and what each answers: IDEAS-night.md

## Path so far
1. [done] Life-mode sense-gene test (eye4, 200k): hunter gene beats control 3/14, purple 7/14. Hunters barely alive (4-5, ~65 die-outs).
2. [done] Why hunters die out: poison passed up (poisonDose 0: die-outs ~20 -> 3-8 per 60k, hunters 12-18 alive).
3. [done] Hunter eye + motion (n2-n4): die-outs -25% (not significant), pick 0.67 -> 0.49; does not fix die-outs.
4. [done] Remains with poison (q1, q2): worse, they spread poison among prey.
5. [main, now] Keep poison AND keep hunters alive.

## [main] Poison as an adaptation challenge (Rey 2026-11-03 a)
Re-solve by adapting, not tuning. Old finish line met only by tuning (m6 cap + learning off; m19 poison 10% + learning off) = not a win. Cause of no defence: UNKNOWN — rarity is a hypothesis, not measured; forgetting already falsified (forget 0 did not lower pick). Next, in order: (1) random-baseline pick = the zero point (absolute floor); (2) knock-out control = a shuffled cue (same speed spread, sickness no longer tracks it), not a blind; = the no-cue control, one paired run measures both pick and survival; (3) fix the challenge settings once, write them down — setting is allowed, tuning to pass is not; (4) learning setup = hunterRelative + forget 0.002; (5) "works" measured FIRST in the base world (harmless poison + learning setup) before poison on.
Bar (Rey 2026-11-03 a, fixed 2026-11-03): adapted = defence beats the no-cue control (= the shuffled-cue run) in >= 10/14 seeds + knock-out proves it (likely 6 seeds, done 14 x 200k, knock-out same size); works = both sides present + each side cycled >= once, in >= 10/14 seeds, measured first in the base world.
Measured 2026-11-02 [screen, weak] (seed 1, 60k): rare big doses, not build-up. 1-4% of catches are poisoned prey (level > 0.3,
usually >= 1) and give all hunter poison. One poisoned catch costs an adult hunter ~3.6 meals of extra hunger
(young/old up to 4x). Hunters already avoid sick prey strongly (pick 0.21-0.48); the few they still eat are enough.

- d1 [parked: dose count shows poisoned prey are already very visible (half speed) and avoided] Better detection of poisoned prey
  - d2 [open] Upper bound: perfect cue (each prey's capacity 1/(1+harm)); if hunters still die, detection can't fix it
  - d2 [open] Rey's top-speed memory: prey's recent top speed (while fleeing) vs now; handed-out cue, less raw
- d1 [done, screen: weak] Resistance: trained (b, cap 0.5, babies 25%) never builds (0.00-0.06): rare acute exposure. Research: resistance is inborn, local, where toxic prey are common; rare acute toxins favor avoidance; hungry predators eat toxic prey (state-dependent)
  - d2 [check, likely: possible] Deliberately evolve resistance (Rey 2026-11-02, c = judge): r 0.94-0.97 by gen 30 in 5/5 seeds (control drifts 0.04-0.53). Cost added (hunterResistSlow 0.3): still 0.88-0.98 in 5/5, control drift 0.06-0.22. Next step if wanted: transplant bred hunters into the life-mode arena (game idea: player strategy)
- d1 [screen: weak; stopped 2026-11-02 (Rey: c): rule hunterBite stays, off; sick prey in reach too rare to select on (3-21 per 10k)] Bite choice for hunters (hunger-dependent, research-backed: hungry starlings eat more toxic prey)
- d1 [open, weak support: bigger animals clear toxins slower (fish PCB data)] Hunters clear poison faster (own half-life): 200 ticks would make one poisoned catch cost ~1.4 meals instead of 3.6
- d1 [screen: weak, failed] poisonDose sweep 0.5 / 0.25 (seed 1): per poisoned catch still 1.9-3.3 units (lethal), avoidance weakens
- d1 [open] Re-test the earlier hunter fixes with learning off (all ran with broken learning)
- d1 [open] Hunter-sense test under strong pressure (harmless + no learning: +26 at 30k, 6 seeds)
- d1 [check, likely: 6/6] Hunter learning halves hunters even with harmless poison (27.8 vs 13.5); no forgetting/bound in hunter learning; next: fix it or turn it off
- d1 [screen: weak, modest] Cap the dose a hunter takes per catch (not a share): measured per-catch intake is 6.8-8.4 units, so a share stays lethal; a cap < 0.8 is survivable and still teaches
- d1 [dropped] hunterToxin (share of prey poison passed on): Oct 24 already found 1/4 still tips hunters; 0 = nothing to learn
- d1 [screen: weak] Do healthy prey fake being sick (automimicry)? Probably not: catches went up with the eye (22.2 -> 29.5)
- d1 [done] Does hunter poison ever fade? Yes, half-life 500 (toxin.ts fade, hunters.ts liveEcoHunters)
- d1 [screen: weak] Dose each caught prey carries: build-up false (all poison from prey > 0.3)
  - d2 [answered] More potent poison? Already acute (one catch = reward -1, ~3.6 meals lost); stronger = worse for hunters

## Parked branches (from earlier tonight)
- d1 [parked] Senses they develop themselves, with memory
  - d2 [parked] Raw color eye (RGB per slice, no kind labels) + color flips in life mode + memory
    - d3 [parked] Eat / don't-eat output ("choice" in the main order)
- d1 [parked] "Friend eaten -> run": alarm scent where a prey dies
  - d2 [parked] Remains (rule `remains`); as hunter food untested; remains without poison untested
    - d3 [dropped] Cannibalism: remains with poison spread it (q1 +6.6 die-outs)
- d1 [done] What have we missed? (few choices, nothing to figure out, others don't matter)
  - d2 [parked] Terrain as pattern (moving/seasonal farm, river); needs a brief
    - d3 [parked] Logic / reasoning -> behaviour probes

## Game (proto/, paused since 2026-10-30): mechanics ready when needed
- Resistance breeding (lab rules hunterResistGene, hunterResistSlow, genPreyToxin; src/cli/resist-breed.ts): breeds in
  ~30 gens by a judge; costs speed. Not ported to proto/game. Game idea: side arena breeds resistant hunters, released
  into the main arena. Untested: whether released hunters beat native ones (the transplant).

## Order after the main problem
The main problem is now a repeat, not a one-off (Rey 2026-11-03): ecosystem works -> add a challenge -> ecosystem re-solves it. Progress = it re-solves by adapting, not by hand-tuning. End product: watch (a), then portfolio (c), then game (b).
pressure (hunters survive with poison) -> choice (eat output) -> pattern (terrain/seasons)

## Loose ends
- Commit pending (message in proto/out/commit-msg.txt).
