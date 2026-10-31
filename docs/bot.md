# House AI

The opponents in `src/bot/`. This is a house AI. It is not the official solo Bot (`rules/13`,
`src/engine/solo/`), which is part of the rules engine, not an AI. Every level is a `Bot`
(`src/bot/types.ts`): a pure `decide(state, seat, legal) → Intent` under a no-cheat contract.
Hidden information is read only through `determinize`, and randomness is seeded from
`seedFromView`.

| Level         | Implementation                                                          |
| ------------- | ----------------------------------------------------------------------- |
| `first-legal` | the deterministic fuzz driver (`autoPlay.ts`)                           |
| `easy`        | the heuristic with softmax noise                                        |
| `normal`      | the heuristic (`heuristic.ts`): one decision of lookahead over 2 worlds |
| `hard`        | ISMCTS (`ismcts.ts`, below); learned leaf only if gated (below)         |

Run `npm run bot:check` after any card or rule change, and see "Maintaining the house AI" at the
end. Compare bots with `npx tsx tools/arena.ts --a <spec> --b <spec> --games N --jobs J` (specs:
`src/bot/registry.ts`).

## ISMCTS (the Hard level)

`src/bot/ismcts.ts` implements single-observer Information-Set MCTS (SO-ISMCTS; Cowling, Powley &
Whitehouse 2012), with PUCT selection guided by the heuristic's priors.

### One iteration

1. **Determinize.** Take a world from a pool of `worlds` determinizations of the root seat's
   information set. They are drawn with `determinizeWith`, seeded from
   `seedFromView(state, seat)` and a salt. Iteration _i_ uses world _i_ mod `worlds`, so each tree
   node memoises its state per world. A node's state in a world is a pure function of the world and
   the path, so revisits cost nothing, and so do leaf values, which are memoised too.
2. **Descend.** At each node, the decider is the pending choice's seat, else the active seat. Its
   options are `candidates()` _in this world_. Only these options are eligible, and each eligible
   edge's **availability** count is incremented. This is the ISMCTS correction: the exploration
   term uses how often an edge was available, not how often its parent was visited. **Progressive
   widening** keeps only the top-k available edges by prior, with
   k = max(2, ⌊widenK · (n + 1)^widen⌋).
3. **Select** the edge that maximises `Q̂ + c · P · √avail / (1 + n)`.
   - P is the softmax (temperature `temp`, in VP) of the edges' prior scores over the eligible set.
   - Q̂ is the edge's mean value from its decider's side, min-max normalised over every value
     backed up in this search. The values are small VP-margin differences, so a fixed c would not
     fit them otherwise.
   - An unvisited edge counts at its parent's mean value (first-play urgency).
4. **Expand.** The first edge without a child creates a node, and that node is the leaf. These are
   leaves too:
   - a finished game;
   - a state past the horizon, which by default is the end of the current turn. `turns` sets how
     many turn hand-overs the tree may cross.
5. **Evaluate** the leaf. The value is always from the root seat's view, in [−1, 1].
   - A finished game is worth ±0.9 + 0.1 · tanh(margin / scale).
   - Any other state first gets a heuristic `settle`, which ends the turn owner's turn with the
     cheap policies. With `leaf=rollout`, up to `rolloutDepth` rollout decisions come first. Each
     one completes a completable mission if there is one. Otherwise `rollout=cheap` plays the
     playable hand card with the best `cardValuePrior`, and `rollout=greedy` takes the best
     one-step `evaluate` gain plus the rule prior while that is positive (about 5× dearer).
   - The settled state is then scored as `tanh(evaluate / scale)`, or by the `value` hook.
6. **Back up.** Each edge accumulates the value from its own decider's side: +v for the root seat,
   −v for the opponent.

