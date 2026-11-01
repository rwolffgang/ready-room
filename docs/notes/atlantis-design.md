# Stargate Atlantis: deck design (draft 1)

Step 2 of `docs/adding-a-custom-crew.md`. It builds on the research brief
(`docs/notes/atlantis-research.md`). Card text here is working text in game terms; the final
wording and flavor go into the pack in step 3.

- **Deck code:** `SHP` (after Sheppard, as `MAL` is after Mal). Card ids `1SHP01/25` …
  `1SHP25/25`, missions `1SHP/M1`–`M3`.
- **Pack:** `src/data/custom/atlantis.json`.
- **Size:** 25 cards: 1 captain, 1 deployed ship, 8 Development, 5 Reserve, 10 Available.
- **Rules used:** existing suits, traits, triggers and DSL nodes only. Every card names the
  card whose pattern it copies.

## The idea in one paragraph

The expedition runs on borrowed power and pays for it with Wraith attention. There is **one
ZPM** in the deck, as in the show: while it is deployed it feeds {DIL} every turn and makes
several cards stronger, and the deck's big moments **dismiss** it (the shield holds, Carter's
overload, the hive ship driven off). The Daedalus, Zelenka and Asuras bring it back. The
risk is the Wraith: power plays and fast growth cost INCIDENTs (Ford's enzyme, the raid on
Asuras, the deal with Todd, recruiting allies), two Wraith INCIDENTs live in the deck, and
the Burn ends the game against whoever holds more. Teyla, Keller and Todd clean up.

**How it differs from MAL:** MAL _profits_ from taking INCIDENTs (Reynolds, Miranda). Here
no card rewards taking one. INCIDENTs are only costs, and the cleanup sits in the starting
deck (Teyla) and in Development (Keller, Todd). The engine is
the ZPM (deploy, feed, dismiss, recover), which no deck has.

## Choices that differ from the brief

- **Atlantis is the flagship SHIP, modelled on Deep Space 9 (`1SIS03`)**, not a LOCATION. A
  station-ship that has no warp of its own is an existing pattern. As a SHIP the city holds
  the crew (beam, Duty Officer), and missions can ask for crew "on one SHIP". It moves only
  when another card warps "one of your SHIPs", which is rare, as in the show.
- **One ZPM card**, not two. Several cards find it or draw it back from the Discard pile, so
  it keeps returning, but never more than one is in play.
- **The gene is `AUGMENT`.** Carriers: Sheppard (captain), McKay, Beckett. The gene gates one
  thing only: a Puddle Jumper with a carrier aboard warps for free. Sheppard is always in
  play as captain, so an "if you have an AUGMENT in play" gate would always be open; the
  gates check "beamed here" instead.

## The cards

Columns: suit; traits; skill (S) and focus (F) icons; printed VP; Development cost.

### Captain and flagship

**01 John Sheppard**: CAPTAIN · `HUMAN` `PILOT` `AUGMENT` · F Military · 5 Away Teams

- Reaction: After one of your SHIPs warps, you may send an Away Team to a LOCATION where you
  have a SHIP.
- Endgame: Score 1 VP for each SHIP you have in play.
- _Patterns:_ `1MAL23` (`SHIP_WARPED` reaction), `1MAL22` (send where you have a SHIP),
  `1MAL01` (`SCORE_VP` by count), `1MAL/M3` (count of SHIPs in the Fleet).

**02 Atlantis**: SHIP, deployed · `STARBASE` · S Any

- [action] Play: Deploy this ship.
- Activation: Discard a card to beam a card here.
- Activation: Promote a PERSON from your hand to Duty Officer.
- Reaction: When you would be attacked, you may dismiss a ZPM to ignore the negative effect.
  _(the shield)_
- _Patterns:_ `1SIS03` (station flagship), `1SIS10` (`WOULD_BE_ATTACKED` →
  `IGNORE_ATTACK`), `COST_DISMISS` with a filter (`1SEL04`: "Dismiss a SHIP to draw 2").

### Development (8)

