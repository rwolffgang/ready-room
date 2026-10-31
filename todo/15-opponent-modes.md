# TODO 15 — Opponent modes

**Depends on:** `06`, `12`, `13`, `14`.
**Estimate:** Cadet ½ day · hot-seat 1 day · Bot: in progress (§3).

---

## 1. Cadet Training mode — ship this first

Fully specified in `rules/10`. **No opponent AI required.**

- [ ] `mode: 'CADET'` setup: the two `CADET` Stardate cards (5 Glory each).
- [ ] **All Glory from the supply, always** (`rules/10` §10.2 rule 1).
- [ ] **Ignore** effects that remove Glory from a Stardate card outside your Clean-up Step
      (rule 2).
- [ ] **The virtual opponent** (rule 3) — implement as a **query interceptor**, not a fake player:
  ```ts
  // In CADET mode, any query about opponent-owned quantities:
  opponentResource(res)        -> 1
  opponentAwayTeamsAt(loc)     -> 1
  opponentShipTokensAt(loc)    -> 0      // the one explicit exception
  opponentCardsInPlay(filter)  -> 1
  opponentHandSize()           -> 1
  ```
  - So "remove up to 2 opponent Away Teams for 1 Glory each" yields **1** Glory.
  - "Steal 3 Dilithium" steals **1**.
  - **Securing still needs 3 of your tokens** (they have 1 Away Team there, so 3 ≥ 3 and
    3 ≥ 1+2 ✓).
- [ ] **Opponent forced to take an INCIDENT → skip it, you gain 1 Glory** (rule 4). Important:
      this means **the Incident deck does not deplete from your attacks** in Cadet mode.
- [ ] **The Burn = you lose** (rule 5).
- [ ] Clean-up gains an extra substep **before** Glory placement: **wipe one Market card of your
      choice** (`rules/10` §10.3).
- [ ] The fixed timeline (`rules/10` §10.3): Stardate 1 empties on turn 5; turn 6 Clean-up begins
      with a full Market + Neutral Zone wipe and refills Stardate 2 with 5 Glory from the supply;
      Stardate 2 empties on turn 10; game ends after turn 11.
      **Implement this as the natural consequence of the Stardate rules, then assert the timeline
      in a test** — if a normal game with these cards doesn't produce that schedule, something
      else is wrong.
- [ ] **Burnham variant:** place **1** Dilithium, not 2 (`rules/10` §10.3, `rules/11` §11.6.1 #9).
- [ ] Show the benchmark bands at the end: ≥70 / ≥100 / >120.

## 2. Hot-seat two-player

- [ ] `viewerSeat` follows `activeSeat`, with a **pass-the-device interstitial** on change.
- [ ] `project(state, viewerSeat)` hides: the opponent's hand, facedown deck order, the
      opponent's Captain's Log contents (`rules/04` §4.5).
- [ ] **REACTION windows belonging to the inactive player need the interstitial too** — they fire
      on the active player's turn (`rules/08` → REACTION). This is the fiddly part of hot-seat:
      handle `choice.seat !== viewerSeat` as a first-class flow, not an edge case.
- [ ] A "reveal everything" debug toggle behind a dev flag.

## 3. The official solo Bot — in progress

Unblocked: the solo rulebook is restated in `rules/13` (solo play) and `rules/14` (campaign), and
STCC publishes the Automated Command card text (`data/bots.json`). The Bot is a **deterministic
card-driven automaton** in the engine (`src/engine/solo/`, `mode: 'SOLO'`, seat 1). Its turn
advances one beat per logged `BOT_STEP` intent, so it paces, replays and undoes like any other
move. Its rows are effect trees in `src/data/cards/solo/bots.json`, keyed to the STCC bot ids.

- [x] Rules restated (`rules/13`, `rules/14`); open interpretations logged (`docs/card-rulings.md`
      052–060).
- [x] `npm run fetch-cards` also fetches `data/bots.json` (vendor only, never committed).
- [x] Engine types: `mode: 'SOLO'`, Bot phase/beats, zones `BOT_ROW` / `SUPPLEMENT` /
      `REINFORCEMENT`, Stardate `botActions`.
- [x] New DSL nodes: `TRY`, `ATTACK`, `BOT_DECK`, `BOT_ACQUIRE`, `BOT_JUNK`,
      `BOT_SEND_AWAY_TEAM`, `BOT_DEPLOY`, `BOT_RESOLVE`; `ADVANCE_SPECIALTY` lower/higher of two.
- [x] Automated Command mechanics for the six crews (PIC SHR KOL SEL SIS BUR), crosschecked
      against `bots.json`.
- [x] Bot setup, turn, choice policy, human→Bot hooks, inert Bot cards, end timing, scoring.
- [x] Hand-attack outcome choice (`rules/13` §13.12.2).
- [x] The `SURPRISE` trait becomes live; solo Directives `1DIR01/2` (Conspiracy) and `1DIR02/2`
      (Reinforce), minted only in SOLO games, from the latest STCC errata.
- [x] House AI: determinize, SOLO evaluation, `tools/solo-arena.ts` (no learned weights ship, so
      no retrain).
- [x] UI: Solo vs Bot setup, Bot area, Automated Command panel (rendered from STCC text), paced
      Bot turn, end screen (`src/ui/solo/`).
- [x] Five-Year Mission campaign (`rules/14`): Reinforcement deck and the campaign Directive
      `1DIR02/2`, boosts, challenges, campaign record (`src/session/campaign.ts`) and screens
      (`src/ui/solo/Campaign.tsx`).
- Out of scope until we have their decks: the other 10 STCC Bots (box 2/3 crews), `2DIR01`/`2DIR02`.

## 4. A heuristic opponent (optional, later) — done as the house AI

If you want a two-player game without a second human and without the Bot rules:

- [x] Implement a `ChoicePolicy` with simple heuristics: prefer gaining cards with Skill icons
      matching your best track; take control when secured; never spend Glory if any other payment
      exists (it's 1 VP); complete any completable mission immediately. (`src/bot/heuristic.ts`,
      the Easy and Normal levels.)
- [x] **This is a house AI, not the game's Bot.** Label it clearly in the UI so you don't confuse
      it with the official solo mode. (The UI says "House AI"; `docs/bot.md`.)
- [x] The `autoPlay` fuzz policy from `todo/07` §6 is the skeleton — a heuristic policy is the
      same interface with better choices. (`Bot` in `src/bot/types.ts`; first-legal is the fuzz
      driver.)
- [x] Beyond the plan: an ISMCTS search for Hard (`src/bot/ismcts.ts`), a bot-vs-bot arena
      (`tools/arena.ts`), a learned value function trained by self-play with an arena gate
      (`src/bot/learned.ts`, `npm run bot:retrain`) and a quick regression (`npm run bot:check`).
      Still the house AI, not the official Bot: see `docs/bot.md`.

---

## Definition of Done

- [ ] A Cadet Training game completes in exactly the `rules/10` §10.3 timeline (asserted by test).
- [ ] In Cadet mode, "steal 3 Dilithium" steals exactly 1; "remove up to 2 opponent Away Teams"
      yields exactly 1 Glory.
- [ ] In Cadet mode, an attack that would give the opponent an INCIDENT gives **you 1 Glory** and
      **does not** deplete the Incident deck.
- [ ] In Cadet mode, triggering the Burn produces a **loss**.
- [ ] Hot-seat hides the opponent's hand and Log, and handles an inactive-player REACTION window
      with a correct interstitial.
- [ ] Bot mode is either absent or clearly marked "requires the solo rulebook".
