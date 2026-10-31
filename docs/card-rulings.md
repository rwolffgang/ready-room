# Card rulings & interpretation log (todo/11)

This log records **every interpretation that had to be made** while transcribing a
card record into an effect tree, with the reasoning and the rulebook section relied
on. Transcribing agents append an entry (oldest→newest) whenever they resolve an
ambiguity, choose one of two plausible readings, or fix an inconsistency between a
record and the rules. Future-you will re-litigate these otherwise.

> Ground truth precedence: `rules/08-keywords-reference.md` > `rules/12/…` >
> Cyclopedia > sibling cards. When still ambiguous, **do not guess** — add the card
> to `cards/records/REVIEW.md` with the exact question and move on (todo/11 §7).

---

## 001 — The describe() round-trip is the substitution for looking at the card

- **Date:** todo/11 setup · **File:** `src/engine/describe.ts`
- **Ruling:** The implementing LLM cannot see card images, so the workflow is
  `record text → effect tree → describe() → diff vs. record` (todo/11 §1–§2).
  `describe()` renders the tree back using the **records' own vocabulary**:
  resources as `{DIL}`/`{LAT}`/`{GLO}`, suits/traits in ALL-CAPS (`ALLY`, `CARGO`, …),
  `{ACTION}` for the action cost, `[ATTACK]` for the ATTACK prefix, `Requires X N`
  for the specialty gate (record form: `Requires {REQ_MILITARY} 3`).
- **Keyed on:** todo/11 §2; `docs/effect-dsl.md` §7 corpus examples.
- **Consequences:**
  - `PAY_THEN` renders cost " to " body ("Spend 2 {DIL} to gain a CARGO."); a bare
    `SEQ` renders steps joined with ". " ("Gain a CARGO. Draw a card."). This is the
    `to`/`.` cost-benefit seam from `rules/12` §12.1 — the round-trip tests it directly.
  - `describe()` is total over all 63 node kinds and is reused for UI tooltips
    (`docs/ui-spec.md` §3). Guarded by a compile-time `Record<Effect['k'], …>` in
    `src/engine/describe.test.ts` so a new node kind cannot be added silently.

## 002 — Operation-level text includes derived prefixes, not just the effect

- **Ruling:** `describe(effect)` renders the selection of the whole game; the
  operation's `{ACTION}` / `[ATTACK]` / `Requires …` / `After you …` prefixes live on
  the `Operation`, not inside the Effect union. So the verifier uses
  **`describeOperation(op)`** — prefixes + trigger phrase + `describe(effect)` —
  when diffing against a record. `ALL.md` renders the same derived prefixes
  (`{ACTION}`, `[ATTACK]`, `(Requires X N)`) from the same JSON fields.
- **Keyed on:** todo/11 §3; `tools/assemble_records.py` output in `cards/records/ALL.md`.

## 003 — Records can be OCR-noisy; the verifier compares significant tokens only

- **Ruling:** Records were produced by OCR + Cyclopedia and carry garbage runs
  ("038087KI", "TILA O DES E/2204 PPO.ARZ") and typos ("CARGD", "CLOAKO", "sHip").
  The fidelity checker therefore compares **significant tokens** — numbers, `{ICON}`
  tokens, suit/trait/specialty names and the keyword verbs of `rules/08` — and
  ignores filler ("the", "of", "you", "card"). A missing number/icon/suit is a
  **hard miss** (`REVIEW`); a missing keyword is **informational** (could be
  paraphrase). This keeps the queue honest without drowning it in OCR noise.
- **Keyed on:** todo/11 §3; verified against `cards/records/core/*.json`.

## 004 — §7 example 6 (`Amargosa Observatory`) filter suit is ENCOUNTER, not "DISCOVERY"

- **Ruling:** The prose example in `docs/effect-dsl.md` §7 says "After you play a
  DISCOVERY"; the tree filter is `{ suits: ['ENCOUNTER'] }`. DISCOVERY is a card
  _name_ (a specific Encounter), not a suit. Transcription follows the tree filter.
  The docs' §7 text conflicts with the schema on another point: its `LOG` target
  uses `{ "zones": [{ "k": "DISCARD", "seat": "SELF" }], "pick": 1 }` — `pick` is not
  in the schema `Query` (todo/03 finalised `Query = zones/seat/filter/countIcons`).
  The schema-conformant form drops `pick`; a 1-card pick without a `pick` field
  resolves the same way. The round-trip test uses the schema-valid shape.
- **Keyed on:** docs/effect-dsl.md §7; `src/data/schema.ts` `QuerySchema`.

## 005 — "1 card" is an article, not an amount, in round-trip comparison

- **Ruling:** `describe()` renders `DRAW 1` as record-style "Draw a card." while
  §7's prose example writes "Draw 1 card if you have 2+ ANOMALY in play." The
  round-trip tokeniser treats "N card" ≡ "a card" (article), so only _real_ amounts
  (2+ in a cost, "gain 2 {DIL}") are hard-required. Otherwise a faithful tree would
  permanently fail on "Draw 1 card" vs "draw a card".
- **Keyed on:** todo/11 §2–§3; docs/effect-dsl.md §7 example 4.

## 006 — Structural lint is advisory, and rule 1 (" to ") has one known false-positive