| #   | Card            | Suit · traits                                 | Icons                     | VP  | Cost                      |
| --- | --------------- | --------------------------------------------- | ------------------------- | --- | ------------------------- |
| 03  | Elizabeth Weir  | PERSON · `HUMAN` `AMBASSADOR` `COMMUNICATION` | S Influence, F Influence  | 2   | 2 {DIL}, 1 {LAT}          |
| 04  | Jennifer Keller | PERSON · `HUMAN` `DOCTOR` `SCIENTIST`         | S Research, F Research    | 2   | 2 {DIL}                   |
| 05  | Samantha Carter | PERSON · `HUMAN` `SCIENTIST`                  | S Research ×2, F Research | 2   | 3 {DIL}                   |
| 06  | Todd            | ALLY · `ALIEN` `TELEPATH` `SHADY` `ATTACK`    | —                         | 3   | 2 {DIL}, take an INCIDENT |
| 07  | Ancient Warship | SHIP · `ATTACK`                               | S Military                | 3   | 5 {DIL}                   |
| 08  | Control Chair   | CARGO · `WEAPON` `ATTACK` `ONGOING`           | F Military                | 0   | 2 {DIL}, 1 {LAT}          |
| 09  | Asuras          | LOCATION · `SYNTHETIC`                        | S Research                | 2   | 3 {DIL}                   |
| 10  | Janus's Lab     | LOCATION · `TIME_TRAVEL`                      | S Research ×2             | 1   | 3 {DIL}, 1 {LAT}          |

- **03 Weir.** [action] Play: Gain 1 Influence and gain an ALLY. Reaction: After gaining an
  ALLY, gain 1 Influence _(she runs the expedition's diplomacy; only on duty, so the extra
  slot lets her sit beside your Duty Officer)_. Passive: You may have an additional PERSON on
  duty. _(`1PIC16` gain an ALLY; `1PIC01` the gain-an-ALLY reaction; `1BUR06` a PERSON with a
  reaction and a slot; `1PIC07` extra Duty Officer: the card reuses the `1PIC07_DUTY`
  modifier and lists it under `passives`.)_
- **04 Keller.** [action] Play: Return up to 2 INCIDENTs from your hand or Discard pile.
  Reaction: After you return an INCIDENT, gain 1 Research. _(`1MAL05` return and
  `INCIDENT_RETURNED`; `REPEAT` up to 2.)_
- **05 Carter.** [action] Play: Gain 1 Research. You may dismiss a ZPM to gain 2 more
  Research and draw 2 cards. _("Be All My Sins Remember'd": she spends the ZPM to win. Her
  two Research skill icons feed Naquadah Generators.)_
- **06 Todd.** [action] Attack Play: Return an INCIDENT from your hand or Discard pile. Your
  opponent takes an INCIDENT. Log this card. _(`1MAL05` return; `1SHR21` opponent takes an
  INCIDENT under ATTACK. The INCIDENT in his cost is the price of the deal.)_
- **07 Ancient Warship** _(the Orion; see Names)._ [action] Attack Play: Deploy this ship
  and warp it. If your opponent has a SHIP there, they discard 2 cards. Activation: Spend 1
  {DIL} to warp this ship. Activation: Discard a card to beam a card here. _(`1SIS15`
  Defiant; `1SHR07` 5-{DIL} ship.)_
- **08 Control Chair.** [action] Play: Deploy this card. Gain 1 Military. Attack Activation:
  Discard a card to remove an opponent's Away Team from a LOCATION where you have an Away
  Team. If you do, gain 1 {GLO};
  if you have a ZPM in play, also gain 1 Military. _(`1MAL08` Vera.)_
- **09 Asuras.** [action] Play: Take control of this location. Control: You may take an
  INCIDENT to find a ZPM; you may free play it. Activation: If you have an Away Team here,
  draw a card; with 3+ Away Teams on controlled LOCATIONs, draw another. _(`1MAL10` control
  "take an INCIDENT to gain"; `1PIC07` find, then free play; `1SIS08` find by id.)_
- **10 Janus's Lab.** [action] Play: Take control of this location. Control: Gain 2
  Research. Activation: Draw a card. Endgame: Score 1 VP for each SCIENTIST you own.
  _(`1PIC06` Daystrom Institute.)_

### Reserve (5)

| #   | Card           | Suit · traits                        | Icons      | VP  |
| --- | -------------- | ------------------------------------ | ---------- | --- |
| 11  | Ronon Dex      | PERSON · `HUMAN` `SECURITY` `ATTACK` | S Military | 0   |
| 12  | Carson Beckett | PERSON · `HUMAN` `DOCTOR` `AUGMENT`  | S Research | 0   |
| 13  | Daedalus       | SHIP                                 | S Military | 0   |
| 14  | ZPM            | CARGO · `ONGOING`                    | F Research | 0   |
| 15  | Hive Ship      | INCIDENT                             | —          | −2  |

