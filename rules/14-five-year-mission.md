# 14. Five-Year Mission: the solo campaign (solo rulebook p.16–19)

Source: the solo rulebook (see `rules/13`); `solo p.N` points back to it. A campaign is a series of
solo games against Bots (`rules/13`). Upgrades carry over from game to game, and you are promoted
for each win.

## 14.1 Shape of a campaign (solo p.16)

- You pick **one crew** for the whole campaign. Your starting rank is **Ensign**.
- Each game is one assignment.
- **Ranks:** Ensign → Lieutenant → Commander → Captain → Commodore → Admiral. **Every win promotes
  you one rank.** A tie counts as a loss.
- **The campaign ends:**
  - as soon as you reach **Admiral** (5 wins), and you have won it; or
  - after **10 games**.
- Before each game you choose an opponent crew (or draw one at random). You may **never** pick a
  crew you have already beaten in this campaign.
- You may use either side of your crew board, as usual.

## 14.2 Mode and Bot difficulty (solo p.16)

Choose the campaign mode once at the start. From easiest to hardest: **Set Phasers to Stun**,
**Yellow Alert**, **Gates of Sto'Vo'Kor**, **The Kobayashi Maru**. The Bot's difficulty depends on
your current rank and the mode:

| Your rank  | Set Phasers to Stun | Yellow Alert | Gates of Sto'Vo'Kor | The Kobayashi Maru |
| ---------- | ------------------- | ------------ | ------------------- | ------------------ |
| Ensign     | Ensign              | Lieutenant   | Commander           | Admiral            |
| Lieutenant | Lieutenant          | Commander    | Captain             | Admiral            |
| Commander  | Commander           | Captain      | Admiral             | Admiral            |
| Captain    | Captain             | Captain      | Admiral             | Admiral            |
| Commodore  | Captain             | Admiral      | Admiral             | Admiral            |

## 14.3 After each game: the logbook and upgrades (solo p.16–17)

1. Record the opponent crew, its difficulty, both scores and the result.
2. Promote yourself if you won (§14.1).
3. **Upgrade your crew deck. This happens after a win or a loss.** Choose one:
   - **Option A:** pick one Market card you had during the game that matches the restriction of the
     Bot you just faced, and add it to your **Reinforcement deck**. Each Bot's AC card lists a
     "win" restriction and a "loss" restriction, as traits/suits joined by "/".
     - The card may be of any suit, as long as it matches.
     - If none of your Market cards matches, you must take Option B.
   - **Option B:** one alternative bonus from that Bot's AC card, again from its win or loss list:
     - **REINFORCE:** move one of your own crew cards (named on the card, e.g. from your Reserve
       deck or starting deck) to your Reinforcement deck.
     - **BOOST:** an effect you resolve **at the start of every later game** in this campaign.
       Examples: "gain 3 Research", "before drawing your starting hand, find two cards (not from
       your Reserve deck)".
4. Everything added to the Reinforcement deck starts there in every later game of the campaign.

**Prohibitions:** never add a DISCOVERY/ENCOUNTER, an INCIDENT or a common LOCATION to the
Reinforcement deck.

## 14.4 The Reinforcement deck and Reinforce (solo p.17)

- If your Reinforcement deck holds at least one card, shuffle the solo Directive **Reinforce**
  ("Solo Campaign only") into your starting deck.
- Playing Reinforce takes a card from your Reinforcement deck.
- This is separate from enlisting Reserve and Development cards.
- Cards still in the Reinforcement deck at the end **do not score**. You only own them once you
  take them with Reinforce.

## 14.5 Optional challenges (solo p.18)

You may add any number of these to a campaign, at any mode:

| Challenge                            | Effect                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live Long and Prosper                | After a win, start the next game without Dilithium **or** without Latinum (your choice). Win that one too and the next starts without both, and so on until you lose. A loss resets your starting resources to normal.         |
| That is Not a Weakness; That is Life | From the rank of Lieutenant on, randomize your Reserve deck at setup. Note its size, shuffle your RESERVE and AVAILABLE cards together, deal a new Reserve deck of the same size, and use the rest as your starting Draw deck. |
| Two Weeks to the Closest Outpost     | After a win, shuffle Reinforce into your Reserve deck instead of your starting deck. After a loss it goes back into your starting deck.                                                                                        |
| Running Like a Baby Gazelle          | After two wins in a row, shuffle one INCIDENT from the Incident deck into your starting Draw deck at setup. Keep doing this (at most one) every game until you lose.                                                           |
| Rules of Acquisition                 | After a win, Option B is not available. You must add a matching Market card, or get no upgrade.                                                                                                                                |
| Only Ship in the Quadrant            | If your starting SHIP is ever dismissed or recalled, for any reason, you lose the game. Not available for crews without a starting deployed SHIP.                                                                              |
| They Will Arrive on Tuesday          | At setup, set one of your Away Team tokens aside. It returns to your Captain when your Reserve deck is empty. After a win, set two aside for the next game.                                                                    |

## 14.6 Performance review (solo p.18)

At the end of the campaign you are rated by final rank: Ensign, Lieutenant, Commander, Captain,
Commodore, or Admiral. Admiral is split three ways: reached in 9–10 games, 7–8 games or 5–6
games, the fastest being the best. The app words the ratings in its own way.

## 14.7 Engine mapping

- **Campaign record and rules** (ranks, mode table, rematch rule, upgrade validation):
  `src/session/campaign.ts`.
- **Per-game campaign context** (`SetupConfig.solo.campaign`: Reinforcement cards, boosts,
  challenge flags) is replayed by the engine (`src/engine/solo/campaign.ts`). Every campaign game
  therefore replays from its seed, setup and intent log alone.
- **The campaign Directive** is `1DIR02/2`.
- **Our ids and labels**, kept free of the rulebook's titles:

  | Rulebook                             | Id                     | In the app      |
  | ------------------------------------ | ---------------------- | --------------- |
  | Set Phasers to Stun                  | `EASY`                 | Easy            |
  | Yellow Alert                         | `NORMAL`               | Normal          |
  | Gates of Sto'Vo'Kor                  | `HARD`                 | Hard            |
  | The Kobayashi Maru                   | `BRUTAL`               | Brutal          |
  | Live Long and Prosper                | `LEAN_START`           | Lean start      |
  | That is Not a Weakness; That is Life | `SHUFFLED_RESERVE`     | Random Reserve  |
  | Two Weeks to the Closest Outpost     | `DIRECTIVE_IN_RESERVE` | Distant support |
  | Running Like a Baby Gazelle          | `INCIDENT_STREAK`      | Trouble follows |
  | Rules of Acquisition                 | `MARKET_ONLY`          | Market only     |
  | Only Ship in the Quadrant            | `ONE_SHIP`             | One ship        |
  | They Will Arrive on Tuesday          | `LATE_TEAMS`           | Late Away Teams |

- Interpretations are logged in `docs/card-rulings.md` 065–068.
