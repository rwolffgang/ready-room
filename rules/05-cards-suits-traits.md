# 5. Cards: Suits, Traits, Operations & Acquisition

## 5.1 Suits (p.15)

Every card has exactly one of these suits, shown top-left.

| Suit                      | Machine ID  | Market? | Description                                                                                                                                   |
| ------------------------- | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **PERSON**                | `PERSON`    | ✅      | Notable people, crewmen, specialists. Can be **promoted** to Duty Officer.                                                                    |
| **CARGO**                 | `CARGO`     | ✅      | Gadgets, artifacts, creatures — anything carried/equipped.                                                                                    |
| **SHIP**                  | `SHIP`      | ✅      | Starships, shuttles, occasionally a starbase. Can be **deployed**; can hold **beamed** cards.                                                 |
| **ALLY**                  | `ALLY`      | ✅      | Minor races, civilisations, large organisations.                                                                                              |
| **DISCOVERY / ENCOUNTER** | `ENCOUNTER` | ❌      | Major unique findings. **Taken** from the Encounter deck, not gained.                                                                         |
| **INCIDENT**              | `INCIDENT`  | ❌      | Hurdles. Must be got rid of by playing them (meeting their requirements) or returning them to the Incident deck.                              |
| **LOCATION**              | `LOCATION`  | ❌      | **Never added to your deck.** Once in your Location Area they are _controlled_. Crew decks may include their own Locations, played from hand. |
| **DIRECTIVE**             | `DIRECTIVE` | ❌      | Utility cards (most commonly `Recruit` and `Utilize`). **Your deck can never gain more of them.**                                             |
| **CAPTAIN**               | `CAPTAIN`   | ❌      | Your captain.                                                                                                                                 |
| **MISSION**               | `MISSION`   | ❌      | Printed on the Crew board, not a loose card.                                                                                                  |

`PERSON`, `CARGO`, `SHIP`, `ALLY` are collectively the **Market cards**.

## 5.2 Traits (p.15)

Shown top-right; **1 to 5** per card. Traits have **no inherent effect** — they exist to be
referenced by other cards.

A trait is **"in play"** if it is on a card that is in play — **including beamed cards**
(beamed cards show only suit and trait icons, so traits still count).

### 5.2.1 Trait categories

| Category     | Styling                    | Examples                                             | Notes                                              |
| ------------ | -------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **Species**  | octagonal icon, orange box | `HUMAN`, `FERENGI`, `ALIEN`, `KLINGON`               | Referred to by `ANY SPECIES` / `DIFFERENT SPECIES` |
| **Gameplay** | red box                    | `ATTACK`, `ONGOING`, `SURPRISE`                      | See below                                          |
| **Wildcard** | light-red box              | `WILDCARD`                                           | See §5.2.3                                         |
| **Regular**  | plain                      | `WEAPON`, `STARFLEET`, `SCIENTIST`, `TIME TRAVEL`, … | Type / occupation / organisation                   |

### 5.2.2 The three gameplay traits

- **`ATTACK`** — the card has at least one `ATTACK` operation that can negatively affect the
  opponent. Other cards can react to or defend against `ATTACK`. **Note: the trait is on the
  card whether or not you use the ATTACK operation** — this matters for cards that punish
  having `ATTACK` in play (e.g. Halkan Council).
- **`ONGOING`** — the card is **deployed to the Fleet Area by its PLAY operation**, even though
  it is not a SHIP. Can appear on `CARGO`, `DIRECTIVE`, `ENCOUNTER`.
- **`SURPRISE`** — **only relevant in solo play vs. the Bot.** Defined in the solo rulebook.

### 5.2.3 `WILDCARD`

A `WILDCARD` trait **can be treated as any single trait**, chosen by the card's owner, for the
duration of **one operation or the meeting of one goal**. This applies **whether or not the card
is in play**.

Worked rulings from the rulebook:

- 1 `BAJORAN` + 1 `KLINGON` + 1 `WILDCARD` in play **satisfies** "have 3 `DIFFERENT SPECIES` in play".
- An effect demanding that you discard an `ENGINEER` **can** be satisfied with a `WILDCARD` card.
- An attack that makes you dismiss an in-play `CARDASSIAN` **cannot compel** you to pick the
  `WILDCARD` card. _(Using the wildcard is always your option, never an obligation.)_
- Any `find [trait]` effect also allows finding a `WILDCARD` card.
- **`WILDCARD` counts as no other trait during final scoring.**

> **Implementation:** `WILDCARD` is a _player-controlled, per-query_ substitution, not a
> permanent property. The trait-matching predicate must take an "owner may opt in" flag, and
> final scoring must pass `allowWildcard: false`.

## 5.3 Operation types

