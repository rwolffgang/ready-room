# Star Trek: Captain's Chair — Rules (structured for implementation)

Source: _Star Trek: Captain's Chair_ core rulebook, WizKids, 2024 (36 pages).
Designers: Dávid Turczi & Nigel Buckle. The rulebook itself is not included here.

These files are a **restructured, implementation-oriented** rendering of the rules — reorganised
so that every rule is stated as a testable condition. They are not a substitute for the
rulebook; page references point back to it.

> **Precedence rule from the rulebook itself (p.8):** if the _Keywords in Detail_ section
> contradicts an earlier section, _Keywords in Detail_ wins. In code, that means
> [`08-keywords-reference.md`](08-keywords-reference.md) is the authoritative spec for any
> keyword; the narrative chapters are context.

| File                                                                     | Covers                                                       | Rulebook pages   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------- |
| [01-overview-and-components.md](01-overview-and-components.md)           | Game premise, win condition, full component list             | 1–3              |
| [02-setup.md](02-setup.md)                                               | Central setup, player setup, table layout                    | 4–7              |
| [03-turn-structure.md](03-turn-structure.md)                             | Resupply / Control / Action / Clean-up                       | 8–13             |
| [04-game-concepts.md](04-game-concepts.md)                               | Deck cycling, Reserve, Development, resources                | 8, 14            |
| [05-cards-suits-traits.md](05-cards-suits-traits.md)                     | Suits, traits, operation types, gaining cards                | 10–11, 15–16     |
| [06-locations-ships-away-teams.md](06-locations-ships-away-teams.md)     | Locations, Neutral Zone, ships, warping, Away Teams, beaming | 18–19            |
| [07-missions-specialties-scoring.md](07-missions-specialties-scoring.md) | Specialties, missions, Captain's Log, final scoring          | 17, 20–21, 24–25 |
| [08-keywords-reference.md](08-keywords-reference.md)                     | **Authoritative** keyword definitions (A–Z)                  | 29–33            |
| [09-icon-reference.md](09-icon-reference.md)                             | Every icon, suit, trait — with machine IDs                   | 26–27, 36        |
| [10-cadet-training-mode.md](10-cadet-training-mode.md)                   | Solo practice mode                                           | 28               |
| [11-crew-decks.md](11-crew-decks.md)                                     | The six captains, complexity, Burnham's special rules        | 34–35            |
| [12-edge-cases-and-rulings.md](12-edge-cases-and-rulings.md)             | Cross-cutting edge cases collected from all pages            | —                |
| [13-solo-mode.md](13-solo-mode.md)                                       | Solo play vs the Bot (Automated Command cards)               | solo 1–15, 20    |
| [14-five-year-mission.md](14-five-year-mission.md)                       | The Five-Year Mission solo campaign                          | solo 16–19       |

## Reading order for an implementer

1. `03` (turn loop) → the outer state machine.
2. `08` (keywords) → the effect vocabulary; this is your DSL.
3. `05` + `06` + `07` → the state that effects mutate.
4. `12` → the nasty bits that will break a naive implementation.

## Not covered here

- **Solo rulebook text.** `13` and `14` restate the separate solo rulebook ("solo p.N"); the
  Automated Command card text itself lives in the fetched STCC data (`data/bots.json`).
- **Expansions.** _To Boldly Go_ and _Second Contact_ have their own rulebooks.
- **Individual card text.** Card-by-card effects come from your spritesheets; see
  `todo/11-card-authoring-tool.md`.
