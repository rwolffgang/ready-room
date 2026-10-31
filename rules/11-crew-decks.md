# 11. The Crew Decks

Six asymmetric decks, one per captain. Complexity is the designers' rating out of 10. Everything
below comes from the card definitions (`src/data/cards/crew/`); names and printed text come from
the fetched STCC data at runtime.

| Captain     | Deck  | Faction   | Complexity | Cards | Ships | Status card? | Recommended first game |
| ----------- | ----- | --------- | ---------- | ----- | ----- | ------------ | ---------------------- |
| **Picard**  | `PIC` | Starfleet | **1** / 10 | 24    | 3     | No           | ✅                     |
| **Shran**   | `SHR` | Andorian  | **2** / 10 | 24    | 2     | No           | ✅                     |
| **Koloth**  | `KOL` | Klingon   | **3** / 10 | 24    | 3     | No           |                        |
| **Sisko**   | `SIS` | Starfleet | **4** / 10 | 25    | 3     | No           |                        |
| **Sela**    | `SEL` | Romulan   | **5** / 10 | 24    | 5     | No           |                        |
| **Burnham** | `BUR` | Starfleet | **7** / 10 | 26    | 3     | **Yes**      |                        |

## Starting layout

Every deck starts with its CAPTAIN in play and exactly one SHIP `DEPLOYED`. The rest is split by
the starting position printed on each card:

| Deck  | Deployed  | Development | Reserve | Available | Other                                            |
| ----- | --------- | ----------- | ------- | --------- | ------------------------------------------------ |
| `PIC` | 1PIC02/24 | 8           | 4       | 10        | —                                                |
| `SHR` | 1SHR02/24 | 7           | 5       | 10        | —                                                |
| `KOL` | 1KOL02/24 | 7           | 5       | 10        | —                                                |
| `SIS` | 1SIS03/25 | 7           | 5       | 10        | 1SIS02/25 `CONTROLLED LOCATION`                  |
| `SEL` | 1SEL02/24 | 6           | 6       | 7         | 1SEL22/24, 1SEL23/24, 1SEL24/24 `DISCARD`        |
| `BUR` | 1BUR03/26 | 8           | 4       | 10        | 1BUR02/26 Status card; 1BUR26/26 `INCIDENT DECK` |

> Picard and Shran are the recommended first pairing: neither has an `INCIDENT DECK`,
> `CONTROLLED LOCATION` or `DISCARD` starting card (nor does Koloth), and both are the lowest
> complexity.

---

## 11.1 Picard (`PIC`), complexity 1

- Captain 1PIC01/24 (`HUMAN`, `STARFLEET`) rewards gaining `ALLY` cards; its Endgame scores
  1 VP per `ALLY` you own.
- Ships: 1PIC02/24 (deployed), 1PIC10/24 (Development), 1PIC14/24 (Reserve).

## 11.2 Shran (`SHR`), complexity 2

- Captain 1SHR01/24 carries the `IMPERIAL` trait as well as `ANDORIAN`.
- Ships: 1SHR02/24 (deployed), 1SHR07/24 (Development). The only deck with two.

## 11.3 Koloth (`KOL`), complexity 3

- Captain 1KOL01/24 (`KLINGON`, `WEAPON`).
- Ships: 1KOL02/24 (deployed), 1KOL09/24 (Development), 1KOL24/24 (Available).

## 11.4 Sisko (`SIS`), complexity 4

- Captain 1SIS01/25 (`HUMAN`, `STARFLEET`, `TRANSCENDENT`).
- Starts controlling the Location 1SIS02/25 (`BAJORAN`).
- Ships: 1SIS03/25 (deployed), 1SIS15/25 (Reserve, `CLOAK`), 1SIS25/25 (Available).

## 11.5 Sela (`SEL`), complexity 5

- Captain 1SEL01/24 (`HUMAN`, `ROMULAN`, `SHADY`).
- Five ships, the most of any deck, and **all five carry `CLOAK`**: 1SEL02/24 (deployed),
  1SEL03/24 and 1SEL07/24 (Development), 1SEL17/24 (Available), 1SEL23/24 (Discard).
- The only deck that starts with cards in its Discard pile (three).

---

## 11.6 Burnham (`BUR`), complexity 7, **special rules**

- Captain 1BUR01/26 (`HUMAN`, `SCIENTIST`, `STARFLEET`).
- Starts with the Status card 1BUR02/26 in play and 1BUR26/26 shuffled into the Incident deck.
- Ships: 1BUR03/26 (deployed), 1BUR04/26 (Development), 1BUR15/26 (Reserve, `CLOAK`).
- The deck is built around Dilithium being scarce; 1BUR10/26 is the card that **logs** the Status
  card and ends the special rules.

### 11.6.1 The Inert Dilithium rules

These are **active while the Status card 1BUR02/26 is in play**. Once 1BUR10/26 **logs** it,
**all of these rules switch off**.

| #   | Rule                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Hand size is 6, not 5.** Draw 6 in player setup step 13 and refill to 6 each Clean-up.                                                                                                                             |
| 2   | **Clean-up:** instead of placing Glory on the Market, **remove 1 Glory from the current Stardate card** and **place 2 Dilithium from the supply** on one Market card. Whoever gains that card gains the 2 Dilithium. |
| 3   | **Any Dilithium you _gain_ via an operation goes onto the Status card**, not your pool. **Exception: Dilithium gained from the Market (tokens on a gained card) goes to your pool normally.**                        |
| 4   | **You cannot spend Glory as if it were Dilithium.** (The normal 1 GLO = 2 DIL substitution is disabled. Glory-for-Latinum still works.)                                                                              |
| 5   | **You cannot spend Dilithium from the Status card**, and **you do not own it** for the purposes of other effects.                                                                                                    |
| 6   | **`recrystallize`**: shift **1 Dilithium** off the Status card into your **personal pool**. It appears on 1BUR07/26, 1BUR10/26, 1BUR22/26 and 1BUR24/26.                                                             |
| 7   | **If your opponent steals Dilithium from you, give it from the Status card first.** (It makes no difference to them where it comes from.)                                                                            |
| 8   | **If _you_ steal Dilithium, it goes to your pool, not the Status card.** Stealing is not gaining.                                                                                                                    |
| 9   | **Cadet Training variant:** remove 1 Glory from the Stardate and place only **1** Dilithium (not 2).                                                                                                                 |

> **Implementation:** model this as a **rule-modifier layer** attached to the Status card, with
> hooks on `handSize`, `onGainResource(DIL)`, `canSubstituteGloryFor(DIL)`, `onStolen(DIL)` and
> `cleanupGloryPlacement`. Logging the Status card detaches the layer. This is the single
> strongest argument for making rule modifiers first-class in the engine rather than special-casing.
