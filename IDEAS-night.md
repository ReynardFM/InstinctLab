# Night 2026-11-03: what each test answers (problem map)

All life mode, 14 seeds, poison on, both eyes (hunter eye + motion) unless marked. Learning-on references from
before: n1 (old hunter senses), n2 (eyes), q1/q2 (remains), all 60k. "harmless" = poisonDose 0.

## Problem 1: hunters are held down (main problem)
### Cause A: hunter learning runs away (drift 1.85, up to 8.4; inborn ~0.5)
- m1  forget 0.05 ............. does fading fix it?            vs n2 (learning on), m4 (learning off)
- m3  forget 0.2 .............. stronger fading                vs m1
- m18 learning rate 0.005 ..... smaller steps instead          vs n2, m1
- m17 forget 0.05, old senses . the fix without the eye        vs n1, m1
- m2  forget 0.05, harmless ... the fix without poison         vs m4b
- m21 m1 on seeds 15-28 ....... solidify if m1 works
### Cause B: poison inside hunters (one poisoned catch 6.8-8.4 units = deadly)
- m6  no learning + cap 0.7 ... cap alone, learning out of the way      vs m4
- m16 forget + cap 0.7 ........ both fixes together                     vs m1, m6
- m19 no learning, 10% poison . fewer poison plants                      vs m4
### Re-tests: old "failed" fixes, now with learning off (they all ran with broken learning)
- m4  no learning, eyes ....... baseline for the re-tests        vs n2
- m4b no learning, harmless ... baseline without poison
- m5  no learning, old senses . hunter eye + motion re-test      m4 vs m5
- m14 no learning, eye only ... which part helps                 vs m5
- m15 no learning, motion only  which part helps                 vs m5
- m13 no learning + bite 1.5 .. bite re-test                     vs m4
- m8  no learning + remains ... remains re-test                  vs m4 (q2 before)
- m7  no learning + remains, harmless . remains without poison (never tested)  vs m4b

## Problem 2: do prey evolve senses by themselves? (the original question; 200k)
- m9  strong hunters (harmless, no learning) ...... hunter gene vs control (first sign +26 at 30k)
- m12 m9 on seeds 15-28 ........................... solidify
- m22 m9 with the 8-slice eye ..................... does a sharper eye help
- m10 poison on, no learning ...................... both threats at once (purple + hunter)
- m11 poison on, learning fixed (forget 0.05) ..... both threats, hunters still learn (Rey's goal 4)

## Problem 3: can prey learn during life? (never tested in life mode)
- m20 prey learning (learnRate 0.02, forget 0.002), strong hunters   vs m4b

## Read from every test
- rise-and-fall cycles of both sides (Rey's goal 1: watch), hunter die-outs, hunters alive, pick, catches, learned drift
