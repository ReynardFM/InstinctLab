# Instinct Lab — timeline and shelf (2026-11-24)

Plain-words history of what was added, one step at a time, and what is on the shelf.
Details and numbers: HISTORY.md (grep by date or name). ✅ kept · ❌ failed / dropped · 🅿️ parked · ⏳ running.

## The setup that works now
| Ingredient | Simple words | Since |
|---|---|---|
| Life mode (no judge) | animals eat, breed and die on their own | Oct 23 |
| Poison food chain | poison goes plant -> prey -> hunter | Oct 24 |
| Both eyes | prey and hunters see the world in slices | Nov 1-2 |
| Hunter learning, fixed | learn against the usual meal, forget slowly | Nov 3 |
| Glow | sick prey glow | Nov 6 |
| Prey-like hunter breeding | hunters breed by the prey's simple rule | Nov 8 |
| Slow hunters (default) | hunters burn slowly, a meal gives less: wolves next to mice | Nov 11 |
| Resistance gene | born tougher against poison; toughness costs energy | Nov 11 |
| Dose 0.75, cap 2 | one sick meal hurts but does not always kill | Nov 11-20 |
| Fixed ramp | rising poison grows in patches, not scattered | Nov 24 |

Results: steady poison SOLVED by the nature bar [proof 14 x 400k]; slow rise works [small test]; fast rise works [small test];
slow-rise proof ⏳; poison swing (23 / 40 / 23 / 40%) ⏳ queued.

## Timeline
**1. Little brains (Oct 18-19)** ✅ creatures with tiny brains eat green, avoid purple; the best breed. ❌ learning in life, swap world, per-weight learning: no gain.
**2. Engineering (Oct 20-21)** ✅ Redis job queue on Docker workers (killed worker, job redone); faster senses; share links; hall of fame; auto-stop lab.
**3. Hunters (Oct 21-23)** ✅ chasers, prey learn to flee; evolving hunter brains (arms race); LIFE MODE: no judge, hunters eat, breed, die.
**4. Poison food chain (Oct 24)** ✅ poison moves up the chain. Problem found: hunters keep dying out (the main question for a month).
**5. First hunter defences (Oct 25-26)** ❌ speed cue (no change); taste learning (halved hunters); spitting; trained resistance.
**6. Game detour (Oct 26-30)** 🅿️ playable game: cards, species, events, powers, terrain, thirst. Dropped Oct 30: "the logic is there but not the fun".
**7. Raw senses (Oct 31-Nov 1)** ✅ raw eye; sense genes; life mode runs for hundreds of generations.
**8. Poison as a challenge (Nov 2-5)** ✅ the rule: solve by evolving, not tuning; hunter eye + motion; learning fixed; fair controls (random hunter, shuffled cue). ❌ remains, smaller dose, dose cap as the fix.
**9. Cues (Nov 6-8)** ✅ glow (small, slow dodge); hunters breed like prey. ❌ scent (same as glow).
**10. Seasons and helpers (Nov 9-11)** ❌ extreme seasons with farms (broke); slow prey. 🅿️ bite, faster poison clearing, stomach, cheap waiting. ✅ slow hunters default; resistance gene.
**11. Rising poison, first try (Nov 13)** ❌ ramp with a start bug; ramp after that fix (later found broken too). 🅿️ hangover + early breeding (prey crashed).
**12. Nature bar (Nov 19-20)** ✅ judged like nature (coexist, prey resist, hunters dodge OR resist, fewer hunters than prey): POISON SOLVED. 🅿️ safe prey (too slow). ❌ sight trade-off (swaps, does not add).
**13. Rising poison, second try (Nov 23-24)** ❌ steady 35% and old slow rise (half the worlds). The flat-ramp control found the hidden bug: the old ramp moved poison like shifting mines. ✅ ramp fixed; slow rise works; helpers not needed; fast rise works.
**14. Now (Nov 24)** ⏳ slow-rise proof (14 worlds); ⏳ poison swing.

## The shelf

### Lab switches still in the code, OFF (parked)
| Switch | What it does | Why it is off |
|---|---|---|
| hunterBite | hunters may refuse a prey in reach | small or no help |
| digest | stomach: food digests slowly | no help |
| hunterIdle | resting hunters burn less | life too easy; hunters stop adapting |
| hunterEarlyBreed, hunterHangover | poison = breed early, then a dulled sense | "painkiller": hunters stop being careful, prey crash |
| hunterSightTrade | resistance dims the glow sight | swaps resistance for dodging |
| hunterPoisonHalfLife | hunters clear poison faster | partial help only |
| safePrey | some prey never eat poison | too slow to show (on the longer-run list) |
| season (old form) + seasonFarm | extreme seasons, farms | worlds broke; season is reused now for the swing |
| remains | dead prey leave food | hurts with poison |
| eyeMotion | see motion | no help for hunters; prey value unmeasured |
| swapKinds | colours swap which is poison | the only place learning paid; parked |
| hunterResistGene, hunterResistSlow, genPreyToxin | resistance breeding (generations mode) | parked |
| thinkCost, learnCost, energyGate | prices for thinking and learning | no gain |

### Lab code deleted (restore from git)
| When | What | Restore |
|---|---|---|
| Nov 3 | mutationRate, centreShare, plasticity | 9942908 |
| Nov 10 | hunterSpit; trained resistance (resistTrain, resistHalfLife, resistInherit, resistUpkeep, hunterResistTrain, hunterResistCap, hunterResistInherit) | de515af |
| Nov 11 | slow prey (preySlow) | 5e8a485 added it |
| Nov 13 | hunterBrainNow, potencyRise | e64fb27 |
| Nov 19 | scent and shuffled cues (hunterCue 3-5), hunterRealLife | d3faf1e |

### Lab ideas never built (IDEAS.md)
perfect-cue upper bound; prey top-speed memory cue; raw colour eye + colour flips + memory; eat / don't-eat output; alarm scent ("friend eaten -> run"); terrain as pattern; logic / behaviour probes; automimicry (fake sickness). Dropped: hunterToxin, cannibalism. Closed: WebAssembly / Rust port.

### Game (proto/, parked since Oct 30)
- The game: roguelite runs with species, body cards (legs, eyes, stomach, belly), events (drought, night, toxic bloom, swarm), powers (food drop, shelter, mutation burst, cull; test powers: hard practice, switching, dark practice), reward sliders, permanent unlocks. Measured: powers did nothing.
- EXPERIMENT toggles (proto/game/sim.ts): zeroSenses, sprintLegs, energyMove (rest / slow), tasteMove (spit / avoid), neighbourInfo, confusion, follow, legs and stomach tuning, ownThreats (ambush hunters, toxin build-up), terrain (river, farm, safe zone), farmRaid, legsGrow, terrainMoves, thirst, memory.
- The learning game (teach how learning works): idea only.