The move played is the root edge with the most visits. Ties go to the higher Q, then to the
earlier candidate. Two cases return without searching: a decision with a single candidate, and a
completable mission (the heuristic's `missionsFirst` rule).

**SO-ISMCTS.** There is one tree, keyed by decision history. Every edge is
`<decider seat>|intentKey(intent)`, so choice ids are normalised away. The opponent's decisions
inside the tree (interrupts within the turn, and their whole turn when `turns ≥ 1`) are chosen from
that same tree by maximising −value. In effect, the opponent is assumed to know what the root
player's determinization shows. Chance (draws, shuffles, deck tops) is folded into the
determinization: nodes do not split on chance outcomes, and an option that only exists in some
worlds is simply unavailable in the others.

**Priors.** Each edge gets one prior score, computed the first time the edge is seen, in that
iteration's world, and cached on the edge.

| Mode     | Score                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| `bonus`  | `priorBonus` (the heuristic's rule priors)                                                   |
| `step`   | `evaluate` one `reduce` after the intent, plus `priorBonus`                                  |
| `settle` | the heuristic's own candidate score (`simulate`: apply, settle, evaluate), plus `priorBonus` |

The defaults are `rootPrior=settle` and `prior=step`. With `settle` at the root, a tiny budget
reproduces the heuristic's choice, and the search refines it from there.

**Determinism.** With an iteration budget, `decide` is a pure function of the seat's information
set. `ismcts.test.ts` checks that two states differing only in the hidden arrangement give
identical root statistics. A time budget (`timeMs`, with an injected `clock` because `src/bot` is
under the determinism lint) makes the iteration count, and so the answer, machine-dependent. The
tree lives only inside one `decide` call: there is no tree reuse between decisions.

### Parameters

They are set through `makeIsmctsBot(opts)`, or the `ismcts:` arena spec
(`ismcts:iters=200,c=1.5,leaf=settle`).

| Option (spec key)      | Default           | Meaning                                            |
| ---------------------- | ----------------- | -------------------------------------------------- |
| `iterations` (`iters`) | 200               | iteration budget; a cap when `timeMs` is set       |
| `timeMs`, `clock`      | —                 | wall-clock budget; the spec uses `performance.now` |
| `c`                    | 1.5               | PUCT exploration constant                          |
| `widen`, `widenK`      | 0.5, 2            | progressive widening; `widen=0` turns it off       |
| `leaf`                 | `rollout`         | `rollout` (option a) or `settle` (option b)        |
| `rolloutDepth`         | 8                 | decisions per rollout before it settles            |
| `rollout`              | `cheap`           | rollout policy: `cheap` or `greedy`                |
| `rootPrior`, `prior`   | `settle`, `step`  | prior modes (table above)                          |
| `temperature` (`temp`) | 1                 | prior softmax temperature, in VP                   |
| `worlds`               | 16                | determinization pool size                          |
| `turns`                | 0                 | turn hand-overs the tree may cross                 |
| `maxDepth`             | 48                | tree depth cap                                     |
| `scale`                | 15 (`EVAL_SCALE`) | VP scale of the value squash                       |
| `missionsFirst`        | true              | complete a completable mission without searching   |
| `value`                | —                 | learned value hook (below)                         |

`makeBot('hard')` (`src/bot/index.ts`) uses two budgets:

- Without a clock, it runs `HARD_ITERATIONS` = 200 iterations. This is the arena and test budget,
  and it is deterministic.
- With `makeBot('hard', { clock: performance.now })`, it searches for `HARD_TIME_MS` = 1500 ms per
  decision, capped at `HARD_MAX_ITERATIONS` = 3000. This is the UI and worker budget.

### Gate

All runs are `npx tsx tools/arena.ts --a <spec> --b normal --jobs 11` over all 30 pairings, with
seat swaps. The 95 % intervals are Wilson intervals. Times are ms per `decide` call, trivial
decisions included, measured with 11 jobs on 12 cores (roughly 2× slower than one unloaded core).

| Spec (A, vs `normal`)                                               | Seed | Games | A rate     | 95 % CI          | Margin    | ms/decision |
| ------------------------------------------------------------------- | ---- | ----- | ---------- | ---------------- | --------- | ----------- |
| `iters=200,leaf=settle` (first version)                             | 7    | 200   | 67.3 %     | [60.5, 73.4]     | 4.4 ± 0.7 | 459         |
| `iters=200,leaf=settle`                                             | 1    | 100   | 62.1 %     | [52.3, 71.1]     | 3.1 ± 1.1 | 390         |
| `iters=200,leaf=settle,c=0.75`                                      | 1    | 100   | 60.0 %     | [50.2, 69.1]     | 2.3 ± 1.1 | 336         |
| `iters=200,leaf=settle,c=3`                                         | 1    | 100   | 61.0 %     | [51.2, 70.0]     | 4.8 ± 1.1 | 372         |
| `iters=400,leaf=settle`                                             | 1    | 100   | 71.0 %     | [61.5, 79.0]     | 3.9 ± 1.0 | 744         |
| `iters=100,leaf=rollout`                                            | 1    | 100   | 65.0 %     | [55.3, 73.6]     | 5.1 ± 1.1 | 438         |
| `iters=200,leaf=rollout,rolloutDepth=20`                            | 1    | 100   | 72.5 %     | [63.0, 80.3]     | 6.4 ± 1.3 | 773         |
| `iters=200,leaf=rollout,rollout=greedy,rolloutDepth=30` (abandoned) | 1    | —     | —          | —                | —         | ~5× slower  |
| `iters=200,leaf=rollout`                                            | 1    | 100   | 77.0 %     | [67.8, 84.2]     | 7.0 ± 1.2 | 821         |
| **`iters=200`** (= `hard`, the defaults)                            | 7    | 200   | **76.0 %** | **[69.6, 81.4]** | 6.9 ± 0.8 | 883         |

Seed 1 was the tuning seed. The 62.1 % run on seed 1 was the first arena run: one of its games
crashed on an engine bug (fixed, below), so that row covers 99 finished games. The final gate used the
fresh seed 7. The gate needs at least 55 % with the CI's lower bound above 50 %, and it passes: 76.0 %
[69.6, 81.4], 149–45–6. Seat 0 and seat 1 are both 76 %.

Sanity check: `ismcts:iters=200` vs `first-legal` on `--pairings nobur` (60 games, seed 3) won
60 of 60 (100 %, [94.0, 100]), by an average margin of 37.9 VP.

Findings:

- c barely matters (0.75 to 3) once Q is min-max normalised.
- Strength grows with the budget: settle went from 62 % at 200 iterations to 71 % at 400, and
  rollout from 65 % at 100 to 77 % at 200.
- At equal cost, the cheap rollout is slightly ahead of settle (77 % vs 71 % at ~800 ms), so it
  is the default. A settled leaf scores a mid-turn state as "end the turn now". That undervalues a
  hand that can still be played, and the rollout corrects it.
- A deeper rollout (20 decisions) did not help.
- The greedy rollout policy (one `reduce` per option per step) was about 5× slower and was
  dropped before its run finished.

Search cost on one unloaded core, with Action Step decisions of at least 4 candidates:

| Budget                                  | ms per searched decision | Iterations |
| --------------------------------------- | ------------------------ | ---------- |
| `iters=100`                             | 169                      | 100        |
| `iters=200` (arena / `makeBot('hard')`) | 315                      | 200        |
| `iters=400`                             | 598                      | 400        |
| `iters=200,leaf=settle`                 | 193                      | 200        |
| `timeMs=1500` (UI budget)               | 1476                     | ~1450      |

The recommended budgets:

- **UI:** 1.5 s per decision through `makeBot('hard', { clock: performance.now })`, ideally in a
  worker. That is about 7× the arena's iterations, and since strength still grows with the
  budget, it should be at least as strong as the gated configuration. Trivial and
  mission-completing decisions answer at once.
- **Arena:** `iters=200`, about 35 minutes for a 200-game gate on 11 jobs.

### Learned value hook

`opts.value?: (state, seat) => number` replaces `tanh(evaluate / scale)` at **non-terminal
leaves**.

- `state` is a full, **determinized** state. It is the leaf after `settle`, that is, after the turn
  owner has ended the current turn (or, with `leaf=rollout`, after the rollout and then `settle`).
  Usually it is the start of the next player's turn.
- `seat` is always the **root** decider.
- The function must return a value in **[−1, 1] from `seat`'s side**.
- Finished games never reach the hook: they use the real result.
- `features(state, seat)` and `features(state, opponent)` are the natural inputs.
  `src/bot/arena.ts` records the same vectors with the game's outcome (`--records`).
- With the hook set, a leaf value's scale no longer needs to match `evaluate`, because Q is
  min-max normalised. `scale` then only affects the terminal margin term.
- The trained value that plugs in here is described under "Learned value (Expert Iteration)"
  below.

### Engine fix found by the arena

The first arena run crashed one game, `answer(sendAwayTeam.target): not answered`. `SEND_AWAY_TEAM`
takes a single legal destination without asking. If the pool is short and several source Locations
can be pulled from, it then asks for the source, and on resuming it read the target from a choice
that was never published. The primitive now remembers the automatic target
(`sendAwayTeam.autoTarget`). The regression test is in `src/engine/todo08.test.ts`. Any bot could
reach this state: the first-legal fallback picks the same source.

### Known limits

- **Strategy fusion** is reduced but not gone. SO-ISMCTS averages over worlds, and the opponent's
  in-tree choices are made as if it could see the root player's sampled world. The opponent's
  private information is not modelled separately, as it would be with MO-ISMCTS.
- **No reveal memory.** `determinize` resamples every hidden card, including cards the seat has
  seen before (revealed cards, cards that passed through play into the opponent's Log). Cards the
  stack or the pending choice reference stay put, so a blind deck-top gain candidate keeps its true
  face. This is the one known leak (`determinize.ts`).
- **No bluffing or inference model.** The opponent's hand is sampled uniformly from its unseen
  cards. Nothing is inferred from what the opponent did or did not play.
- **Short horizon.** With `turns=0`, the tree plans within the current turn only. The opponent's
  next turn is seen only through the evaluation of the post-Clean-up state. Often the in-turn tree
  is exhausted well before 2000 iterations, so extra budget has diminishing returns.
- Repeated zero-value activations are discouraged only by the prior (`PRIORS.repeatActivation`)
  and the tree depth cap.

## Learned value (Expert Iteration)

`src/bot/learned.ts` is a small learned value function for the ISMCTS leaf, trained on self-play
in the spirit of Expert Iteration (Anthony, Tian & Barber 2017): strong-ish play produces games,
a network learns to predict their outcomes from the positions, and the search then uses the
network as its leaf evaluation. Only the value is learned; the priors stay the heuristic's.

### The network

- **Inputs.** The two seats' `features()` vectors (`evaluate.ts`), arranged by an input layout
  (`INPUT_LAYOUTS`). `diff-masked` (the recipe's layout) has one column per per-seat feature for
  the difference `me − opp`, the 5 global features once, the two raw score totals, and the
  seat's own `hand.value` and `missions.completable` as raw columns. Every column is standardised
  by the training mean and standard deviation and clipped to ±6.
- **Layers.** Two tanh hidden layers (32 and 16 units), then one tanh output: the value in
  [−1, 1] from `seat`'s side. That is about 2 200 parameters, and the weights file is ~22 KB.
  An optional `evalMix` blends in the hand-tuned `tanh(evaluate / 15)`.
- **Cost.** One call is two `features()` calls plus ~2 000 multiply-adds, so it costs the same as
  `evaluateNormalized` (both ~0.11 ms on one loaded core; the feature extraction dominates).
- **Hidden information.** The records hold the opponent's TRUE features, but a search leaf is a
  determinized state whose opponent hand is a sample. `HIDDEN_OPP_FEATURES` lists the opponent
  features that depend on hidden cards (`hand.value`, `missions.completable`); the `-masked`
  layouts leave them out. The opponent's other features are public or invariant under
  determinization (its hand, Draw deck and Log are resampled within one pool, so its owned-card
  composition does not change). The unmasked `pair` layout is trained as an ablation only.

### Weights and compatibility

`ValueWeights` (plain JSON, 5 significant digits) carries `format`, `layout`, `featureNames`
(the input columns), `norm`, `layers` and `meta` (training data, validation numbers, `gate`).
Two hashes decide whether weights may be used:

- `featureHash` = hash of `FEATURE_NAMES` in order, the layout and `LAYOUT_VERSION`. Adding,
  removing or reordering a feature changes it.
- `cardDataHash` = the sessions' card-data hash (`src/data/cardDataHash.ts`, moved there from
  `src/session/log.ts`, which re-exports it). Any card, Stardate or crew-board edit changes it.

`compatibleValue(weights, catalog | hash)` returns null on any mismatch or malformed weights.
`makeBot('hard', { cardData })` (`src/bot/bundledValue.ts` `hardValue`) uses the bundled
`src/bot/weights/value.json` only when it is compatible **and** `meta.gate.passed` is true;
otherwise Hard silently keeps the hand-tuned leaf. Without `cardData`, Hard is hand-tuned. The
UI passes its bundled catalogue in both the worker and the in-thread fallback
(`src/ui/workerBots.ts`); `workerBots.test.ts` checks that the browser catalogue hashes like
the Node one.

Arena specs: `hard` (as the app builds it), `ismcts:…,value=eval|learned|<name>` and
`learned:…` (= `ismcts` with `value=learned`, gate or not). `tools/arena.ts --weights
name=file` loads extra weights for `value=<name>`.

### Training data

`tools/selfplay.ts` (library: `tools/lib/selfplay.ts`) plays `tools/arena.ts` schedules over all
30 pairings with seat swaps and records every decision (`--records`): the deciding seat's
features, the opponent's, the final outcome (1 / 0 / −1) and margin from the decider's side.
Records live in `.bot-data/` (git-ignored).

- **Fast (iteration 0).** The heuristics: normal vs normal, noisy heuristics (`noise` 0.3 / 0.7)
  vs normal and vs each other, easy vs normal. A deterministic bot against itself replays the
  same game in the seat-swapped half, so the trainer drops duplicate games.
- **ISMCTS (iteration 1+).** ISMCTS with the current candidate as leaf vs ISMCTS with the
  hand-tuned leaf, at a reduced budget (two different searchers, so both halves count).

`tools/train-value.ts`:

- splits **by game pair** (`<pairing>-<seed>`, both halves together; a hash of the key picks
  15 % for validation), never by line, because positions of one game are strongly correlated;
- adds the **mirrored row** of every record (the opponent's features as `me`, outcome and margin
  negated), so the network also learns positions from the inactive seat's side, which is what a
  leaf asks for (see the findings below; `--no-swap` turns it off);
- trains with minibatch AdamW (batch 256, lr 1e-4, weight decay 1e-4), seeded Glorot
  initialisation and seeded shuffling (`src/bot/valueTrain.ts`, deterministic), with early
  stopping on the validation MSE against the outcome (patience 4);
- `--search` trains a grid (layout × target × late-game weighting) in parallel processes and
  keeps the best masked layout by validation MSE. Targets: the outcome, or
  `blend:α` = α·outcome + (1 − α)·tanh(margin / 15). Late weighting multiplies a row's loss weight
  by 1 + λ·(turn / last turn);
- reports validation MSE and **sign accuracy** (the share of decided positions where the value's
  sign is the eventual winner's), next to the hand-tuned `tanh(evaluate / 15)` on the same
  positions (computed from the recorded features with `evaluateFeatures`), and with its scale
  refit on the training rows.

Validation positions are decision points, not search leaves: a leaf is a settled state, usually
the start of the next turn. The validation numbers measure outcome prediction, and only the arena
gate measures playing strength.

### Validation (iteration 0)

Data: 2 640 fast self-play games over all 30 pairings with seat swaps, seeds 1001–1006
(normal vs normal 1 200, easy vs normal 240, `heuristic:noise=0.7` vs normal 240,
`heuristic:noise=0.3` vs normal 480, `noise=0.7` vs `noise=0.3` 480). Dropping the replayed
seat-swapped halves of normal vs normal leaves 2 040 distinct games and 486 000 decision records
(200 MB of JSONL, about 3 minutes of self-play per 480 games on 6 jobs). Validation: 211 game
pairs (76 000 positions, ×2 mirrored), training: 1 109 pairs (410 000 positions, ×2).

MSE is against the outcome (1 / 0 / −1); sign accuracy is over decided positions; "late" is the
last 40 % of each game's turns.

| Value                                                    | MSE   | Sign   | MSE late | Sign late |
| -------------------------------------------------------- | ----- | ------ | -------- | --------- |
| hand-tuned `tanh(evaluate / 15)` (baseline)              | 0.702 | 72.1 % | 0.577    | 78.9 %    |
| hand-tuned, scale refit (16.3)                           | 0.704 | 72.1 % | 0.580    | 78.9 %    |
| MLP 32×16, `diff-masked`, target outcome                 | 0.610 | 76.3 % | 0.443    | 83.8 %    |
| MLP 32×16, `diff-masked`, target `blend:0.5`             | 0.612 | 76.6 % | 0.450    | 84.3 %    |
| **MLP 32×16, `diff-masked`, target margin (the recipe)** | 0.630 | 76.9 % | 0.484    | 84.8 %    |
| linear (no hidden layer), `diff-masked`, target outcome  | 0.604 | 76.0 % | 0.426    | 84.1 %    |
| MLP 32×16, `pair-masked`, target outcome                 | 0.616 | 75.8 % | 0.445    | 83.5 %    |

All rows but the baselines are with mirrored rows. Without mirroring (first search, same data):
`diff-masked` 0.607, `pair-masked` 0.620, and the unmasked `pair` ablation 0.614. The opponent's
hidden-card features help prediction only slightly (pair 0.614 vs pair-masked 0.620), and the
recipe's layout is masked, since a leaf cannot see them. Late-game up-weighting (`--late 1`) barely
changed the validation MSE (`pair-masked` 0.618 vs 0.620, within noise), so it is not used. Sizes 8 to 128×64 and learning rates 1e-4 to 1e-3
all landed within 0.603–0.62. Every run early-stopped after 1–5 epochs: positions within a game
are strongly correlated, so the ~1 100 training games are the real sample size.

Every learned value predicts the winner clearly better than the hand-tuned evaluation (+4 to +5
points of sign accuracy, −0.09 MSE). That did **not** translate into playing strength by itself.

### Gate results

All gates: `ismcts:iters=N,value=<candidate>` vs `ismcts:iters=N,value=eval` (the hand-tuned
leaf) at equal iterations, all 30 pairings with seat swaps, 6 jobs on a loaded 12-core machine,
95 % Wilson intervals, draws count half. The gate needs ≥ 55 % with the lower bound above 50 %.

| Candidate                                           | Iters | Seed | Games | Win rate   | 95 % CI          | Margin     | Result        |
| --------------------------------------------------- | ----- | ---- | ----- | ---------- | ---------------- | ---------- | ------------- |
| MLP 32×16, outcome, **no mirrored rows** (cand0)    | 100   | 9001 | 200   | 31.3 %     | [25.2, 38.0]     | −6.6 ± 1.2 | failed        |
| screen: MLP 32×16, outcome, mirrored                | 50    | 9101 | 60    | 47.5 %     | [35.4, 59.9]     | −2.8 ± 1.7 | (screen only) |
| screen: linear, outcome, mirrored                   | 50    | 9101 | 60    | 57.5 %     | [44.9, 69.2]     | −0.3 ± 1.6 | (screen only) |
| screen: MLP 32×16, margin, mirrored                 | 50    | 9101 | 60    | 57.5 %     | [44.9, 69.2]     | +1.1 ± 1.6 | (screen only) |
| screen: MLP 32×16, outcome, mirrored, `evalMix` 0.5 | 50    | 9101 | 60    | 54.2 %     | [41.7, 66.1]     | +0.2 ± 2.0 | (screen only) |
| **MLP 32×16, margin, mirrored (cand1, the recipe)** | 100   | 9201 | 200   | **47.3 %** | **[40.4, 54.2]** | −0.9 ± 1.0 | **failed**    |

Findings:

- **Mirrored rows are essential.** The records are taken at decision points, where the deciding
  seat is nearly always the active one. A leaf is a settled state at the start of the _other_
  seat's turn, scored from the root seat's side, so `turn.isActive`, `actions.available` and
  friends sit far outside the training distribution (clipped at −6 σ). The first candidate,
  trained without mirrored rows, lost 31 % to the hand-tuned leaf although its validation
  numbers were good. `train-value.ts` now adds the mirrored row of every record by default.
- **Validation MSE did not predict strength.** The margin target has the worst MSE against the
  outcome of the MLPs but played best; the outcome target, with a lower MSE, played worse. The
  search ranks sibling leaves that differ by a VP or two, so a value with a finer, margin-like
  slope matters more than a calibrated win probability. `npm run bot:retrain` therefore trains
  the screened recipe (`RECIPE` in `tools/retrain.ts`); `--search` keeps the validation pick.
- The screens are 60 games, so their intervals overlap widely; only the 200-game gate counts.
  The best screened candidate gated at 47.3 % [40.4, 54.2]: no better than the hand-tuned leaf,
  and its 57.5 % screen was noise.
- **Nothing passed, so nothing shipped.** `src/bot/weights/value.json` is a placeholder
  (`format: 0`) and Hard plays with the hand-tuned leaf, exactly as before this package. The
  candidates are in `.bot-data/` (not in git).
- Why the hand-tuned leaf is hard to beat: it is the exact VP margin plus small, sensible
  terms, so it ranks sibling leaves that differ by one VP correctly by construction. A value fit
  to noisy game outcomes from ~1 100 heuristic games predicts the winner better on average
  (+5 points), but its slope between near-identical states is less reliable. Next steps, in
  order of promise: a residual network that starts at the hand-tuned evaluation and learns a
  correction (`evalMix` is a cheap first form of this); Expert Iteration rounds with ISMCTS
  self-play, so the data comes from the stronger searcher; more games; and a gate at the
  shipped budget (200 iterations) once a candidate clears 100.

### Retraining

```bash
npm run bot:retrain                                   # self-play → train → gate (~1 h on 6 jobs)
npm run bot:retrain -- --ei-games 200 --ei-iters 64   # + one Expert Iteration round (~+35 min)
npm run bot:retrain -- --candidate FILE               # only gate existing weights
npm run bot:retrain -- --baseline learned             # gate against the shipped weights
```

`tools/retrain.ts` runs fast self-play (`--games`, default 960, seeds `--seed`…+3) into
`.bot-data/it0`, trains the recipe (`RECIPE`) into `.bot-data/candidate-value.json`, optionally
plays an Expert Iteration round (`--ei-games` ISMCTS games at `--ei-iters`, the candidate as
leaf vs the hand-tuned leaf, seed `--seed`+100) and retrains on both, then gates
(`--gate-games`, default 200, at `--iters`, default 100, on `--gate-seed`, default 9001, which
must not be a training seed). `--jobs` defaults to 6, `--reuse` keeps existing record files, and
`--extra-data` adds record directories. It writes `src/bot/weights/value.json` only on a pass,
with the result in `meta.gate`; otherwise the candidate stays in `.bot-data/` and the run still
exits 0. The steps are also separate tools: `tools/selfplay.ts`, `tools/train-value.ts`,
`tools/arena.ts --weights`.

Measured on 6 jobs of a shared 12-core machine (load ~10–14): 480 fast games ≈ 3 min, one
training run ≈ 0.5 min (a 6-way `--search` ≈ 1 min), a 200-game gate at 100 iterations ≈ 44 min
(13 s per game), a 60-game screen at 50 iterations ≈ 7.5 min.

**Expert Iteration status.** Only iteration 0 (heuristic self-play) was run. The ISMCTS
self-play round is implemented (`--ei-games`), but the task brief made it conditional on a
passed iteration-0 gate, and neither gate passed within the time box.

## Against the official solo Bot

In a solo game the house AI can play your seat. The official Bot's own turn is rules: `playBots`
dispatches its `BOT_STEP`s without asking a bot, and its choices are piloted inside `reduce`. The
learned value was trained on two-player games only, so solo positions use the hand-tuned
evaluation. Determinization pools the Bot's face-down Staging row with its deck and Log, and
keeps its Supplement deck as a pool of its own. A no-cheat test covers solo
(`determinize.test.ts`).

`npx tsx tools/solo-arena.ts --bot <spec> --games N` plays the house bot (as you) against every Bot
crew × level and reports the win rate per level. `npm run bot:check` runs one game per cell.

| Run (2026-10-31, seed 3, 1 game per crew × level) | Ensign | Lieutenant | Commander | Captain | Admiral |
| ------------------------------------------------- | ------ | ---------- | --------- | ------- | ------- |
| `normal` (as you): games won                      | 0/6    | 0/6        | 0/6       | 0/6     | 0/6     |
| `normal` (as you): mean VP margin                 | −13.2  | −23.7      | −30.8     | −47.3   | −46.7   |

The margin worsens with every level, so the difficulty ladder works. The house AI loses even at
Ensign, and the score breakdowns show why: it never completes a mission against the Bot, so it
scores no Focus and no mission VP. The Bot scores its Focus without a mission and 5 VP per
ENDGAME card (both are rules). That is a house AI weakness to work on (a solo-aware value or
mission priority), not a Bot bug: the rulebook's complete Bot turn is replayed exactly in
`src/engine/solo/rulebook-turn.test.ts`.

## Maintaining the house AI

For future developers and agents changing cards, rules or the bots.

- **The AI is rule-agnostic.** It plays through `legalIntents`, `PendingChoice` and the engine's
  own `reduce`, and it scores positions with generic features. New cards are JSON
  (`src/data/cards/`), so they need no bot code. Never add card-specific bot code (no
  `if (card.id === …)`, no card names anywhere). If a card plays badly, improve a generic feature
  or prior instead.
- **A new `PendingChoice` kind** needs a case in `src/bot/candidates.ts` (the options the
  heuristic and the search consider) and in `firstLegalPolicy` (`src/bot/autoPlay.ts`, the
  fallback every bot can use). The TypeScript switches are exhaustive, so the build tells you.
- **A new resource, track, token or scoring rule** should become a feature in `evaluate.ts`
  (append it to `FEATURE_NAMES`, never reorder) with a hand-tuned weight in `EVAL_WEIGHTS`. If it
  is the same for both seats, add it to `GLOBAL_FEATURES`; if the opponent's value depends on its
  hidden cards, add it to `HIDDEN_OPP_FEATURES` (`learned.ts`).
- **After any card, expansion or rule change, run `npm run bot:check`** (about 1–2 minutes). It
  must report 0 fallbacks and 0 abnormal stops (CYCLE / CAP / STALL / CRASH), and it says
  whether the bundled weights still match.
- **When the features change, or after an expansion, run `npm run bot:retrain`.** Changed
  features change `featureHash`; changed card data changes `cardDataHash`. Either way, stale
  weights fall back to the hand-tuned leaf automatically, so the game never plays with a
  network trained on other rules. It only plays somewhat weaker until it is retrained.
- **Only commit weights that passed the gate.** `tools/retrain.ts` writes
  `src/bot/weights/value.json` only on a pass; never copy a candidate there by hand. A
  `value.json` without `meta.gate.passed: true` is ignored by Hard.
- **Strength claims need arena numbers**: `tools/arena.ts` with at least 200 games over all
  pairings with seat swaps, on a seed not used for tuning or training, and the Wilson interval.
  Record them in this file.
- **No cheating, and determinism.** A bot reads hidden information only through `determinize`,
  seeds its randomness from `seedFromView`, and never mutates the state (`types.ts`). `src/bot`
  is under the determinism lint: no `Math.random`, `Date.now` or `new Date`. A wall clock is
  injected from the UI only. Training code that must be reproducible (`valueTrain.ts`) uses
  its own seeded PRNG.
- **The UI's time budget** is set in `src/ui/workerBots.ts`: the worker gives Hard
  `HARD_TIME_MS` (1.5 s, `src/bot/index.ts`) of wall clock per decision, and the in-thread
  fallback keeps the deterministic `HARD_ITERATIONS`.