| Operation            | Strip colour | Where usable                                             | Cost an action?             |
| -------------------- | ------------ | -------------------------------------------------------- | --------------------------- |
| **PLAY**             | grey/white   | From hand → Staging Area                                 | Only if prefixed `[action]` |
| **ACTIVATION**       | blue         | In play, not Staging, not beamed. Your Action Step only. | Only if prefixed `[action]` |
| **PASSIVE**          | blue         | Always, both players' turns, even when exhausted         | n/a                         |
| **REACTION**         | blue         | On its trigger, any time, either player's turn           | Only if prefixed `[action]` |
| **RESUPPLY**         | green        | Resupply Step                                            | n/a (mandatory)             |
| **CLEAN-UP**         | green        | Clean-up Step                                            | n/a (mandatory)             |
| **CONTROL**          | —            | When a LOCATION enters your Location Area                | n/a                         |
| **ENDGAME**          | red          | Final scoring, if the card is **in play**                | n/a                         |
| **SPECIAL**          | purple       | As stated on the card; works even out of play            | n/a                         |
| **DEVELOPMENT COST** | black        | When enlisting that Development                          | n/a                         |

`ATTACK` is a **prefix** on an operation, not a separate operation type.

## 5.4 Gaining new cards from the Market (p.16, 30, 32)

Only the four Market suits can be **gained**.

### 5.4.1 `gain [suit]`

1. Pick one of two sources for that suit: its **faceup Market card**, or the **blind top card
   of its Market deck**.
2. Look at what you picked.
3. You decide where it goes: **Draw deck (on top)** or **Discard pile**.

- Several suits named → pick **one** of them.
- That suit has nothing left in the Market (no faceup card, empty deck) → **nothing happens**.
- `gain from the Junk` → search the Junk pile instead and take any card whose suit matches.

### 5.4.2 `scan # of [suit]`

1. Peek at the named suit's deck: its **top `#` cards**.
2. Gain **one** card, chosen from the scanned cards **plus** that suit's faceup Market card.
3. You choose the gained card's destination: **Draw deck (top)** or **Discard pile**.
4. Return remaining looked-at (not faceup) cards to the **bottom** of that deck, in any order.

- Fewer than `#` cards remaining → look at whatever is left.
- That suit has neither a faceup Market card nor any deck cards left → **no effect**.
- Multiple suits listed → choose **one suit to look at**. **That choice is locked in once you
  have looked**, and the faceup Market cards of the **other suits are off-limits**.
- `scan including the Junk` → once the `#` cards are seen, you may **additionally** search the
  whole Junk pile for that suit, then choose from Junk ∪ Market ∪ the `#` scanned cards.

### 5.4.3 `scan for [trait]`

Guarantees gaining a card with the trait, if any remains.

1. If any **visible Market card** has the trait → gain one of them; place on top of deck or in
   Discard.
2. If none does, **name a suit** and flip that Market deck's cards **one at a time from the top
   until one has the trait**. Gain it (top of deck or Discard) and **shuffle the other flipped
   cards back** into that deck.
3. If not found, **specify another of the other three suits** and repeat.
4. All four suits searched without success → **no card is gained; take 2 Glory instead**.

- Multiple traits listed → choose **one to scan for**. **You cannot change your mind once you
  have started looking through a Market deck.**
- `scan including the Junk` → the Junk pile is searched as an extra stage, **between** the faceup
  Market check and the deck flipping. A Junk card with the trait **may** be taken; if you pass,
  continue with the decks as usual.

### 5.4.4 Common to all Market acquisitions

- If you select a **faceup** Market card, you **also receive any resource tokens on it**
  (usually Glory placed during Clean-up).
- Then **reveal the next card of that deck** to refill the Market slot. If that deck is empty,
  **leave the slot empty**.
- REACTIONs worded "**when you gain a [particular card]**" **do** fire when the card is gained
  via `scan`.

### 5.4.5 Placement summary

| Mechanism                         | Destination                                        |
| --------------------------------- | -------------------------------------------------- |
| `gain` / `scan`                   | **top of Draw deck OR Discard pile** — your choice |
| `enlist` (Reserve or Development) | **always top of Draw deck**                        |
| `take`                            | **always directly to hand**                        |
| `find`                            | **always directly to hand**                        |

## 5.5 Taking cards (p.16, 33)

Taken cards go **directly into your hand**.

- **`DISCOVERY/ENCOUNTER`** — comes off the top of the Encounter deck, most often as the reward
  for fulfilling a card's requirements (_Strange New Worlds_, _Imperial Pride_, _Good Day to Die_, …).
- **`INCIDENT`** — taken either as a **cost** of your own effects, or as a **penalty** from an
  opponent's `ATTACK`. Add the Incident deck's **top card, unseen,** to your
  hand.
- **Returning an INCIDENT**, whether you play it or another card's effect sends it back: it goes
  **face down under the Incident deck**.
- REACTIONs worded "when you **gain** a [particular card]" **do NOT** fire on a `take`.

## 5.6 Junk pile (p.31)

- `junk a card` → choose a **faceup Market card**, move it to the Junk pile, reveal the next
  card of that deck to refill. If that deck is empty, leave the slot empty.
- **A Market card carrying any resource token can never be junked.**
  (A Stardate wipe **does** still remove it, tokens and all.)
- The Junk pile is **public**, and some effects can `gain`/`scan` from it.