- **Ruling:** The "`to` join ⇒ PAY_THEN" heuristic must not fire on promotion
  targets ("Promote … **to Duty Officer**") or on forced effects ("Force your opponent
  **to** dismiss …" is `FORCE`, not a cost-benefit). The lint therefore only triggers
  when `to` is followed by a benefit verb (gain/beam/warp/send/take/…), and skips
  clauses starting "attack"/"force". Remaining false positives are expected and
  are why the lint exits non-zero on hits but is not the schema gate.
- **Keyed on:** rules/12 §12.1 (`to` = cost/benefit seam); todo/11 §4.

## 007 — Scratch demo cards are kept (documented), not removed

- **Ruling:** The DoD allows a hand-written sample card under a scratch location.
  The demo corpus lives in `tools/scratch/`:
  - `tools/scratch/implemented/1ALL02-13.json` — BOLIANS (real record, faithful
    tree) — proves zero-lint / full-fidelity transcription.
  - `tools/scratch/buggy/1PIC15-24.json` — ANALYZE with a deliberate
    `Gain 2 {DIL}` → `amount: 1` bug — proves the fidelity queue flags a hard miss
    and the lint flags a `number→Amount` violation. Demonstrates the "classic
    failure" todo/11 §3 describes; use it to sanity-check the toolchain.
  - `tools/scratch/dryrun/cards.json` — PAY_THEN demo cards for `tools/dryrun.ts`
    (`dry-payres`, `dry-paydiscard`, `dry-reaction-may`) plus support cards.
    These were kept on purpose so the three CLIs are runnable today; todo/12/13
    replace them with real `src/data/cards/**` JSON.
- **Keyed on:** todo/11 §3, §5 + DoD.

## 008 — Dry-run resolves by pushing OPERATION frames directly

- **Ruling:** `tools/dryrun.ts` builds a minimal `GameState` (`newGameState` +
  `addCard`, skipping full `setup()`/completeness churn), then pushes an OPERATION
  frame per operation and runs the real resolver. PendingChoices are printed and
  auto-resolved with `probeFirstChoice` (which _declines_ `CONFIRM`/may and picks the
  first legal selection elsewhere) — so a `MAY` shows a `CONFIRM` and then no-op.
  Probing each PLAY op with the resolver's `probe()` covers todo/16 §6's
  "canPlay in some constructible state".
- **Keyed on:** todo/11 §5; `docs/state-machine.md` §2–§5.

---

_Transcription agents: append the next entry (009, …) with date, rule(s), and the
reasoning — never delete an entry; the log is append-only._

## 009 — todo/12 common cards: DSL gaps the 67 market cards hit

- **Superseded (box-1 common STCC pass, ruling 044):** the gaps and guesses below were written against
  OCR records. Every common card has since been re-translated from the STCC text and the DSL gaps
  closed; the current trees and remaining interpretations are listed in 044. Kept for history only.

- **Ruling (drive-by):** implementing 25 PERSON / 16 CARGO / 13 SHIP / 13 ALLY
  with the existing DSL left several mechanics unexpressible. Used existing nodes
  as best-effort and flagged here for the coordinator; do NOT invent nodes in
  cards. Gaps (none editable by me — nodes/resolver/describe are the parallel
  agent's): no trait-grant ("SHIP gains CLOAK for remainder of turn"; hand-size /
  additional-on-duty allowances); no "CAPTAIN has TRAIT and value N+" predicate;
  no conditional reward bound to a just-discarded / just-gained card ("if the
  dismissed/discarded/gained card is X, gain …"); no per-away-team or
  per-removed rewards ("gain 1 {GLO} for each removed", "1 {GLO} for every 2
  cards in your Log", floor division); no reveal-hand; no put-card-on-top-of-own-
  deck benefit (only `COST_PUT … to DRAW`, which is a cost); no `COST_BEAM`
  ("beam this card to a SHIP to send…"), no opponent-choice vs actor-choice
  separation inside `OPPONENT`/`FORCE`; no PASSIVE triggers (hand-size and
  take/return-INCIDENT passives are `NOOP`); no "any number of SHIP" warp count;
  no undo-an-attack / ignore-an-attack-effect node.
- **Rulings used instead** (documented so the fidelity/lint noise is explained):
  - `FORCE`/`OPPONENT` + seat-0 zones target the opposite player (ZoneSpec seat
    is actor-relative — `resolveQuery.ts`). E.g. "force your opponent to dismiss
    their Duty Officer" = `FORCE(DISMISS … zones:[DUTY_OFFICER seat 0])`.
  - `COST_LOG`/`COST_RECALL` (from the parallel agent's primitives) are used for
    "log an in-play ATTACK to enlist…" (1CAR07) and RIVA's hand-log cost.
  - `COST_PUT to:{k:'DRAW'}` stands in for "put a card on top of your deck" when
    it is a _cost_; when it is the final _benefit_ (1CAR05, 1PER17/18) it is a
    documented `NOOP` gap.
  - `PAY` merged into a _different_ operation type's text (record merges an
    ACTIVATION fragment into a PLAY/RESUPPLY op) is left unmodeled + noted, so op
    counts stay aligned with records for the fidelity checker.
- **Keyed on:** `docs/effect-dsl.md` §§2–5; rules/05 §5.2; rules/08 → put-on-top,
  log, dismiss, away-team.

## 010 — todo/12 flagged-ambiguous records (see cards/records/core)

- **Superseded (box-1 common STCC pass, ruling 044):** the gaps and guesses below were written against
  OCR records. Every common card has since been re-translated from the STCC text and the DSL gaps
  closed; the current trees and remaining interpretations are listed in 044. Kept for history only.

- **Ruling (drive-by):** these records are garbled/merged or carry an ambiguous
  mechanic; the effect tree is my best-effort reading and each needs a human
  (or the image) to confirm:
  - 1CAR01 BIOBED — "Free play an [unreadable] OR find a DOCTOR" target garbled;
    encoded generic free-play-from-Discard vs FIND DOCTOR.
  - 1CAR02 op1 — "If your CAPTAIN has BORG and 6+ value" has no predicate; only
    the "you may send to any LOCATION" is encoded (`MAY SEND_AWAY_TEAM` ignoring
    blocking); regenerate unmodeled.
  - 1CAR05 PASSIVE — "additional PERSON on duty" allowance → `NOOP`
    (no hand-size/capacity node); `requires.min` was null → set to 1 (schema).
  - 1CAR07 — "log an ATTACK to enlist a …" suffix garbled ("Reserve?"); encoded
    `COST_LOG ATTACK → ENLIST_RESERVE`; DEPLOY folded into PLAY (ONGOING); the
    REACTION's trigger/identity garbled → `CARD_GAINED → GAIN GLO 2`.
  - 1CAR09 MEK'LETH — first "gain 1 [icon]" reward icon missing (guessed GLO);
    "force reveal hand" unmodeled; "you may discard an ATTACK from their hand"
    encoded as `MAY(PAY_THEN(OPPONENT(COST_DISCARD ATTACK) → GAIN GLO 1))`.
  - 1CAR11 op1 — "Spend 1 {DIL} to gain an [blank]" reward unreadable → `NOOP`;
    REACTION dismiss-self-to-ignore-an-attack → `NOOP` + ATTACKED trigger.
  - 1CAR12 PLASMA MANIFOLD — cost resource for "Spend 3" missing; guessed GLO 3
    → DIL 1 (flag before playtesting).
  - 1CAR13 — heavily garbled; encoded IF(SECURITY)→GLO, FORCE(LOG ATTACK),
    MAY(dismiss CLOAK→GLO); "gain a SHIP to gain 2 3" segment unreadable.
  - 1CAR15 — "gain 1 {GLO} for each removed" per-removed → `NOOP` gap.
  - 1CAR16 — merged/out-of-order fragments; encoded DRAW 1 → TAKE_CONTROL
    FROM_LOCATION_DECK → JUNK → spend 3 DIL draw → DESTROY THIS; "look at top 2
    LOCATION/ENCOUNTER rearrange" unmodeled.
  - 1PER01 — PASSIVE (no ATTACK play/promote + extra STARFLEET duty officer)
    → `NOOP`; "Enlist a Development" treated as non-free.
  - 1PER02 — ACTIVATION ("Spend 1 {GLO} to warp any number of SHIP") merged into
    RESUPPLY text → unmodeled; RESUPPLY = DRAW per OPS (max 3).
  - 1PER06 — single op mixes PLAY and REACTION text; encoded as the REACTION
    (find+free play SYNTHETIC, draw 1, gain GLO 2) on PUT_INTO_PLAY ANDROID.
  - 1PER07 op0 — "If it has [X], gain 2 {GLO}" trait unreadable → `NOOP`;
    op1 "gain an [action?]" guessed GAIN_ACTION 1.
  - 1PER09 op0 — "If you do both, gain 1 {GLO} and you may promote this card":
    now two independent MAYs (SEND `bind`, LOG `bind`) + `IF DID [both]`
    (docs/effect-dsl.md §2 "Choices and conditions").
  - 1PER11 op1 — garbled "Spend 2 … or 1 to refresh CAPTAIN/CARGO/SHIP";
    "duplicate a resolved Resupply" has no node → encoded CHOOSE_ONE[NOOP
    duplicate | spend 1 → refresh].
  - 1PER12 — ACTIVATION merged into PLAY op; "gain 1 {GLO} for each ANOMALY in
    play (max 3)" encoded as GAIN {MIN(count,3)} on dismissing an ANOMALY.
  - 1PER13 op1 — conditional gains on ROMULAN/BUSINESS discarded card → `NOOP`.
  - 1PER15 op0 — "gain 2 3" reward unreadable; log-CLOAK reward unmodeled.
  - 1PER16 — REACTION fragment merged into PLAY op; "gain 1 [icon]" guessed GLO.
  - 1PER17 — PASSIVE put-this-card-on-top → `NOOP`; "scan 1 of CARGO" SCAN_N 1.
  - 1PER19 op1 — share-traits-with-Riva gain + ignore-attack → `NOOP`;
    hand-log cost via `COST_LOG from HAND`.
  - 1PER20 — "free play from Draw and/or Discard" encoded as one 1-LAT →
    both FREE_PLAYs; REACTION (after gaining CARGO draw) merged → unmodeled.
  - 1PER21 — Badlands SHIP clause unmodeled; "find FERENGI … draw" garbled;
    RESUPPLY reveal-hand + "additionally gain an [icon]" → `NOOP`.
  - 1PER22 — PLAY "CANNOT BE PLAYED" kept as a PLAY op with `NOOP` (cannot
    BePlayed flag would break op-positional fidelity); PASSIVE INCIDENT gain
    → `NOOP` (no PASSIVE trigger).
  - 1PER23 op0 — record isAttack=false but text starts "ATTACK PLAY:"; mirrored
    record (validate warns: ATTACK trait, no attack op) — flag for 02c.
  - 1PER24 op0 — optional beam of the gained card onto a SHIP, paying 1 {LAT} → `MAY(SEQ[
BEAM, GAIN LAT 1])` (no COST_BEAM).
  - 1PER25 op1 — "spend 3" resource unknown → guessed DIL 3.
  - 1CAR13 & 1PER23 also trigger the slate "trait ATTACK but no isAttack op"
    validate warning — records say isAttack=false; kept faithful to records.
- **Keyed on:** todo/12 per-card procedure; todo/02c record provenance.

## 011 — Known false positives the todo/12 lint + fidelity emits

- **Ruling (drive-by):** `lint_trees.ts` rule 9 (`number→Amount`) cannot reach
  zero on this corpus: `amountLiterals` does not collect `SCAN_N.n`,
  `REPEAT.times`, `UP_TO.max`, `MIN/MAX` terms, `TAKE.look`, predicate counts
  (`HAS_TRAIT_IN_PLAY.count`, `COUNT_AT_LEAST.value`), `REFRESH.count`, or
  `RESOURCE.amount` amounts embedded in `MIN`/`COUNT`; and OCR digit runs
  ("88 7", "51", "31", "88039", "38089", "933911", "a 2 PERSON", "38087"…)
  always land in `numbersInText`. Rule 3 (`either/"OR"`) is case-insensitive
  `/\b OR \b/i`, so plain "…or Discard pile" flags cards that correctly use no
  `CHOOSE_ONE`. `check_fidelity` HARD-misses the same OCR tokens and every
  `NOOP` gap (PASSIVE allowances, conditional/per-removed gains, merged
  fragments) — score reflects the source OCR, not the tree. All such hits are
  intentional; the schema gate (`validate-cards`) is the real arbiter.
- **Keyed on:** todo/11 §3–§4; corpus `numbersInText` / `significantTokens`.

## 012 — todo/12 LOCATION batch: merged/garbled records & approximations

- **Superseded (box-1 common STCC pass, ruling 044):** the gaps and guesses below were written against
  OCR records. Every common card has since been re-translated from the STCC text and the DSL gaps
  closed; the current trees and remaining interpretations are listed in 044. Kept for history only.

- **Merged / garbled records:**
  - 1LOC10 — PLAY text is garbage OCR → encoded as a single PLAY `NOOP`.
  - 1LOC13 — "CONTROL: no effect" folded into the ACTIVATION text; no separate
    CONTROL op (op-type list is `[PLAY, ACTIVATION]`).
  - 1LOC19 — CONTROL "gain 1 ACTIVATION: log a PERSON…" merged → guessed
    `GAIN_ACTION 1`; ops are `[CONTROL, ENDGAME, ACTIVATION]`.
  - 1LOC01 — REACTION SPECIAL clause (warp-all SHIP, draw 2) merged into PLAY
    and unmodeled.
  - 1LOC16 — ACTIVATION blob reduced to `RECALL` only.
  - 1LOC02 — single PLAY op despite "CONTROL:" preamble; PLAY =
    `MAY(COST_PUT 1 → COST_ACTION → ENLIST_DEVELOPMENT)`.
- **Approximations:**
  - 1LOC05 BETAZED — dropped icon guessed `{GLO}`.
  - 1LOC06 CORVAN — share-trait condition is a free `CHOOSE_ONE[DIL 1 | DIL 2]`
    (trait-agnostic).
  - 1LOC04 / 1LOC16 — beamed-host dynamic → `RECALL` / `SCORE_VP` over
    `ALL_OWNED` PERSON (over-broad; no per-ship owner node).
  - 1LOC18 — "where you have a SHIP" filter not encodable → unconditional.
  - 1LOC17 — deck-bottom INCIDENT → `TAKE`-to-hand (equivalent here).
  - 1LOC07 — SECURITY modeled as a trait per sibling convention.
- **Lint / fidelity false positives to cite:** `UP_TO.max` / `REPEAT.times`
  not collected by `amountLiterals` (RISA 3, TULGANA 2); OCR digit runs are
  junk, not amounts (DOZARIA `7`, KELVAS `093089`, VEREX `287/363/1000`,
  RISA `2024/1`); rule-3 "either/OR" records fire despite correct
  `CHOOSE_ONE` / choice-free trees; CORVAN `CAPTAIN` + `{DIL}` hard-miss from
  trait-agnostic labels.
- **Keyed on:** todo/12 §1–§2; rules/06 §…; card record JSON `1LOC*`.

## 013 — describe() COST_PUT renders the filter noun (no outcome change)

- `describe.ts` COST_PUT now prints the filter noun (e.g. "Put a DIRECTIVE from
  your hand on…") instead of the generic "Put 1 card from your hand…". This is a
  rendering-only change: fidelity for LOC07/LOC20 now captures the
  DIRECTIVE/SECURITY/PERSON icon tokens; no existing describe() test outcome
  changed. LOCATION needed **no new DSL nodes** — COST_BEAM (todo/12 prior
  agent) suffices for BA'KU.
- **Keyed on:** src/engine/describe.ts; describe.test.ts.

## 014 — schema vp relaxation for negative penalty INCIDENTs

- `CardDefSchema.vp` relaxed from non-negative to `z.number().int()` to allow
  the `-2` penalty INCIDENTs (1INC02/05/06 and crew records mirror this).
  Engine scoring adds `def.vp` directly, so negative values subtract as written.
- **Keyed on:** src/data/schema.ts; rules/12 edge cases.
- Also note: `tsconfig.app.json` adds `"types": ["node"]` so `src/data/catalog.ts`
  (which imports `node:fs/promises`) type-checks inside the app project.

---

## 015 — DEPLOYED crew ships: the Cyclopedia records beat rules/11's prose

- **Date:** todo/13 Phase A · **File:** `src/data/cards/crew/picard.json`, `src/data/cards/crew/shran.json`
- **Ruling:** `rules/11`'s Phase-A paragraph claims Picard/Shran have no `DEPLOYED`
  starting cards, but the records `1PIC02/24` (U.S.S. Enterprise-D) and `1SHR02/24`
  (Kumari) both carry `startPosition: "DEPLOYED"` with
  `startPositionSource: "cyclopedic-heading+ocr-indicator"`. Per todo/13 the
  **records win**: both ships are implemented `startPosition: 'DEPLOYED'`, so setup
  places Enterprise-D and Kumari in the FLEET at game start (verified in the
  Picard-vs-Shran playtest — both review flags are the incidental `vp-absent`).
  The parallel 1KOL02 I.K.S. Gr'oth follows the same pattern.
- **Keyed on:** `cards/records/core/1PIC02-24.json`, `1SHR02-24.json`; todo/13 "records win".

## 016 — Bozeman RESEARCH threshold + §12.29 ALL_OWNED exclusion

- **Date:** todo/13 Phase A, refreshed in the Picard/Shran STCC pass · **File:**
  `src/data/cards/crew/picard.json`, `src/engine/scoring.ts`
- **Ruling:** `1PIC10` U.S.S. Bozeman's second PLAY op is a [res6] Play that pulls a Staging
  Area card back (TIME TRAVEL cards excluded) — `requires: { specialty: 'RESEARCH', min: 6 }`
  per the STCC text (the old OCR record lost the digit and the op was first guessed at 5;
  superseded). Second: a `SCORE_VP` COUNT over `ALL_OWNED` excludes cards still in the Reserve
  deck and Development pile (`rules/12` §12.29: setup piles "score nothing"). `scoring.ts`
  applies that only inside the scoring pass (`scoreVpAmount`); the generic `ALL_OWNED` query
  keeps the piles mid-game because those cards are still yours.
- **Keyed on:** STCC `1PIC10/24`; `rules/12` §12.29; `rules/07` §7.4.3.

## 017 — SEND_AWAY_TEAM targets must include the Neutral Zone

- **Date:** todo/13 Phase A · **File:** `src/data/cards/crew/{picard,shran}.json`
- **Ruling:** the crew records say "send an AWAY TEAM to a LOCATION" (any
  location, including the neutral zone), but `SEND_AWAY_TEAM`'s `IN_PLAY` zone
  excludes the three Neutral Zone slots (`state.ts` `zoneProps`), so raw
  `IN_PLAY` targets silently offered no Neutral-zone choice. All crew
  `SEND_AWAY_TEAM` targets were expanded to an explicit
  `LOCATION_AREA (seat 0)` **plus** `NEUTRAL_ZONE slots 0/1/2`, all filtered
  `{ suits: ['LOCATION'] }`. Patched: `1PIC14 op0`, `1PIC22 op0`, `1PIC24 op0`,
  `1SHR05 op0`, `1SHR20 op0 & ACTIVATION`, `1SHR21 op0`, and Worf `1PIC23`'s
  "neutral LOCATION". The playtest exercises the NZ path (Worf sends 2 AW to
  `NZ: 0`).
- **Keyed on:** `rules/12` location/away-team zone model; `src/engine/state.ts`.

## 018 — setupMissions must read boardSide from the config, not the player record

- **Date:** todo/13 Phase A · **File:** `src/engine/setup.ts`
- **Ruling:** `setupPlayerBoard` runs missions **before** `setupPlayerRecord`
  stamps `boardSide` onto the player, and `newGameState` defaults
  `boardSide: 'BASIC'` — so every ADVANCED board silently received the single
  Basic mission. `setupMissions` now reads `pl(config, seat).boardSide`. Verified:
  Picard ADVANCED = 3 missions (PEACE NEGOTIATIONS first, vp 4), Shran BASIC = 1
  mission (vp 0); `m1-exit.test.ts` unchanged (still 4/4). DoD for todo/13 boards
  requires ADVANCED = 3 missions and BASIC = 1, so this is a correctness fix, not
  a behaviour choice.
- **Keyed on:** `src/engine/setup.ts`; todo/13 crew boards.

## 019 — Picard batch: Captain, Data, Worf, Crusher, Riker interpretations

- **Date:** todo/13 Phase A, refreshed in the Picard/Shran STCC pass · **File:**
  `src/data/cards/crew/picard.json`
- **Ruling (current data, per STCC):**
  - `1PIC01` Captain: ENDGAME 1 VP per ALLY you own; REACTION on an ALLY gain (pay one discard
    for +1 {GLO}, then optionally beam that ALLY onto a SHIP) =
    `PAY_THEN(COST_DISCARD → SEQ[+1 {GLO}, MAY BEAM $event.card])` — not offered with an empty
    hand (reaction payability).
  - `1PIC12` Data: PLAY gain 1 of RES/INF/MIL; ACTIVATION log a card from hand → gain on one
    track per 5 cards in your Log.
  - `1PIC13` Crusher: REACTION discard a _different_ card (`exceptBound: $event.card`) to return
    the taken INCIDENT and gain 1 {GLO}.
  - `1PIC23` Worf (errata): PLAY `TAKE { deck: INCIDENT, to: DISCARD }`, discard the deck top,
    send 2 Away Teams to a neutral LOCATION; ATTACK ACTIVATION discard → remove an opponent Away
    Team where you have one, **+1 {GLO} only if one was removed** (`bind` + `DID`).
  - `1PIC24` Riker: RESUPPLY discard the deck top and gain 1 {LAT}; ACTIVATIONs free play a
    STARFLEET SHIP / draw a SHIP from the Discard pile.
- **Keyed on:** STCC `1PIC*/24` (errata `picard-worf`); `rules/07` §7.4.3.

## 020 — Shran batch: interpretations (refreshed against STCC)

- **Date:** todo/13 Phase A, refreshed in the Picard/Shran STCC pass · **File:**
  `src/data/cards/crew/shran.json`
- **Ruling:** every Shran card now follows the STCC text; the earlier OCR guesses are gone.
  Notes on the modelling choices that remain:
  - `1SHR01` Shran: RESUPPLY 1 {DIL} per CARGO in play; `[action]` ACTIVATION discard a CARGO →
    send an Away Team to a controlled LOCATION. (No ENDGAME op — the Captain has none.)
  - `1SHR03` AENAR — development cost "find a WEAPON and log it" = `COST_LOG` over hand,
    Discard, Draw and Reserve.
  - `1SHR04` CORIDAN — CONTROL may discard 2 → 2 {DIL} + 2 {LAT}; RESUPPLY 1 {DIL}, +1 more at
    INFLUENCE 7+; ENDGAME 1 VP per 4 {DIL} (`PER`).
  - `1SHR06` TENEBIAN AMETHYST — `SPECIAL` with `trigger: CARD_LOGGED` fires on any log.
  - `1SHR09` AMBASSADOR THORIS (errata "both players") — each player may return an INCIDENT;
    you gain 1 {GLO} per INCIDENT returned by either player.
  - `1SHR12` WEYTAHN — CLEAN-UP `DISMISS target THIS` when no Away Team is here; ENDGAME 4 VP
    with 2+ here. Both count the controller's Away Teams: taking control removes the
    opponent's and they can never be sent to a Location you control (rules/06 §6.3.1), so
    "yours" and "any" agree.
  - `1SHR13` UNITED EARTH — logs itself only if the free play happened (`DID`).
  - `1SHR16` IMPERIAL PRIDE — one Away Team from each of 3 different controlled LOCATIONs → look at
    2 ENCOUNTERs, take one, the other to the bottom; spend 10 {DIL} + log a controlled LOCATION →
    take the top ENCOUNTER, +1 INFLUENCE if it shares no trait with your Captain.
  - `1SHR19` USHAAN-TOR — FORCE: the opponent picks which Duty Officer to dismiss.
  - `1SHR20` TALAS — the dismissal targets an opponent's VULCAN, TELLARITE or ROMULAN card: you pick,
    not FORCEd; the opponent's Captain is never a candidate (ruling 042 — Sela is ROMULAN).
  - `1SHR21` TARAH, `1SHR23` ANDORIA, `1SHR24` PLASMA RIFLES — as printed.
- **Keyed on:** STCC `1SHR*/24` (errata `shran-ambassador-thoris`); `rules/06` §6.3.1.

## 021 — Crew board data shape (todo/13 boards are not cards)

- **Date:** todo/13 Phase A · **File:** `src/data/boards.ts`,
  `src/data/cards/boards/{picard,sisko,sela,shran,burnham,koloth}.json`,
  `src/data/catalog.ts`
- **Ruling:** Boards live in a dedicated `BoardArraySchema` (`src/data/boards.ts`)
  that **reuses `PredicateSchema`/`EffectSchema`** (exported from `schema.ts`) so
  mission goal/reward trees round-trip under the exact card-effect grammar. Per
  todo/13 each side = `{ deck, side, tracks, missions }`; `loadCatalog()`
  parses `src/data/cards/boards/*.json` (excluded from card defs) into
  `CardCatalog.boards` keyed by deck, flattening missions into vp-less
  `MissionState`. Chose **one file per deck** (`boards/picard.json`, …) over the
  todo/13 prose's single `crew-boards.json` so each Phase-B agent owns their
  deck's file without merge conflicts. Concretely: 3 tracks
  (RESEARCH/INFLUENCE/MILITARY) with their multiplier glyphs;
  BASIC side = 1 mission `vp: 0`; ADVANCED side = 3 missions with printed VP.
  (The placeholder glyphs 4/8/12 → ×2/×3/×4 and the invented/placeholder
  missions were replaced by the real boards — see 045.)
  Mission goal/reward trees are **deep-cloned per mission** on load — shared
  references between two missions would be a serialisation cycle for
  `assertSerialisable`. The boards also demand the `setupMissions` fix (018).
- **Keyed on:** todo/13 crew boards; `rules/07` §7.1.4 (highest-reached
  multiplier) / §7.4.1; `docs/data-model.md` §1.

## 035 — Sisko batch: interpretations (refreshed against STCC)

- **Date:** todo/13 Phase B, refreshed in the Sisko/Burnham STCC pass · **File:**
  `src/data/cards/crew/sisko.json` (25 cards)
- **Ruling:** every Sisko card follows the STCC text (errata included). Modelling notes:
  - `1SIS01` BENJAMIN SISKO: REACTION `LOCATION_CONTROLLED` (own) → 2 {DIL}; the `[action]`
    ACTIVATION sends to `LOCATIONS` filtered STARFLEET/STARBASE (Neutral Zone included).
  - `1SIS03` DEEP SPACE 9: "recall a card beamed here" is `{ k: 'BEAMED_TO', host: 'THIS' }`;
    "cannot be warped" is the `DS9_NO_WARP` modifier (`cannotBeWarped`), so no generic WARP
    (1SIS20, 1SIS21, commons) ever offers it.
  - `1SIS04` ORB OF PROPHECY AND CHANGE: cost 3 {DIL} + 2 {LAT}; "Refresh a BAJORAN to draw" is
    `COST_REFRESH`; the `[action]` enlist is `ENLIST_DEVELOPMENT discount` 1 {DIL} + 1 {LAT}.
  - `1SIS05` ORB OF THE EMISSARY: `cannotBePlayed`, no operations.
  - `1SIS06` SELF-REPLICATING MINES, `1SIS13` MILES O'BRIEN: "draw two cards and discard one of
    them" = `DRAW bind [a, b]` + `DISCARD onlyBound [a, b]`. The Mines' REACTION is
    `SPECIALTY_ADVANCED seat OPPONENT specialties [INFLUENCE, MILITARY]` → recall THIS; the
    PASSIVE is a `WOULD_BE_ATTACKED` window (`IGNORE_ATTACK` + log THIS; ruling 040).
  - `1SIS08` JULIAN BASHIR: the free play binds, "If you do" is `DID`; "choose 2 of the
    following" is `CHOOSE_ONE count 2` (different options). Same for `1SIS09` GARAK.
  - `1SIS10` WORF: "dismiss this card to ignore the negative effect" = `COST_DISMISS target THIS`
    in a `WOULD_BE_ATTACKED` REACTION.
  - `1SIS11` STRANGE NEW WORLDS is the 1PIC18/1BUR18 tree (a SHIP beamed to the Location
    counts as "there"): the log of the selected Location (and the research) happens whether or
    not the Encounter look did.
  - `1SIS12` PEOPLE OF BAJOR: the first send `bind`s its Location and the optional 2 {LAT}
    send is `bound` to it ("the same LOCATION"), so only a Location you can actually send to
    is ever picked.
  - `1SIS13` MILES O'BRIEN: `DRAW_FROM_DISCARD bind` → `FREE_PLAY bound` — the SHIP drawn from
    the Discard pile is the one free played (never another SHIP in hand); `cannotBePromoted`.
  - `1SIS14` ODO: DUPLICATE a PERSON/CARGO PLAY from the Market (rulebook §7 example); the log
    binds and "if the logged card is SHADY" is `BOUND_IS`.
  - `1SIS15` U.S.S. DEFIANT: the force is gated on an **opponent** SHIP at the Defiant's
    Location (`withShip` + `shipSeat OPPONENT` + `atThisShip`).
  - `1SIS20` SET A COURSE: `WARP count UP_TO 2` (different ships).
  - `1SIS21` THE WORMHOLE: CONTROL `ARRANGE_DECK LOCATION 3`.
  - `1SIS22` JADZIA DAX: `ADVANCE_SPECIALTY LOWEST`; REACTION `WOULD_GAIN_CARD` →
    `REPLACE_GAIN scan 2`.
  - `1SIS23` KIRA NERYS: `PROMOTE from STAGING target THIS`; the dismissal is "of your choice"
    over the opponent's in-play CARDASSIAN/DOMINION (never a Captain, ruling 042).
  - `1SIS24` QUARK: REACTION `OPERATION_RESOLVED paid LAT`.
  - `1SIS25` U.S.S. RIO GRANDE: "recall a card beamed to a SHIP" = `BEAMED_TO_SHIP`.
- **Keyed on:** STCC `1SIS*/25`; rulebook §7 (DUPLICATE); rulings 040–042; test
  `sisko-burnham-fixes.test.ts`.

## 036 — Sela batch: interpretations (refreshed against STCC)

- **Date:** todo/13 Phase B, refreshed in the Koloth/Sela STCC pass · **File:**
  `src/data/cards/crew/sela.json`
- **Ruling:** every Sela card follows the STCC text. Modelling notes:
  - `1SEL01` SELA: REACTION `ATTACK_MADE` → 1 {DIL} or 1 {LAT}; ENDGAME 1 VP per owned ATTACK
    card without ROMULAN/REMAN.
  - `1SEL02/03/17/23` I.R.W. ships: the Away Team send that disregards opponent SHIPs
    targets `LOCATIONS` (Neutral Zone included) with `ignoreBlocking`.
  - `1SEL03` VALDORE ATTACK: "force your opponent to dismiss a SHIP" is a FORCE'd DISMISS over
    `FLEET` seat 0 / seat `SELF`. Inside FORCE the seats flip, so it is **their** deployed ship.
  - `1SEL05` PROCONSUL NERAL: FIND searches hand too; the promote is `PROMOTE target THIS`.
  - `1SEL06` SHINZON RESUPPLY: the log is mandatory ("if able"); +1 MILITARY only if it
    happened (`bind` + `DID`).
  - `1SEL07` SCIMITAR: FIND `bind` → DESTROY the found card → BEAM to Remus `bind` → `IF DID`
    both → DEPLOY. The [mil9] take-control has **no** secured requirement (the text has none;
    compare 1KOL08 KOR, which says "secured"). Taking control of a neutral Location dismisses
    the Ships there, the Scimitar included (rules/08 → take control).
  - `1SEL14` TOMALAK: "If any were dismissed" is checked after the dismissals: `LET` the
    STARFLEET Duty Officers, dismiss each, then force the discard only if one of them reached
    the Discard pile (an ignored dismissal — 1BUR15 BOOK'S SHIP — does not count).
  - `1SEL18` GENERAL MOVAR RESUPPLY: `MIN(PER 2 of SHADY in play, 4)` cards.
  - `1SEL21` INFILTRATE: `WARP { count: UP_TO 3 }` — different ships.
  - `1SEL22` UTILIZE: `SKILL_ICONS CHOSEN` — only the chosen track's Skill icons.
  - `1SEL24` REMANS: the second option is `OPPONENT { MAY { DRAW } }` ("may draw").
- **Keyed on:** STCC `1SEL*/24`; `rules/08` → take control, secured; ruling 042.

## 037 — Burnham batch: interpretations and the INERT DILITHIUM Status (refreshed against STCC)

- **Date:** todo/13 Phase B, refreshed in the Sisko/Burnham STCC pass · **File:**
  `src/data/cards/crew/burnham.json` (26 cards)
- **Ruling:** every Burnham card follows the STCC text. Modelling notes:
  - `1BUR02` INERT DILITHIUM is the only STATUS card. `attachSetupModifiers`
    (`src/engine/setup.ts`) attaches its `INERT_DILITHIUM` layer at setup; the layer carries
    every rule of rules/11 §11.6.1 (hand size +1, operation-gained {DIL} parks on the card, no
    {GLO}-as-{DIL}, steals tap the parked pile first, the Clean-up 2-{DIL} placement). The other
    two PASSIVEs are describe-only ids. Logging the Status detaches the layer.
  - **Recrystallize is a move, not an operation gain** (rules/08, rules/11 §11.6.1 #6):
    `RECRYSTALLIZE` adds the parked {DIL} to the pool with `via: 'OTHER'`, so the Inert Dilithium redirect
    (which only catches operation gains) never parks it straight back. Before this pass every
    recrystallize (1BUR07, 1BUR10, 1BUR22, 1BUR24) was a silent no-op under the layer.
  - `1BUR01` MICHAEL BURNHAM: the Clean-up PASSIVE is `BURNHAM_CLEANUP`; ACTIVATION spend 3
    {DIL} → gain an ALLY and 1 {GLO}.
  - `1BUR03` U.S.S. DISCOVERY-A: "Your {DIL} cannot be stolen" = `DISCOVERY_A_NO_STEAL`
    (`protectsFromSteal`).
  - `1BUR04` U.S.S. FEDERATION: the dev cost is an `IF` (free with ADMIRAL VANCE as Duty
    Officer, else 6 {DIL}); ENDGAME counts owned cards with an INFLUENCE/MILITARY **Focus**
    icon (`filter.focus`).
  - `1BUR06` ADIRA TAL: dev cost 2 {DIL} + `COST_REQUIRE` RESEARCH 7; the log is `COST_LOG from`
    hand/Discard; REACTION `REPLACE_GAIN scan 2` + 1 {GLO}; the extra Duty Officer slot is
    `ADIRA_TAL_DUTY` (SCIENTIST/ENGINEER).
  - `1BUR07` JETT RENO: "gain a CARGO/SHIP to your Discard pile" = `GAIN_CARD to [DISCARD]`.
  - `1BUR08` DOCTOR KOVICH: "Find an ENCOUNTER and log it" = `COST_LOG ENCOUNTER` from hand,
    Discard, Draw and Reserve (the searched-deck shuffle is not modelled); `KOVICH_HAND` counts
    the tracks at 5+.
  - `1BUR10` THETA ZETA: CONTROL `RECRYSTALLIZE ALL` (every parked {DIL}), log INERT DILITHIUM,
    gain 4 {GLO}; "You cannot send AWAY TEAMs here" is `THETA_ZETA_BLOCK`; ENDGAME `PER 2`
    {DIL}.
  - `1BUR11` TRANCE WORM: cost 3 {LAT}, `[action]`; the gained card is `bind`-logged from the
    Draw deck top / Discard pile; the Glory is `COMPARE TRAIT_COUNT ≥ 3`.
  - `1BUR12` NI'VAR: `REMOVE_STARDATE_GLORY 1`; the variable skills are `variableSkill.counts`.
  - `1BUR13` HUGH CULBER: free play `bind` + `DID` for the Glory.
  - `1BUR14` GRUDGE: the two-card beam onto Book's ship (itself plus one more) = beam GRUDGE from the
    Staging Area (`bind`), then, if it went, one more card from hand — never two other cards.
  - `1BUR15` BOOK'S SHIP: recall from `{ k: 'BEAMED_TO', host: 'THIS' }`; the REACTION is the
    `DISMISS_DUTY_OFFICER` window (`IGNORE_ATTACK scope EFFECT`).
  - `1BUR16` INSPIRE, `1BUR19` MAXIMUM WARP, `1BUR26` SUBSPACE PHENOMENON (both ops): "discard
    one of the drawn cards" = `DRAW bind` + `DISCARD onlyBound`. SUBSPACE's second op gates on
    `TIME_TRAVEL`.
  - `1BUR17` RECOVER: "gain a SHIP from the Junk" = `GAIN_CARD onlyJunk`.
  - `1BUR20` KEYLA DETMER: `WARP bind` → `SEND bound` ("the LOCATION you warped to"); her two
    wild skills are `SKILL_ANY` icons.
  - `1BUR21` JOANN OWOSEKUN: "the U.S.S. Discovery" is `U.S.S. DISCOVERY-A` (the only Discovery
    in the corpus): send via `withShip { names }`, beam to it, `DID` both → 1 {GLO}; the
    ACTIVATION refreshes the exhausted SHIP's own Location (`COST_EXHAUST bind` + `atBound`).
  - `1BUR24` PAUL STAMETS: the ACTIVATION dismisses DISCOVERY-A and Stamets as costs.
- **Keyed on:** STCC `1BUR*/26`; rules/11 §11.6.1; `src/engine/modifiers.ts`; rulings 040–042;
  test `sisko-burnham-fixes.test.ts`.

## 038 — REPEAT must scope choice answers per iteration (loops are not siblings)

- **Date:** bug report — playing `1PIC22/24` SET A COURSE sent an away team that
  "didn't count". · **File:** `src/engine/resolver/primitives/repeat.ts`
- **Ruling:** `suspend()` writes `ctx.bindings[key] = id` in place and
  `storeSelection()` rewrites a resolved answer onto every stack frame sharing
  the publishing `ctx` object — the deliberately-shared context that makes an
  answer visible to _sibling_ steps after a choice resumes. `REPEAT` pushed every
  body iteration with that same `ctx`, so a choice answered in iteration 1 was
  treated as answered/`bound` in iterations 2..N: the destination was silently
  reused and the per-iteration cost (e.g. `COST_DISCARD`) replayed the stored
  card instead of asking again — one discard paid for three away-team sends.
  A loop is not a sibling: each iteration now inherits a copy of the incoming
  bindings so pre-loop answers stay visible, while anything written mid-iteration
  stays scoped to that iteration (`iterationCtx`). Matches the existing design
  where `LET`/`FOR_EACH` copy deliberately to scope loop bindings.
- **Keyed on:** `src/engine/resolver/runtime.ts` (`suspend`/`storeSelection`);
  `1PIC22/24` + `1SIS20/25` REPEAT(UP_TO 3)(discard PERSON → send away team);
  regression tests in `src/engine/resolver/primitives/repeat.test.ts` and the
  real-card SET A COURSE test in `src/engine/picard-shran-game.test.ts`.

## 039 — "After you gain" is the card owner's own gain (CARD_GAINED seat scoping)

- **Date:** bug report — Picard's Captain REACTION was offered when the
  **opponent** gained an ALLY. · **File:** `src/engine/resolver/triggers.ts`,
  `src/data/cards/crew/picard.json`
- **Ruling:** `1PIC01` JEAN-LUC PICARD reads "REACTION: After **you** gain an
  ALLY, …" — only the Picard player's own ALLY gains trigger it (amends 019,
  which wrote "after you gain an ALLY" but whose encoding had no seat scope).
  `matchesTrigger` previously ignored `event.seat` for `CARD_GAINED`, so any
  player's gain matched every in-play `CARD_GAINED` REACTION/PASSIVE. The
  `CARD_GAINED` trigger now carries `seat: 'SELF' | 'OPPONENT' | 'ANY'`,
  **defaulting to `SELF`** — the rulebook's "after gaining X" wording is always
  the card owner's gain; an opponent-facing trigger must say so with
  `seat: 'OPPONENT'` (the same scoping on `SPECIALTY_ADVANCED`: "after your
  opponent gains INFLUENCE/MILITARY" — `1SIS06`). The gainer is the effect's
  actor (`GAIN_CARD`/`SCAN_N` emit `{ seat: ctx.actor }`), not the card's
  previous owner. Picard's trigger states `"seat": "SELF"` explicitly and
  `describe()` renders it "After you gain an ALLY".
- **Keyed on:** `1PIC01/24` record text; `1SIS06` (OPPONENT, specialty gain); regression test
  in `src/engine/todo09.test.ts` ("fires on its owner's gain only").

## 040 — "When you would be attacked": what counts, and when the window opens

- **Files:** `src/engine/resolver/replacement.ts`, `stack.ts`, `primitives/dismiss.ts`
- **Ruling:** rules/03 §3.5.3 only says an ATTACK operation "negatively affects your opponent".
  We read **being attacked** as: an opponent's ATTACK operation is about to apply an effect to you
  or your things — a FORCE/OPPONENT body (you act), a STEAL, a discard from your hand or deck, the
  removal of your AWAY TEAM, or a dismiss/log/recall/destroy/exhaust/return that can hit a card you
  own (a PAY_THEN whose cost does so — 1CAR09 — counts as a whole). The window opens **at the first
  such effect that could actually apply**, not when the attack is announced: 1SIS15 U.S.S. DEFIANT
  with no opponent SHIP at its Location, or a forced discard from an empty hand, attacks nobody, so
  1SIS10 WORF is not dismissed for nothing. "Ignore the negative effect" skips **every remaining
  negative effect of that attack**; the attacker's own benefits (draws, Glory, deploys) still
  resolve. Effect-specific reactions — 1BUR15 "when an attack would dismiss your Duty Officer",
  1CAR11 (an attack forcing you to pull back AWAY TEAMs) — are asked per such effect
  and ignore only that effect (1BUR15's check runs after the dismissed card is picked). 1SIS06
  SELF-REPLICATING MINES is a PASSIVE, so it always fires first and nothing else is offered. The
  generic window is asked once per attack; declining it lets the whole attack through. Amends 010
  ("no ignore-an-attack-effect node").
- **Keyed on:** STCC 1SIS06, 1SIS10, 1PER19, 1BUR15, 1CAR11 (errata 2CAR14: op 1 has no [action]);
  tests in `src/engine/replacements.test.ts`.

## 041 — Replacements, restrictions and hooks added with the box-1 gap pass

- **Ruling:**
  - Swapping a card gain for a scan of 2 in that suit (1SIS22, 1BUR06) is offered after
    the GAIN_CARD picked its card (so "the same suit" is that card's suit) and only for `gain`
    (never for a scan — no replacement loop). The scan keeps the gain's `bind`, so "the gained card"
    (1BUR11 TRANCE WORM) names what was scanned.
  - "Before scoring" (1PER22 SU'KAL) runs only for the Resolution's final scoring; a Burn is decided
    by INCIDENT counts and has no scoring step.
  - 1ENC07 SHA KA REE "considered a LOCATION for all purposes": it matches the LOCATION suit
    everywhere (it is still an ENCOUNTER), and DEPLOY puts it into the Location area as a controlled
    LOCATION (LOCATION_CONTROLLED fires — 1SIS01 Sisko gains 2 {DIL}); "beam a SHIP here" beams to
    it there.
  - A forced/plain `DISCARD` of N cards now discards `min(N, hand)` — it used to accept a single
    card for "discard 2 cards". `COST_PUT` to the Draw deck now puts the card on **top**
    (as the deck-placement costs intend); it used to go to the bottom.
  - 1CAR16 UNSTABLE WORMHOLE is two PLAY operations (STCC): the look-and-rearrange + draw, and the
    [action] INF 6 "spend 3 {DIL} to take control of the top LOCATION, junk, destroy this card".
- **Keyed on:** STCC texts; `docs/effect-dsl.md` §4 "Replacement effects", §5, §6.

## 042 — A Captain (or Status) card can never be dismissed

- **Date:** Picard/Shran STCC pass · **File:** `src/engine/resolver/primitives/dismiss.ts`,
  `src/engine/resolver/runtime.ts` (`isCaptainZone`, `dismissibleCandidates`)
- **Question:** 1SHR20 TALAS dismisses an opponent's VULCAN, TELLARITE or ROMULAN card, chosen by you —
  can it dismiss Sela, a ROMULAN Captain? The Captain is "in play" (rules/08 → in play).
- **Ruling:** no. The rulebook's dismiss entry (rules/08 → dismiss) only lists Staging
  cards and Locations as exempt, and gives the reason for Locations: "since most of them cannot
  enter your deck". A Captain (and a Status card) can never enter a deck either, and it carries
  your Captain's Log and Away Team pool, so dismissing it to the Discard pile has no meaning.
  A `DISMISS` query and `COST_DISMISS` therefore never offer a card in the `CAPTAIN` or `STATUS`
  zone. No box-1 card instructs its own Captain to be dismissed.
- **Keyed on:** rulebook "Dismiss"; `rules/08` → dismiss; `rules/05` §5.1 (CAPTAIN is not a deck
  card); test `picard-shran-fixes.test.ts`.

## 043 — Koloth batch, and "do A to do B" in the middle of an operation

- **Date:** Koloth/Sela STCC pass · **File:** `src/data/cards/crew/koloth.json`
- **Ruling:** a "do A to do B" sentence inside an operation is a **mandatory cost**
  (`PAY_THEN` without `MAY`, no `IF` guard): if A cannot be paid the operation cannot be resolved,
  so the card cannot be played (rules/12 §12.1, §12.2). This matches every other mid-operation
  cost in the corpus (1SEL08, 1SEL14, 1BUR11, 1CAR05).
  - `1KOL04` SWORD OF KAHLESS: "Dismiss a KLINGON Duty Officer to gain 4 {GLO}" — playable only
    with a KLINGON Duty Officer (it used to be an optional, guarded dismissal).
  - `1KOL17` GOOD DAY TO DIE: its cost (log one deployed SHIP, dismiss a second one) buys a peek
    at ENCOUNTERs — playable only with two deployed SHIPs (it used to be skipped).
  - `1KOL03` PROTOTYPE CLOAK: "2 or more SHIP deployed" counts the opponent's **Fleet**, not their
    Staging Area; the forced dismissal picks one of their deployed ships. The REACTION is
    `CARD_DEPLOYED` (own deploys only) + `TEMP_CLOAK`.
  - `1KOL13` RURA PENTHE: RESUPPLY counts `{ k: 'BEAMED_TO', host: 'THIS' }` PERSONs.
  - `1KOL23` KRELL: "a WEAPON in play (excluding your CAPTAIN)" counts every in-play zone except
    the Captain, beamed cards included.
- **Keyed on:** STCC `1KOL*/24` (errata `koloth-prototype-cloak`, `koloth-qonos`, wording only);
  rules/12 §12.1–12.2; test `koloth-sela-fixes.test.ts`.

## 044 — Box-1 common cards: STCC re-verification pass

- **Files:** `src/data/cards/common/{person,cargo,ship,ally,location,encounter,incident}.json`;
  engine: `find.ts`, `costBeam.ts`, `beam.ts`, `log.ts`, `resolveQuery.ts` (SUM, `exceptThis`);
  tests `src/engine/common-stcc-pass.test.ts`, `resolver/targeting.test.ts`.
- **Source:** every box-1 common card (stardates excluded) was re-read against the STCC text
  (box2 "updated" reprints win: 2CAR02, 2CAR11, 2CAR14, 2LOC16) operation by operation.
  Supersedes 009/010/012. Box-2-only mechanics (Borg regenerate/assimilate/collective on 1CAR02
  op 2 and 1SHI02) and cross-set trait errata (Orb TRANSCENDENT, Phlox NX-01, Kazon Raider KAZON,
  Solum VAU'NAKAT) stay unmodelled; the Lirpa "(max 5)" cross-set errata **is** applied because it
  is harmless in box 1.
- **Rulings / interpretations:**
  - FIND shuffles the Draw and/or Reserve deck it searched afterwards (rules/08 find). A FIND
    that matches nothing is skipped like any unresolvable benefit (no shuffle).
  - `1CAR04` FERENGI WINE "1 {LAT} for each FERENGI **and each** BUSINESS (max 5)": the two counts
    are **added** (`SUM`), so a FERENGI BUSINESS card counts twice. The designers write
    "FERENGI/BUSINESS" when they mean either-or; "and each" enumerates two separate counts. The Wine
    itself (FERENGI, in Staging) counts. "If you gained at least 3 this way" compares the capped sum.
  - `1ALL13` THOLIANS "Gain 1 {LAT} and 2 {DIL} for each controlled LOCATION": "for each" scales
    **both** gains (1 {LAT} + 2 {DIL} per Location). A flat {LAT} would have been written as its own
    sentence.
  - `1LOC14` MEMORY ALPHA "You may log a card": an unqualified "log" follows the engine convention
    (`COST_LOG` default) — a card **you have in play** (Staging, Fleet, Duty Officer, Location area,
    beamed cards), never the Captain/Status card. Box-1 texts name the hand/Discard pile explicitly
    whenever that is meant (1PER01, 1PER05, 1ENC08, 1LOC01). **Low confidence:** some box-3 texts
    add "(from your hand)" as a reminder (3PIK01, 3PIK17), which hints that the designers may read
    an unqualified log as a hand card. This also affects 1CAR07 HORTA and 1LOC19 VEREX III, which
    keep the in-play convention. Revisit all three together if an official ruling appears.
  - `1LOC01` AMARGOSA OBSERVATORY SPECIAL (STCC FAQ "amargosa-warp"): when this card is logged,
    **before** its Ships are dismissed, pick one other LOCATION (controlled or neutral, never
    Amargosa) and warp every deployed SHIP there, then draw 2. Modelled as a `beforeLeaving`
    CARD_LOGGED SPECIAL: a WARP that binds the destination, then a FOR_EACH that warps each
    remaining ship to that bound destination (ships already there stay put). A `COST_LOG` of the
    Location still runs it after the move.
  - `1CAR05` FORCED SINGULARITY / `1INC05` SUBSPACE PHENOMENON "draw 2 cards and put/discard **one of
    them**": only the two drawn cards are offered (`DRAW bind` list + `PUT_ON_DECK_TOP`/`DISCARD`
    `bound`).
  - `1CAR06` HOLOSUITE op 2 costs an [action] (STCC); `1CAR13` "dismiss a **deployed** SHIP" = Fleet only.
  - `1CAR08` LIRPA / `1ENC04` ICONIAN GATEWAY "(excluding this card)" exclude only the resolving card
    (`exceptThis`); another copy in play counts.
  - `1CAR14` TRIBBLES "If any were dismissed": decided by the dismissed Duty Officers reaching the
    Discard pile (1SEL14 pattern), so an ignored dismissal also skips the forced discard.
  - `1PER13` LURSA: beaming the card onto a SHIP, which pays for an Away Team send there, is a cost
    (`COST_BEAM target THIS`); the player chooses the ship (COST_BEAM now asks when several hosts
    are legal, as BEAM does) and the Away Team goes to that ship's Location.
  - `1PER15` MIROK "If they do, gain 1 {GLO}" is bound to the forced log actually happening.
  - `1PER18` PHLOX's self-beam onto a deployed SHIP (when one exists) is mandatory (`BEAM target THIS`).
  - `1ALL10` LETHEANS "Dismiss an opponent Duty Officer": **you** choose (no FORCE).
  - `1LOC04` BA'KU CONTROL "beam any number of PERSON": no cap (REPEAT up to every PERSON in hand,
    Discard pile and already here).
  - `1SHI13`: ship token spelled "Xindi-Reptilian Battleship" (STCC typo errata).
- **Keyed on:** STCC box1/box2 texts, `vendor/stcc/errata.json`, `vendor/stcc/faq.json`; rules/08
  find/log/beam.

## 045 — The real box-1 crew boards: 18 STCC missions and per-side multipliers

- **Files:** `src/data/cards/boards/{picard,koloth,shran,sisko,sela,burnham}.json`
  (generated from the STCC mission records and the board transcription), `src/data/boards.ts`,
  `src/engine/scoring.ts`, `src/engine/setup.ts`, `src/engine/resolver/primitives/completeMission.ts`,
  `src/engine/queries/{resolveQuery,traits}.ts`, `enlistDevelopment.ts`, `gainResource.ts`,
  `tools/crosscheck-stcc.ts`; test `src/engine/crew-missions.test.ts`.
- **Sources:** mission names, goals, rewards and VP = STCC `1XXX/M1..M3` (2nd-print errata
  "DISCOVERY" → ENCOUNTER already in 1PIC/M3 and 1BUR/M1). STCC has no board data, so the
  **multiplier glyphs** and **which mission the Basic side prints** come from the STCC-hosted
  photos of the 12 board sides (`img/guides/<crew>/<crew>-board-{basic,advanced}.jpg`). Every
  Basic side prints mission 1 (0 VP) and ×1 at step 0; every Advanced side prints M1..M3 with
  the STCC VP and no glyph at step 0.
- **Rulings / interpretations:**
  - **Advanced tracks score ×0 below the first glyph.** rules/07 §7.1.4 multiplies by the
    highest glyph _reached_; the Advanced side prints none at step 0, so a Focus card on a
    track that never reached its first glyph scores 0 (the Basic side prints ×1 there). The
    engine no longer defaults to ×1.
  - **Picard Advanced Influence tops at ×5** (step 15), per the Picard strategy guide (user
    decision). Both the STCC photo and the board scan in the user's Tabletop Simulator mod
    (workshop 3474332258) read **×6** there, like the "one lower than Basic" pattern; the data
    keeps ×5 deliberately. Koloth Advanced Influence (same track shape) is ×6 on both the photo
    and the TTS scan — confirmed, kept at ×6.
  - **TTS cross-check (2026-09-28):** the TTS mod scans 10 of the 12 sides (all but Sisko
    Advanced and Burnham Advanced). Every glyph on those 10 sides matches the data, except the
    Picard Advanced Influence ×5 decision above.
  - **SAME_SHIP requirements use distinct cards.** "3 ALLY on the same SHIP" needs three ALLY
    cards on one ship; "a ROMULAN on a SHIP that has KLINGON" / "a KLINGON on the same SHIP that
    has CLOAK" need two different cards (a Romulan-Klingon alone does not do). The SHIP itself
    may fill a requirement (a KLINGON ship with a beamed ROMULAN meets 1KOL/M2). "3 different of
    VULCAN / … / COMMUNICATION" (1SHR/M2): three cards standing for three different listed
    traits; a card with two listed traits still counts once. "2 INCIDENT, a SCIENTIST and a
    KELPIEN" (1BUR/M1): four different cards — a KELPIEN SCIENTIST is only one of them.
  - **Separate clauses outside "on the same SHIP" count independently** ("2 different species,
    2 WEAPON and 1 SCIENTIST in play", 1KOL/M3): one card may serve several clauses, as
    printed ("have X. Have Y.").
  - **ALIEN / TRANSCENDENT per card only where printed.** 1PIC/M3 treating every ALIEN and
    every TRANSCENDENT card as its own species is a mission clause (`eachDistinct`), not a general
    rule: elsewhere two ALIENs are one species. "(excluding cards with X)" removes every card
    bearing X before the species matching; an exclusion never compels a WILDCARD, so a
    WILDCARD still counts as some other species.
  - **Only the contributing beamed cards are dismissed** (rules/07 §7.2.1 #2), for every goal
    form including AND goals: the smallest sets of beamed cards the goal cannot do without; a
    goal met without any beamed card (e.g. the KLINGON is the ship itself) dismisses nothing
    for that clause. Several equally small sets → the player chooses (CHOOSE_WITNESS).
  - "Deployed SHIP" = a SHIP in your Fleet; "a SHIP at _Bajor_" (1SIS/M2) = one of your SHIP
    tokens at Bajor wherever Bajor is (controlled by either player or neutral); "refresh
    _Bajor_" likewise.
  - **1KOL/M3 "Attack Reward"**: the reward resolves as an ATTACK on the opponent (`isAttack`
    on the mission) — the victim's "would be attacked" windows and ATTACKED reactions apply.
  - **1SIS/M1** "reducing the cost by 1 {DIL} or 1 {LAT} for each STARBASE": one point per
    STARBASE in play, each lowering {DIL} or {LAT}; the player picks the split when it matters.
  - **1SEL/M3** "Gain 2 {GLO} from the supply (not the Stardate card) per KLINGON in play" is a
    supply gain (`fromSupply`) — it neither drains nor hands over the Stardate card. The KLINGON
    count is taken before the reward's own dismissals. "Dismiss one CLOAK" may pick the ship
    itself (its beamed cards follow it).
  - Rewards "You may free play an INCIDENT to gain …" (1SHR/M3, 1BUR/M3) pay out only if an
    INCIDENT was actually played (`DID` gate); 1SEL/M2's free play has no payout.
  - The FAQ `action-cap` (Action tokens capped at 3 during Clean-up) for 1PIC/M2 / 1SHR/M1's
    "gain an action" is enforced by the Clean-up step, not by the mission.
- **Crosscheck:** board missions carry `cardId` (`1PIC/M1` …); `tools/crosscheck-stcc.ts`
  counts them as implemented and compares name + `vp` (placeholders never count). The solo-only
  Directives (1DIR01/02, 2DIR01/02; STCC position "Solo Campaign"/"Solo Challenge") are listed
  as out of scope until the Solo/Bot mode (todo/15).
- **Keyed on:** STCC `1PIC/M1`…`1BUR/M3`; rules/07 §7.1.4, §7.2, §7.4.1; rules/12 §12.12, §12.26.

## 046 — Cross-set updates: a later box's "updated" † reprint supersedes the box-1 card

- **Source:** the STCC errata's live "Cross-set update" entries (Black Alert) change box-1 cards
  to match their reprints in _To Boldly Go_. Box 2 prints those reprints as `updated` variants
  marked `†` (`2PER14/26†` PHLOX).
- **Ruling:** `buildStccIndex` (`src/data/stcc.ts`) replaces the box-1 record's traits, text and
  scan with the † reprint's (matched by name and suit). The card keeps its box-1 number and name,
  so the printed text shown in the app is the corrected text and `crosscheck-stcc` checks our data
  against it.
- **Applied:** 1PER18 PHLOX gains NX-01; 1SHI06 KAZON RAIDER gains KAZON; 1CAR10 ORB OF TIME gains
  TRANSCENDENT; 1LOC17 SOLUM's ALIEN becomes VAU'NAKAT (`VAU_NAKAT`; `toTraitId` drops
  apostrophes). 1CAR08 LIRPA's "max 5" was already modelled.
- **Keyed on:** STCC errata entries `phlox`, `kazon-raider`, `orb-of-time`, `solum`, `lirpa`;
  tests in `src/data/stcc.test.ts`.

## 047 — Reserved Borg keywords: drone, collective value and assimilate are inert

- **Source:** rules/08 (drone, assimilate) and rules/12 §12.30 — the Borg keywords "currently
  have no known meanings or effects" in this box. 1CAR02's errata (Minor Errata, live) rewords its
  second Play as a {COL6} Play that regenerates one drone and may move a drone to a LOCATION.
- **Ruling:** `DRONE` and `ASSIMILATE` resolve as logged no-ops; `COLLECTIVE_AT_LEAST` is always
  false (every collective value is 0). 1CAR02's second Play is gated on 6+ collective value only
  (no BORG-captain check, per the errata), so it never does anything here. 1SHI02 with a BORG
  captain assimilates the gained PERSON _instead_ of logging it, so the card stays where the gain
  put it (top of deck or Discard pile).
- **Keyed on:** STCC errata `borg-spatial-trajector`; tests in
  `src/engine/resolver/borg-inert.test.ts`.

## 048 — Taking a REACTION exhausts its card; Clean-up Glory leaves the Stardate after placement

- **Reactions (rules/03 §3.5.5 table; rules/08 `REACTION operations`: "Resolving a REACTION
  exhausts its card"):** the reaction window exhausts each chosen card as the answer is applied, in
  the chosen order, so a card with two REACTIONs answers only once until refreshed. Declining
  exhausts nothing. Refresh (§3.6.7) covers only _your_ exhausted cards, so a REACTION taken on the
  opponent's turn keeps its card exhausted through its owner's next turn (its ACTIVATION is
  unavailable then) — the literal reading; play-test or confirm against a FAQ.
- **Glory placement (§3.6.3):** the Glory token leaves the Stardate card (and an emptying handoff,
  §3.6.4, runs) only once the Market card has been chosen — a new CLEANUP sub-step `GLORY_TAKEN`
  after the placement — so the Stardate does not change while the player is still choosing.
- **Keyed on:** tests in `src/engine/engine-bugs.test.ts` and `src/engine/m1-exit.test.ts`.

## 049 — Gained actions: this turn only, capped to 3 at Clean-up REFRESH; KORAX counts them first

- **Rule text:** rules/03 §3.5.1 "3 actions per turn (more if an effect grants extras)",
  "Unused actions are lost. Some CLEAN-UP operations reward unused actions"; §3.6.7 Refresh "Reset
  your Action tokens to 3 … Return any excess tokens gained this turn to the supply"; STCC FAQ
  `action-cap` (attached to 1PIC/M2, 1SHR/M1 and every box-1 "gain an [action]" card): tokens
  above 3 are shed during Clean-Up.
- **Ruling:** every "gain an [action]" in the data (box 1: 1PER07, 1PER21, 1CAR11, 1CAR12,
  1ALL08, 1ENC01, 1ENC03, 1INC01, 1KOL11, 1SEL13, 1LOC04, 1LOC07, 1LOC12, 1SHI09, 1BUR05, 1BUR25,
  1SEL05, 1PIC/M2, 1SHR/M1) is a one-shot `GAIN_ACTION` that raises the budget immediately, with
  no in-turn ceiling — it pays for an `[action]` operation the same turn. No card grants a
  standing extra action. The cap is applied only in the REFRESH sub-step (the last Clean-up
  sub-step), which sets the budget to exactly 3.
- **Interpretation — cap timing:** the FAQ only names the Clean-Up step, without a
  sub-step; we keep it at REFRESH (where rules/03 puts the token reset) rather than at the start
  of Clean-up. So a CLEAN-UP operation that reads unspent actions (1KOL22 KORAX; box 2's Karzill
  VI) counts gained-but-unspent actions too — e.g. 4 unspent after 1SHR/M1 → 4 hand-size layers
  and 4 optional {GLO}. Revisit if a FAQ/errata caps before Clean-up operations.
- **Keyed on:** STCC FAQ `action-cap`; rules/03 §3.5.1, §3.6, §3.6.7; tests "gained actions: usable
  this turn, capped back to 3 at Clean-up REFRESH" in `src/engine/crew-missions.test.ts`.

## 050 — Stardate cards: the printed set SD01–SD32

- **Source:** STCC has no Stardate cards. The faces are transcribed from the card scans in the
  user's Tabletop Simulator mod (workshop 3474332258, the seven face-up Stardate decks under the
  "Stardate Cards" label; identical scans in 3456840406). They replace the earlier invented
  25-card two-player set.
- **Set:** SD01–SD05 "2-PLAYER" #1–#5, Glory 5 / 7 / 7 / 6 / 5 (30, matching the rulebook p.12
  "refill the fourth with 6" example and the strategy site's "30 total Glory"); SD06–SD07
  "SOLO CADET PRACTICE" (5 / 5); SD08–SD32 five solo-vs-Bot sets (Ensign, Lieutenant,
  Commander, Captain, Admiral) that also print a Bot action count. The rulebook component list
  says 27 cards; the physical set has 32.
- **Effects:** "During the next player's Clean-up Step, wipe the Market (removing all tokens)" →
  `WIPE_MARKET`; "… and any neutral LOCATION with no tokens present" →
  `SEQ[WIPE_MARKET, WIPE_NEUTRAL_ZONE]` (on every #3, and on Cadet #1). "Trigger the end of the game" (every #5
  and Cadet #2) is the final card: the engine's handoff marks the Resolution when it empties
  (rules/03 §3.6.4) and the card is never handed over, so its CLEANUP op is `NOOP`. Some solo
  cards (#2/#4 Ensign and Lieutenant, #4 Commander) print no text → `NOOP`.
- **Interpretation — Cadet #1 timing:** the card says "At the beginning of your next Clean-up
  Step"; the engine resolves it in the STARDATE sub-step, after the Clean-up OPERATIONS sub-step.
  It only matters if a CLEAN-UP operation reads the Market or the Neutral Zone.
- **Solo data:** `modes: []` (always boxed) plus `StardateSpec.solo = {level, botActions}`; no
  Solo/Bot mode exists (todo/15).
- **Keyed on:** `src/data/stardate.ts`, `src/data/cards/common/stardate.json`; tests
  `src/data/catalog.test.ts` ("the 32 Stardate cards …"), `src/engine/endgame.test.ts`
  ("real 2-PLAYER Stardate track"), `src/engine/cadet-game.test.ts` (now on the real SD06/SD07).

## 051 — A returned INCIDENT scores for nobody

- **Question:** `return an INCIDENT` puts the card on the bottom of the Incident deck (rules/08),
  but the engine keeps its `owner` field until the next player takes it (`setOwner`). Final
  scoring's printed-VP step sums every owned card outside the Reserve deck and Development pile,
  so the −2 VP stayed charged to the player who returned it.
- **Interpretation:** a card back in a shared supply deck (Incident, Encounter, Market, Location
  deck, or a Market offer) is no longer "your card" for final scoring (rules/07 §7.4 counts your
  cards). The Burn count already only looks at hand, Discard, Draw deck and Log
  (rules/03 §3.1). Ownership itself is unchanged, so nothing else moves.
- **Keyed on:** `excludedFromScoring` in `src/engine/scoring.ts`; test "a returned INCIDENT in the
  Incident deck no longer scores for its old owner" in `src/engine/scoring.test.ts`.

## 052 — A Bot flip counts as playing the card

- **Question:** the solo rulebook has the Bot "resolve" Staging cards through its Automated
  Command (AC) rows and ignore their text. Does that count as playing them, e.g. for your
  REACTIONs to an opponent playing a card?
- **Interpretation:** yes. The rulebook's own examples say the Bot "plays" a LOCATION it flips
  (solo p.6). Each flipped card emits CARD_PLAYED for seat 1. A card resolved as a side effect
  (`rules/13` §13.8) or a LOCATION taken control of does not, because neither is played.
- **Keyed on:** `rules/13` §13.4, §13.6, §13.8.

## 053 — The Supplement deck is neither owned nor scored

- **Question:** the Bot scores "5 VP per ENDGAME operation it owns, whether or not the card was in
  play" (solo p.5). Does that include cards still in its Supplement deck?
- **Interpretation:** no. The Supplement is the Bot's Reserve deck plus Development pile, and those
  never score for a player (`rules/07` §7.4, `excludedFromScoring`). The Bot's cards in its deck,
  row, Staging Area, Discard pile, Log and Control Area all count. The same applies to printed VP.
- **Keyed on:** `rules/13` §13.13.3.

## 054 — The Bot's Dilithium and Latinum score together, 1 VP per 2

- **Question:** "1 VP for every 2 Dilithium/Latinum" (solo p.5). Is that per resource or combined?
- **Interpretation:** combined: ⌊(DIL + LAT) / 2⌋. The Burnham Bot scores 1 VP per Dilithium
  (its `special`), plus ⌊LAT / 2⌋ for any Latinum.
- **Keyed on:** `rules/13` §13.13.3.

## 055 — The Bot pays its own costs from what it values least

- **Question:** some AC rows make the Bot give something up without saying which: "log a
  controlled LOCATION and remove 2 Away Teams to take the top ENCOUNTER".
- **Interpretation:** the solo rulebook's pattern for giving things up (pulling back an Away Team,
  solo p.9) is the guide.
  - It logs the controlled LOCATION **least valuable to itself**.
  - It removes Away Teams from the LOCATION where it has the **fewest** tokens; ties go to the least
    valuable to itself.
  - Ties after that go to the leftmost.
- **Keyed on:** `rules/13` §13.3, §13.11.3.

## 056 — The Bot accepts what your effects offer it, except INCIDENT returns

- **Question:** your effects sometimes offer the opponent an optional benefit ("they may draw a
  card"). The solo rulebook covers draws (mill the top card, solo p.10) and INCIDENT returns
  (decline, solo p.7), and says other choices take "the first listed option it legally can".
- **Interpretation:**
  - An offered "may" is accepted. The listed action comes first; declining is the absence of a
    listed option. An offered draw therefore mills the Bot deck top.
  - INCIDENT returns are declined, as stated.
  - Every other choice takes the first enabled option.
- **Keyed on:** `rules/13` §13.9, §13.12.3; `src/engine/solo/policy.ts`.

## 057 — Only neutral LOCATIONs are Bot targets; its own cards' text stays silent

- **Question:**
  - Can "it engages" pick a LOCATION you control?
  - Do restrictions printed on LOCATIONs apply to the Bot?
  - Do keywords on the Bot's own cards ("cannot be promoted", "treated as a LOCATION") affect it?
- **Interpretation:**
  - Explore, engage and send only ever target **neutral** LOCATIONs (solo p.9 says "Neutral
    Zone").
  - Restrictions printed on a neutral LOCATION are rules of the board and bind the Bot like a
    player.
  - Text on the Bot's own cards is ignored entirely (solo p.5), so its rows classify by printed
    suit and its PERSONs can always be promoted.
- **Keyed on:** `rules/13` §13.6, §13.11.

## 058 — "Take the top card of the Supplement deck" goes on top of the Bot deck

- **Question:** where does a Supplement card the Bot "takes" go?
- **Interpretation:** "take" always means "on top of the Bot deck" for the Bot (solo p.8 and the
  player aid), so the Supplement card does too. It is resolved when it is drawn later, not
  immediately.
- **Keyed on:** `rules/13` §13.10.1.

## 059 — Reinforce lets you pick any card of your Reinforcement deck

- **Question:** the solo Directive Reinforce says "take a card from your Reinforcement pile". Is it
  the top card or a choice?
- **Interpretation:** a choice. The Reinforcement deck is not shuffled or ordered by any rule,
  and you built it yourself (`rules/14` §14.4), so the owner may look through it and pick.
- **Keyed on:** `rules/14` §14.4.

## 060 — The Bot's Captain's Log stays hidden

- **Question:** should the Bot's Log be visible to you? Nobody plays the Bot, so nothing is
  "secret".
- **Interpretation:** keep it exactly like a player's Log, which is face down to the opponent. Its
  size is public. Logged cards only matter at scoring, and the end-of-game breakdown shows them.
- **Keyed on:** `zoneProps` LOG (`src/engine/state.ts`); `rules/13` §13.2.

## 061 — Bot Market preferences: printed traits only; "most {DIL}" needs one

- **Question:** two corners of the Bot's Market preferences.
  - Does a WILDCARD card in the Market count as "a KLINGON" for "gain a KLINGON > …"?
  - What does "the card in the Market with the most {DIL} > most {GLO}" gain when no Market card
    holds either token?
- **Interpretation:**
  - **WILDCARD:** the solo rulebook gives WILDCARD meaning only for the card the Bot resolves (it
    takes the first TRAITS row). A Market card belongs to nobody, and nobody declares what it
    counts as. So preferences match printed traits, suits and Focus icons only.
  - **"Most" terms:** a "most {X}" step needs a card holding at least one {X}, otherwise the
    chain falls through to its next step. When nothing is left, the Bot gains nothing, so "if
    able" rows take their "otherwise" branch.
- **Keyed on:** `src/engine/resolver/primitives/botAcquire.ts`; `src/engine/solo/nodes.test.ts`
  ("Market preferences").

## 062 — A destroyed card never scores

- **Question:** DESTROY sends a card "to the box" (rules/08 → destroy), but the engine kept its
  `owner`, so a destroyed card's printed VP still counted for its last owner at final scoring.
- **Interpretation:** the box is out of the game, so a card in it scores for nobody, like a
  card returned to a shared supply (051). This applies in every mode. It surfaced with the solo
  Conspiring Admirals card, which destroys itself before scoring when the Bot owns it.
- **Keyed on:** `excludedFromScoring` in `src/engine/scoring.ts`;
  `src/engine/solo/admirals-challenge.test.ts`.

## 063 — Your hand attacks on the Bot: what "you choose the outcome" means in the engine

- **Question:** the solo rulebook (p.10) has hand attacks, and attacks that make the Bot choose
  from its own Discard pile, do nothing, with **you** freely choosing whether they succeeded.
  Which of our card shapes does that cover, and how is the choice asked?
- **Interpretation:** the engine handles three shapes.
  - A forced discard (or log) with nothing depending on it simply does nothing; no question is
    asked.
  - "You may make them discard … to gain …" is a cost on the Bot's hand inside a "may".
    Accepting the "may" is the choice that it succeeded: the cost counts as paid, and nothing
    moves (rulebook Example 1).
  - An "if they can … / if they cannot …" of your card that tests the Bot's hand or Discard
    pile asks you which branch happens. A step inside that branch which binds "the card they
    logged/discarded" for a later "if they did" follows your answer (rulebook Example 2). When
    no branch decided it, you are asked at that step.
- **Keyed on:** `src/engine/solo/outcome.ts`, `COST_DISCARD` in
  `src/engine/resolver/primitives/costDiscard.ts`; `src/engine/solo/outcome.test.ts`.

## 064 — The Conspiring Admirals card's "discard this card"

- **Question:** its play operation says "discard a PERSON from your hand to discard this card
  and draw a card", and a SPECIAL forbids any other effect from beaming or discarding it ("not
  even in the Clean-up Step", per the STCC errata).
- **Interpretation:**
  - A played card sits in your Staging Area and goes to your Discard pile at Clean-up. That
    _is_ "discard this card", so the play operation is the PERSON-discard cost and the draw.
  - The protection is a card flag, `discardProtected`. The card is never a candidate for a
    hand discard, a cost discard, a beam, or the Clean-up "discard any cards from hand".
- **Keyed on:** `src/data/cards/solo/directives.json`, `discardCandidates` in
  `src/engine/resolver/runtime.ts`.

## 065 — Five-Year Mission boosts "before drawing the starting hand"

- **Question:** two Bots' campaign bonuses let you find cards (or find a LOCATION and free play
  it) before you draw your starting hand. Where do you look, and when do they resolve?
- **Interpretation:**
  - Setup holds your opening hand back. The boosts resolve as the game starts, before your first
    Resupply step. Then you draw your hand, and then the other boosts ("gain 3 Research", "after
    drawing the starting hand, draw 2") resolve.
  - "Find" looks through your Draw deck and Discard pile, plus your Reserve deck where the
    bonus allows it. Your hand is empty at that point, so it is left out; finding a card that is
    already in hand would do nothing.
- **Keyed on:** `pushCampaignStart` in `src/engine/solo/campaign.ts`, the `campaign` rewards in
  `src/data/cards/solo/bots.json`.

## 066 — Five-Year Mission upgrades: a free choice between Option A and B

- **Question:** "Choose one: Option A … If none of your Market cards matches, you must take
  Option B." May you take Option B when a Market card matches?
- **Interpretation:**
  - Yes. Option B is forced only when no card matches. The Market-only challenge closes Option
    B after a win.
  - Option A offers each matching Market card you owned at any point in the game, once. A card
    already in your Reinforcement pile is not offered again.
  - A REINFORCE bonus offers your crew cards whose starting position is the one it names
    (Reserve deck or Available cards), never an INCIDENT, and never a card already in the pile.
  - When nothing is on offer, the game passes without an upgrade.
- **Keyed on:** `upgradeOptions` / `applyUpgrade` in `src/session/campaign.ts`.

## 067 — Where the Reinforcement pile's cards come from

- **Question:** a Market card added to the Reinforcement pile, and a crew card moved there by a
  REINFORCE bonus: where are they in later games?
- **Interpretation:**
  - A Market card leaves the Market: at setup it comes out of its Market deck (or the face-up
    offer, which is then refilled) and starts in your Reinforcement pile.
  - A crew card leaves your deck: it starts in your Reinforcement pile, not where its position
    indicator puts it.
  - The pile is yours and visible to you. Its cards don't score until the campaign Directive
    takes them into your hand.
- **Keyed on:** `setupCampaignDeck` in `src/engine/solo/campaign.ts`.

## 068 — The campaign challenges in the engine

- **Interpretation:**
  - **Lean start:** after a single win you choose which resource to start without, when you start
    the next game.
  - **Late Away Teams:** a set-aside token leaves both your pool and your total. It comes back
    (to your Captain) at the first check after your Reserve deck is empty.
  - **One ship:** your starting SHIP leaving your Fleet for any reason loses the game on the
    spot. The game goes to final scoring, and the Bot wins whatever the score.
  - **Random Reserve:** "from the rank of Lieutenant on" reads your rank when the game is set
    up.
- **Keyed on:** `campaignSetup` in `src/session/campaign.ts`, `campaignCheck` in
  `src/engine/solo/campaign.ts`.
