# Custom crew decks

Fan-made crew decks that are not part of the published game. They use only the
existing rules: the same suits, traits, keywords, triggers and DSL nodes as the
box-1 decks, so the engine and the UI play them without any new code.

There are two:

- **MAL**, a Firefly crew captained by Malcolm Reynolds (pack `firefly`).
- **SHP**, the Stargate Atlantis expedition captained by John Sheppard (pack
  `atlantis`). Its research brief and design notes are in `docs/notes/`
  (`atlantis-research.md`, `atlantis-design.md`). It has no card art yet.

To add another crew, follow `docs/adding-a-custom-crew.md`: the whole flow
from research to painted art, with the lessons from MAL and SHP.

## Where the pieces live

For MAL (SHP's files have the same shape: `shp.json` and `custom/atlantis.json`):

| What                                       | Where                               | In git?         |
| ------------------------------------------ | ----------------------------------- | --------------- |
| Card mechanics (ids only, like STCC decks) | `src/data/cards/crew/mal.json`      | yes             |
| Crew board (tracks, 3 missions)            | `src/data/cards/boards/mal.json`    | yes             |
| Names, printed text, flavor (our own)      | `src/data/custom/firefly.json`      | yes             |
| Card template                              | `tools/custom/card-template.html`   | yes             |
| Art sources + art direction                | `tools/custom/firefly-art.json`     | yes (URLs only) |
| Downloaded art, your overrides             | `vendor/custom/firefly/`            | **no**          |
| Rendered faces, blank template             | `public/custom/firefly/`            | **no**          |
| Card number → face map                     | `vendor/custom/firefly.images.json` | **no**          |
| ChatGPT prompt kit                         | `vendor/custom/firefly/prompt-kit/` | **no**          |

The pack file uses the STCC record shape, so `addCustomPacks` (`src/data/stcc.ts`)
joins it to the same index the STCC data fills: names, printed text and faces
appear wherever STCC cards show them, and `tools/crosscheck-stcc.ts` checks the
pack against the card defs (suit, traits, VP, position, icons, missions). The
publish audit checks names against the real STCC data only. Custom cards
never replace an STCC record. Code-only builds (desktop, hosted) ship the names
but not the rendered faces (`vite.config.ts` drops `dist/custom`).

## Card art

```bash
npm run custom-cards        # download art, render 25 faces + template-blank.jpg
npm run custom-cards:kit    # build the ChatGPT prompt kit from the rendered faces
tools/custom/codex-art.sh 01 02 03   # paint those cards' art with Codex (your ChatGPT login)
npm run custom-cards        # re-render with the painted art
```

The renderer needs the fetched STCC icons (`npm run fetch-cards`) and Chrome or
Chromium (`CHROME_PATH` to override). Art sources in the manifest:
`commons:File:…` (freely licensed, credited on the card), `enwiki:File:…` and
`tmdb:<image id>` and `file:<path under vendor/custom/firefly/>` (stills from
the series: local use only, never published). `crop` pre-crops a download to a
face; `subject` and `notes` are the art direction the prompts use (with the
manifest's pack-wide `universe` and `palette`), and
`likeness: false` paints a card from its description alone (when the only
reference would mislead, like a real spacecraft for a fictional one).

To replace art, drop an image as `vendor/custom/firefly/override/<art key>.png`
(the keys are in the manifest); a whole finished face goes in
`override/faces/1MAL01-25.jpg`. Re-run `npm run custom-cards`.

The prompt kit holds, per card, an art-only prompt (recommended: our renderer
adds the exact rules text) and a whole-card prompt, with the card's text, our
rendered layout, the likeness still and printed cards as style reference.

`tools/custom/codex-art.sh` runs prompt A through the Codex CLI that ships with
the ChatGPT app (`codex exec` with OpenAI image generation, signed in with your
ChatGPT account), one card at a time, and saves each result as
`override/<art key>.png`. Character art is drawn chest-up with the face clear of
the name plates and trait badges; painted art fills the whole card behind the
text boxes, like the print. Each run counts against your ChatGPT plan, and its
log goes to `vendor/custom/firefly/codex-logs/`.

## The MAL deck (25 cards)

Theme: a smuggler crew that takes risky jobs. Many effects pay with INCIDENTs
(the Alliance and the Reavers), and the crew turns trouble into tempo:
Reynolds gains {DIL} and runs whenever an INCIDENT is taken, Book profits from
returning them, Simon patches them up, and Miranda scores them. The Burn is the
risk: take too many and the opponent wins outright. Reynolds scores every
PERSON beamed to your ships, but the board's missions dismiss the crew they
need, so the two pull against each other.

| #   | Card             | Suit      | Start       | Role                                                        |
| --- | ---------------- | --------- | ----------- | ----------------------------------------------------------- |
| 01  | Malcolm Reynolds | CAPTAIN   | —           | INCIDENT taken → {DIL} + warp; endgame VP per PERSON aboard |
| 02  | Serenity         | SHIP      | Deployed    | flagship; warps for {DIL} or {LAT}                          |
| 03  | River Tam        | PERSON    | Development | draw/filter; attack removes Away Teams                      |
| 04  | Simon Tam        | PERSON    | Reserve     | returns INCIDENTs, Research                                 |
| 05  | Shepherd Book    | PERSON    | Development | returns INCIDENTs; reaction: {GLO} per return               |
| 06  | Mr. Universe     | ALLY      | Development | Influence + Research, logs itself (3 VP)                    |
| 07  | Miranda          | LOCATION  | Development | take INCIDENT → 2 {GLO}; endgame VP per INCIDENT            |
| 08  | Vera             | CARGO     | Development | ongoing weapon; attack removes Away Teams                   |
| 09  | Lassiter         | CARGO     | Development | 2 {LAT}, then INCIDENT or discard (3 VP)                    |
| 10  | Niska's Skyplex  | LOCATION  | Development | jobs: INCIDENT → CARGO + {LAT}                              |
| 11  | Inara Serra      | PERSON    | Reserve     | {LAT} or Influence; buys {GLO}                              |
| 12  | Inara's Shuttle  | SHIP      | Reserve     | second ship (mission 3), beams a PERSON                     |
| 13  | Badger           | ALLY      | Reserve     | INCIDENT → CARGO + {LAT}; scan CARGO                        |
| 14  | Saffron          | PERSON    | Development | steals {LAT} / {DIL} (2 {DIL} to develop)                   |
| 15  | Reavers          | INCIDENT  | Reserve     | return with a WEAPON or 2 {DIL}, then flee                  |
| 16  | Into the Black   | DIRECTIVE | Available   | the deck's Utilize                                          |
| 17  | Signing On       | DIRECTIVE | Available   | the deck's Recruit                                          |
| 18  | Take the Job     | DIRECTIVE | Available   | INCIDENT → CARGO; buy a SHIP                                |
| 19  | Aim to Misbehave | DIRECTIVE | Available   | attack: Away Team + opponent discards                       |
| 20  | Alliance Patrol  | INCIDENT  | Available   | the deck's Red Alert, with a warp                           |
| 21  | Persephone       | LOCATION  | Available   | {LAT} + Influence; Away Team draws                          |
| 22  | Zoe Washburne    | PERSON    | Available   | Away Teams + Military                                       |
| 23  | Hoban Washburne  | PERSON    | Available   | warps 2 ships; reaction: warp → {DIL}                       |
| 24  | Kaylee Frye      | PERSON    | Available   | Research; refreshes ships                                   |
| 25  | Jayne Cobb       | PERSON    | Available   | attack: steal {LAT}; WEAPON → {GLO} + Military              |

Missions (Advanced side; Basic uses the first, 0 VP): **Crew and Cargo** (3+
PERSON on one SHIP and 2+ CARGO in play, 4 VP), **Can't Stop the Signal** (a
TELEPATH, a DOCTOR and a PILOT on one SHIP, 3 VP), **Big Damn Heroes** (2+
deployed SHIPs and Military 6, 3 VP).

### Balance

Measured with the House AI (Normal vs Normal, `tools/arena.ts`, MAL against the
six box-1 decks in both seat orders, seeds 1 and 7). In a mirror match both
halves of a seat-swapped pair are the same game, so each pair counts once:
600 independent games per row.

| Version                                 | MAL win rate | 95 % CI     | VP margin |
| --------------------------------------- | ------------ | ----------- | --------- |
| First version (Simon in Development)    | 36.6 %       | 32.8 – 40.5 | −3.3      |
| Simon in the Reserve, Saffron developed | **47.8 %**   | 43.8 – 51.7 | −0.3      |

For scale, the box-1 decks against each other under the same bot run from
about 67 % (KOL) to 22 % (SHR), with SEL near 53 %. The first version's
INCIDENT-return crew sat in Development, which a deck only reaches once its
Reserve is empty (turn 15 or later for most decks), so its INCIDENTs stayed at
−2 VP all game. Other tries: Book instead of Simon 44.9 %; Simon or Book in the
starting deck (Zoe to the Reserve) 50.8 % / 46.5 %; Book and Simon both in the
Reserve 55.6 % (too strong). Resource buffs alone (more {DIL}/{LAT} on Reynolds
and Take the Job) plateaued near 40 %.

Tests: `src/engine/mal-deck.test.ts` covers setup and the triggers no box-1 card
uses (SHIP_WARPED, INCIDENT_RETURNED), the either-resource warp and both
endgame counts. `tools/fuzz.ts` includes MAL in every pairing.

## The SHP deck (25 cards)

Theme: the Atlantis expedition runs on borrowed power and pays for it with
Wraith attention. The deck holds **one ZPM**, as the show does: deployed, it
feeds {DIL} and {GLO} every Resupply and lifts McKay, the Control Chair and the
Power the City mission. The big moments **dismiss** it (Atlantis's shield,
Carter's overload, driving off the Hive Ship), and the Daedalus, Zelenka and
Asuras bring it back. The risk is the Wraith: power plays cost INCIDENTs (Ford's
enzyme, the raid on Asuras, the deal with Todd, recruiting allies) and the Burn
is the loss. Unlike MAL, no card rewards taking an INCIDENT; Teyla, Beckett,
Keller and Todd clean them up. Atlantis is the flagship SHIP, modelled on Deep
Space 9 (`1SIS03`): it has no warp of its own.

| #   | Card                | Suit      | Start       | Role                                                       |
| --- | ------------------- | --------- | ----------- | ---------------------------------------------------------- |
| 01  | John Sheppard       | CAPTAIN   | —           | your SHIP warps → send an Away Team; endgame VP per SHIP   |
| 02  | Atlantis            | SHIP      | Deployed    | flagship, no warp; dismiss the ZPM to ignore an attack     |
| 03  | Elizabeth Weir      | PERSON    | Development | Influence + an ALLY; an extra Duty Officer                 |
| 04  | Jennifer Keller     | PERSON    | Development | returns up to 2 INCIDENTs; Research per return             |
| 05  | Samantha Carter     | PERSON    | Development | Research; dismiss the ZPM for 2 more and 2 cards           |
| 06  | Todd                | ALLY      | Development | attack: return your INCIDENT, opponent takes one (3 VP)    |
| 07  | Ancient Warship     | SHIP      | Development | attack: deploy and warp; opponent ship there → discard 2   |
| 08  | Control Chair       | CARGO     | Development | ongoing weapon; Military with the ZPM in play              |
| 09  | Asuras              | LOCATION  | Development | control: take an INCIDENT to find the ZPM, play it free    |
| 10  | Janus's Lab         | LOCATION  | Development | 2 Research; endgame VP per SCIENTIST                       |
| 11  | Ronon Dex           | PERSON    | Reserve     | attack: removes Away Teams; Away Team for 1 {DIL}          |
| 12  | Carson Beckett      | PERSON    | Reserve     | returns an INCIDENT; finds an AUGMENT (gene therapy)       |
| 13  | Daedalus            | SHIP      | Reserve     | finds the ZPM; beam or recall                              |
| 14  | ZPM                 | CARGO     | Reserve     | ongoing: 2 {DIL}; Resupply 1 {DIL} and 1 {GLO}             |
| 15  | Hive Ship           | INCIDENT  | Reserve     | return with the ZPM or 3 {DIL}                             |
| 16  | Naquadah Generators | DIRECTIVE | Available   | the deck's Utilize                                         |
| 17  | New Arrivals        | DIRECTIVE | Available   | the deck's Recruit                                         |
| 18  | Ancient Database    | DIRECTIVE | Available   | the deck's Analyze                                         |
| 19  | Culling             | INCIDENT  | Available   | the deck's Red Alert: lose an Away Team or top-deck a card |
| 20  | The Mainland        | LOCATION  | Available   | 2 {LAT}; Away Team draw                                    |
| 21  | Puddle Jumper       | SHIP      | Available   | warps free with an AUGMENT aboard                          |
| 22  | Rodney McKay        | PERSON    | Available   | draw/filter; {DIL} → Research, more with the ZPM           |
| 23  | Teyla Emmagan       | PERSON    | Available   | Influence, returns an INCIDENT; trade for ALLYs and {GLO}  |
| 24  | Aiden Ford          | PERSON    | Available   | Away Team + Military; take an INCIDENT for 2 Military      |
| 25  | Radek Zelenka       | PERSON    | Available   | Research; draws the ZPM back from the Discard pile         |

Missions (Advanced side; Basic uses the first, 0 VP): **The Gate Team** (a
SCIENTIST, a TELEPATH and a SECURITY beamed to one SHIP, and Research 4, 4 VP),
**Power the City** (the ZPM in play and Research 8, 3 VP), **Pegasus Alliance**
(2+ ALLYs in play and Influence 6, 3 VP). Tracks: Picard's.

### Balance

Measured like MAL: House AI Normal vs Normal, SHP against the six box-1 decks
and MAL in both seat orders, seeds 1 and 7, 600 independent games per row.

| Version                                    | SHP win rate | 95 % CI     | VP margin |
| ------------------------------------------ | ------------ | ----------- | --------- |
| First version                              | 40.1 %       | 36.2 – 44.1 | −2.7      |
| ZPM Resupply also gains 1 {GLO}            | 45.8 %       | 41.9 – 49.8 | −1.1      |
| Teyla's trade also gains 1 {GLO} (2 {LAT}) | 54.3 %       | 50.3 – 58.3 | +1.1      |
| Teyla's trade costs 3 {LAT} (kept)         | **47.2 %**   | 43.2 – 51.2 | −1.0      |

The first version raised Research well (4.3 against its opponents' 1.7) but
lost on Glory (6.8 against 10.2). The House AI completes few missions, so
focus icons rarely score and Research alone wins little. The changes add Glory
where the theme puts it: the city at full power, and Teyla's trading. At 2
{LAT} Teyla's trade was worth more than intended; at 3 SHP sits next to MAL.
Per opponent (final version): SHR 67.9 %, SIS 55.1 %, MAL 48.2 %, PIC 44.3 %,
SEL 43.8 %, KOL 38.7 %, BUR 32.1 %. No game ended in the Burn, and the House
AI had no fallbacks and no stalled games.

Tests: `src/engine/shp-deck.test.ts` covers setup, the ZPM (deploy, Resupply,
the shield, the Hive Ship, Zelenka, Asuras, McKay's bonus), the Jumper's gene
gate, Sheppard's reaction and endgame, Culling, Todd and Weir's extra Duty
Officer. `tools/fuzz.ts` includes SHP in every pairing.
