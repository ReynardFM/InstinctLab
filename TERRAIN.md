# Terrain brief (Rey 2026-11-09: "then b"). Nothing here is built. Pick one type, then I write the test plan.

## Why terrain
Order in IDEAS.md: pressure (poison) -> choice (bite) -> pattern (terrain / seasons). Seasons and bite are now built. Terrain is the
last part of "pattern": places that differ, so where a creature goes starts to matter.

## What makes it a real adaptation challenge (our rule from earlier results)
A sense evolves only if (1) it adds new information, (2) there is a move to act on it, (3) the payoff beats the cost.
So every terrain type needs: something to sense, something to do about it, a payoff, and a control run.

## Limits of our creatures (checked in the code)
- No memory: brains are feed-forward. They can follow or avoid what they see now. They cannot plan a route or remember a place.
- Eye: 4 slices, range 200 px, sums per slice. A wall sense exists (distance to the wall straight ahead).
- The map is 800 x 600, fixed in the code.

## Prior work (haiku search 2026-11-09; "opened" = page read, others unverified)
- Huffaker 1958 (opened as a summary): patchy food + a barrier that slowed predators MORE than prey gave lasting cycles; every other
  layout went extinct. -> Terrain steadies the world only if it hampers hunters more than prey.
  https://en.wikipedia.org/wiki/Huffaker%27s_mite_experiment
- Krivan 1998 (opened): refuge size has a non-obvious best value; a smaller refuge can steady things. -> Sweep the size.
  https://fix.prf.jcu.cz/~krivan/clanky/Krivan-TPB-1998.pdf
- Robles & Desharnais 2002 (opened): refuges are neither necessary nor sufficient for coexistence. -> Always run a no-refuge control.
  https://desharnais.sciencecourseware.org/reprints/Ecology2002.pdf
- Morris 2005 (opened): hares used risky and safe habitat equally, but ate less in the risky one. -> Measure what they eat, not only where they are.
  https://dmorris.lakeheadu.ca/61.pdf
- Versteeg & Blair 2001 (opened; hand-made bots, no evolution): bots without memory run back into the predator's view. -> Reactive escape has a ceiling.
  https://cgi.cse.unsw.edu.au/~blair/pubs/2001VersteegBlair.pdf
- Evolved terrain behaviour in ALife sims (Polyworld etc.): no precedent verified.

## Candidate types
| Type | What it is | Sensed by | The move | Payoff | Control | New settings | Main risk |
|---|---|---|---|---|---|---|---|
| Shelter | zones where hunters are slowed (or cannot enter) | new eye channel "terrain" (or the wall sense) | prey: go in when hunters are near | fewer catches | same world without shelter; shelter that moves | 1-2 (type, size) | prey may just sit inside and starve; hunters may starve |
| Poison swamp | poison plants grow only in some zones | nothing new: prey already see purple | prey: stay out; hunters: hunt elsewhere | less poison | today's even poison | 1 | may be solved at once, or ignored |
| River | a band that slows movement | new eye channel "terrain" | go around / cross where narrow | time, energy | no river | 1-2 | no memory -> only reactive crossing |
| Farm | rich and poor food zones | nothing new: prey see green | go to the rich zone | more food | even food | 1 | trivial: solved without adapting |

## What I would measure for any of them
- "Works" first (no die-out in the last 10k, each side cycles), then the adaptation bar against the control, paired seeds.
- Where creatures are AND what they eat (Morris 2005), near hunters vs far.

## Settings budget
Two settings were added this week on Rey's request with nothing replaced: season, hunterBite. Terrain adds 1-2 more.
Eight settings are still on the pending-delete list (hunterSpit, resistTrain, resistHalfLife, resistInherit, resistUpkeep,
hunterResistTrain, hunterResistCap, hunterResistInherit). Deleting them would pay for all of it.

## Update 2026-11-09 (Rey: "put farm paired with season, make it into 4")
Farm is now built as part of the seasons (rules.season): foraging, poison foraging, farm, poison farm. No separate terrain setting.
Screen (seed 1, one 40k-tick year): in the farm season 49% of prey and 78% of hunters stand in the farm zones (16% of the map), and
catches rise (2,749 vs 1,652 in the foraging season). This appears at once, so it is behaviour they already had, not yet adaptation.