- **11 Ronon.** [action] Attack Play: Discard a card to remove an opponent's Away Team from a
  LOCATION. If you do, gain 1 Military and 1 {GLO}. Activation: Spend 1 {DIL} to send an Away
  Team to a LOCATION where you have a SHIP. _(`1MAL03` River's attack; `1MAL22`.)_
- **12 Beckett.** [action] Play: Gain 1 Research. Draw a PERSON from your Discard pile _(the
  infirmary puts the crew back on their feet; missions dismiss the crew they use)_.
  Activation: Spend 2 {DIL} to find an AUGMENT _(the gene therapy)_. _(`1SIS13` draws from the
  Discard pile; `1SIS08` finds an AUGMENT. His first Play, `1MAL05`'s "return an INCIDENT,
  gain 1", repeated Teyla's and was a small Keller.)_
- **13 Daedalus.** [action] Play: Deploy this ship. You may find a ZPM _(it brought the
  ZPM in "The Siege Part 3")_. Activation: Spend 1 {DIL} to warp this ship. Activation:
  Discard a card to beam a card here or recall a card beamed to a SHIP _(Asgard beaming)_.
  _(`1SHR05` "you may find"; `1SIS03` beam or recall.)_
- **14 ZPM.** [action] Play: Deploy this card. Resupply: Gain 1 {DIL} and 1 {GLO} _(balancing
  added the {GLO} and later dropped the 2 {DIL} its Play first gave; see
  `docs/custom-decks.md`)_.
  _(`1SIS06` deployed CARGO with a Resupply op.)_
- **15 Hive Ship.** [action] Play: Either dismiss a ZPM or spend 3 {DIL} to return this card.
  _(`1MAL15` Reavers.)_

### Available: the starting deck (10)

| #   | Card                | Suit · traits                                     | Icons       |
| --- | ------------------- | ------------------------------------------------- | ----------- |
| 16  | Naquadah Generators | DIRECTIVE                                         | —           |
| 17  | New Arrivals        | DIRECTIVE                                         | —           |
| 18  | Ancient Database    | DIRECTIVE                                         | —           |
| 19  | Culling             | INCIDENT (−2)                                     | —           |
| 20  | The Mainland        | LOCATION · `BUSINESS`                             | S Influence |
| 21  | Puddle Jumper       | SHIP · `CLOAK`                                    | —           |
| 22  | Rodney McKay        | PERSON · `HUMAN` `SCIENTIST` `ENGINEER` `AUGMENT` | S Research  |
| 23  | Teyla Emmagan       | PERSON · `HUMAN` `TELEPATH` `AMBASSADOR`          | S Influence |
| 24  | Aiden Ford          | PERSON · `HUMAN` `SECURITY`                       | S Military  |
| 25  | Radek Zelenka       | PERSON · `HUMAN` `ENGINEER` `SCIENTIST`           | S Research  |

- **16 Naquadah Generators**: the deck's Utilize, unchanged. **17 New Arrivals**: its
  Recruit, unchanged. **18 Ancient Database**: its Analyze, unchanged (take an INCIDENT to
  gain a SHIP; discard 2 to gain a CARGO; gain 2 {DIL}).
- **19 Culling** _(the Red Alert)_. [action] Play: Either remove one of your Away Teams or put
  a card from your hand on top of your deck to return this card. _(`1MAL15` either/or;
  `COST_REMOVE_AWAY_TEAM` from `1SHR16`.)_
- **20 The Mainland** _(the Athosian settlement)_. [action] Play: Take control of this
  location. Control: Gain 2 {LAT}. Activation: the usual Away Team draw. _(`1MAL21`.)_
- **21 Puddle Jumper.** [action] Play: Deploy this ship. You may warp it. Activation: Warp
  this ship; unless an AUGMENT is beamed here, spend 1 {DIL} first. Activation: Discard a card
  to beam a card here. _(`1SIS25`; the gene gate is `IF` + `COUNT_AT_LEAST` on
  `BEAMED_TO: THIS`.)_ Every warp also fires Sheppard's Away Team.
- **22 McKay.** [action] Play: Draw 2 cards and discard one of them. Gain 1 Research.
  Activation: Spend 2 {DIL} to gain 1 Research; if you have a ZPM in play, gain 1 more.
  _(`1MAL03` play; `1MAL11` activation shape.)_
- **23 Teyla.** [action] Play: Gain 1 Influence. You may return an INCIDENT from your hand or
  Discard pile. Activation: Spend 2 {LAT} to scan 2 ALLYs and gain 1 {GLO} _(she knows
  every trading partner; balancing added the {GLO}, raised the cost to 3 {LAT} and set it back
  to 2 when the ZPM lost its 2 {DIL})_. _(`1MAL04` play; `1MAL13` scan.)_
- **24 Ford.** [action] Play: Send an Away Team to a LOCATION where you have a SHIP. Gain 1
  Military. Activation: Take an INCIDENT to gain 2 Military _(the Wraith enzyme)_.
  _(`1MAL22`; `1SIS12` "take an INCIDENT to advance".)_
- **25 Zelenka.** [action] Play: Gain 1 Research. You may refresh a SHIP. Activation: Spend 1
  {DIL} to draw a ZPM from your Discard pile. _(`1MAL24` Kaylee; `1SIS13` O'Brien draws from
  the Discard pile.)_

## The board

**Tracks:** Picard's (`boards/pic.json`), which favor Research: Research ×1/2/3/4/5/6 at
0/2/7/10/13/15; Influence ×1/2/3/5/7 at 0/3/8/11/15; Military ×1/3/4/5 at 0/5/10/14. The
Advanced side uses Picard's Advanced rows.

**Missions** (the Basic side has M1 only, for 0 VP):

| #   | Name             | Goal                                                                      | Reward                                   | VP  |
| --- | ---------------- | ------------------------------------------------------------------------- | ---------------------------------------- | --- |
| M1  | The Gate Team    | On one SHIP: a `SCIENTIST`, a `TELEPATH` and a `SECURITY`; and Research 4 | Gain 2 {DIL} and draw 2 cards            | 4   |
| M2  | Power the City   | A ZPM in play, and Research 8                                             | Enlist a Development                     | 3   |
| M3  | Pegasus Alliance | 2+ ALLYs in play, and Influence 6                                         | Gain 2 {GLO}; you may return an INCIDENT | 3   |

M1 is AR-1: McKay or Zelenka, Teyla, and Ford or Ronon (Todd is also a TELEPATH, but he logs
himself). Missions dismiss the beamed crew they use. The captain counts SHIPs, not crew, so
there is no MAL-style pull between the two. M2 is the engine's goal: power and science.

## Names

- Names come from the show. The brief's lists of names owned by other products (§7.2) were
  checked: none of these card names is on them.
- **Ancient Warship**, not "Orion": Orion is an STCC card name (brief §7.3), and
  "Ancient Battleship" is a Rittenhouse card title.
- **ZPM**, not "Zero Point Modules" (a Rittenhouse insert title). **Control Chair**, not
  "Command Chair" (Rittenhouse). **Culling**, not "Wraithfall" (a comic). **Hive Ship**, not
  "Wraith Hiveship" (Rittenhouse).

## Left out, available as swaps

- Evan Lorne (`PILOT` `SECURITY` `AUGMENT`): a Reserve gene carrier.
- Richard Woolsey (`BUSINESS` `AMBASSADOR`): a later leader.
- Michael: an INCIDENT or ATTACK villain.
- The Genii (Kolya, Ladon): `SHADY` `SPY`.
- The Travelers (Larrin): an ALLY or a second SHIP.
- The Athosians: an ALLY.
- The Hoffan drug: a dark trade-off CARGO.
- The Attero device: a powerful `WEAPON` with a heavy cost.
- Caldwell and Hermiod: the Daedalus covers them.

## To check in step 3 and the arena

- Read back every card with `describe()`. The only combinations no card has used yet: the
  Jumper's `IF` on `BEAMED_TO: THIS`, `COST_DISMISS` by id inside a `WOULD_BE_ATTACKED`
  reaction, and `DRAW_FROM_DISCARD` with an id filter. Each needs a test in
  `shp-deck.test.ts`.
- Balance target: 45–55 % against the box-1 decks and MAL, House AI Normal vs Normal, both
  seat orders (as in `docs/custom-decks.md`). Watch three things:
  - Ford's repeatable INCIDENT-for-2-Military, which may push the deck into the Burn.
  - Sheppard's free Away Team on every warp (with a free-warping Jumper).
  - Whether the ZPM is in play often enough for M2.
