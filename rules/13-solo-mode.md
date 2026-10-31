# 13. Solo Mode vs the Bot (solo rulebook)

Source: the separate solo rulebook ("Starfleet Command Training Program", WizKids 2024, 20 pages).
It is not included here; `solo p.N` points back to it. The core rules apply unless this chapter
says otherwise. "You" is the human player, "the Bot" is the automated opponent.

The Bot's per-crew lookup tables are the **Automated Command (AC) cards**. Their text is in the
STCC database (`data/bots.json`, fetched by `npm run fetch-cards`, never committed). Our mechanics
for each row are in `src/data/cards/solo/bots.json`.

Easier than this mode: Cadet Training (`rules/10`), which has no opponent at all.

## 13.1 Overview (solo p.1)

- The Bot never reads the text of its own cards. It resolves each card by looking up the card's
  traits and suit on its AC cards (§13.6). The one exception is a SURPRISE operation (§13.6.3).
- The Bot gains Glory and Specialties like you. Apart from that it normally gains no resources
  (§13.10).
- **You win** only if you have **more** VP than the Bot after scoring. A tie is a loss.
- **If the Burn happens, the Bot wins**, however many INCIDENTs either side holds.

## 13.2 Setup (solo p.1–2)

1. Choose a difficulty: **Ensign < Lieutenant < Commander < Captain < Admiral**.
2. Do the normal common setup, with these changes:
   - Use the five Stardate cards marked "Solo vs ⟨difficulty⟩ Bot" (SD08–SD32,
     `src/data/stardate.ts`). Each one also shows the **number of Bot actions** for that Stardate.
   - The Bot gets no Action tokens and no Mission Completion tokens.
   - **You are always the starting player.**
3. Set yourself up as normal.
4. Return the two solo Directives (Reinforce, Conspiracy) to the box. Exceptions: §13.14 and
   `rules/14`.
5. Bot board: its crew board goes Basic side up, with 3 Specialty markers on zero. Its Captain goes
   to the right of the board, with its Away Team tokens on the Captain. A Status card goes back to
   the box. The Bot has no Mission; it ignores missions entirely.
6. Sort the Bot's crew deck by position indicator. INCIDENT DECK cards were already shuffled into
   the common Incident deck in step 2.
7. **Supplement deck:** shuffle its DEVELOPMENT cards face down. Shuffle its RESERVE cards and put
   them face down on top.
8. **Bot deck:** shuffle its AVAILABLE cards face down. Shuffle its DEPLOYED and CONTROLLED LOCATION
   cards together (if any) and put them face down on top.
9. **Bot Discard pile:** its DISCARD cards, face up.
10. Leave room for two rows:
    - **Control Area:** its Duty Officer, controlled LOCATIONs, and deployed SHIPs in deploy order.
    - **Staging Area:** the cards being resolved.
11. Put the Bot's two AC cards next to it: TRAITS, and SUITS on its "no Duty Officer" side.
12. **The Bot starts with no resources at all**, not even Glory.
13. You may not choose the same crew as the Bot. (This is our rule: there is only one copy of each
    crew deck.)

## 13.3 Card value (solo p.3)

The Bot often picks "the most valuable" card in the Market or Neutral Zone. A card's **value to the
Bot** is what it would score for the Bot if the game ended right after the Bot gained it:

| Part                     | Adds                                                        |
| ------------------------ | ----------------------------------------------------------- |
| printed VP               | that number (it can be negative)                            |
| each Focus icon          | the Bot's current multiplier on that Specialty's track      |
| an ENDGAME operation     | 5                                                           |
| each Glory token on it   | 1 (other resource tokens, e.g. Dilithium, add nothing)      |

- **Ties:** the card with more resource tokens of any kind wins. If still tied, the **leftmost**
  wins, whether the Bot wants the most or the least valuable card. Market left-to-right is
  PERSON, CARGO, SHIP, ALLY. Neutral Zone left-to-right is slot order.
- **Value to you:** the same sum, using **your** multipliers. "Least valuable to you" picks the
  lowest; "most valuable to you" picks the highest.

## 13.4 The Bot's turn (solo p.4)

1. **Resupply:** skipped.
2. **Control:**
   - If the Bot has secured a neutral LOCATION, it takes control of it as normal. You gain Glory for
     your tokens there as usual. If it has secured more than one, it takes the **most valuable**.
   - Refill the Neutral Zone as usual.
   - Move the LOCATION to its Control Area and **resolve it** (§13.6). It stays there unless that
     resolution logged it.
3. **Action:**
   - Draw as many cards from the Bot deck as the current Stardate card's **Bot actions**. This may
     reshuffle (§13.5). Lay them face down in a row in the Staging Area.
   - Flip the first card and resolve it fully, then the next, and so on.
   - A card resolved as a side effect (§13.8) is extra: it does not count against the Bot actions.
4. **Clean-up:**
   1. If a Stardate card is in the Bot's Staging Area (you emptied it on your turn), do its effect
      as in the core rules, then remove it.
   2. Discard everything left in the Bot's Staging Area.
   3. Choose the Market card **least valuable to you**. Ties: fewer resource tokens, then leftmost.
      Put 1 Glory on it, from the Stardate card, or from the supply once the end has been
      triggered. If that empties the Stardate card, follow the core rules: it goes to your Staging
      Area and the next one is refilled.
   - **Burnham Bot:** in step 3, instead discard 1 Glory from the Stardate card and put
     **2 Dilithium** from the supply on the chosen card.

## 13.5 Reshuffling the Bot deck (solo p.4)

Whenever the Bot needs its deck (to draw, discard, inspect …) and the deck is empty:

1. Shuffle its Discard pile into a new Bot deck. The Staging Area is not included.
2. Put the **top card of the Supplement deck** on top.
3. Carry on.

This is the Bot's version of enlisting. It makes no difference between Reserve and Development
cards, and pays nothing.

## 13.6 Resolving a card with the AC cards (solo p.5–6)

### 13.6.1 Finding the row

1. Look down the **TRAITS** card from top to bottom. The **first** row naming a trait the card has
   is the match. Stop there.
   - A **WILDCARD** card matches the **first trait row**. The SURPRISE reminder above the rows does
     not count as a row.
2. If there is no trait match, use the **SUITS** card row for the card's suit. Use whichever side is
   face up: "no Duty Officer" or "with Duty Officer" (§13.7).
3. Perform that row, **whatever the card's printed text says**.

### 13.6.2 Row vocabulary

- **"This card"** is the card being resolved.
- Rows are read in order. "Otherwise" refers to the "if" / "if able" just before it.
- "**If able to do both**, A and B to C … Otherwise D" means: if A and B can both be done, do A,
  B and C; otherwise do D.
- "Gain 1 X / Y (whichever is lower/higher)": compare the two tracks. Ties go to the topmost
  track, Research > Influence > Military (solo p.5).
- The Bot gains Specialties exactly like you.

### 13.6.3 SURPRISE

A card with the SURPRISE trait has a SURPRISE (Bot only) operation. When the Bot resolves it, it
performs that operation and ignores the AC cards. This is the only time the Bot resolves printed
text during play.

### 13.6.4 LOCATIONs

A LOCATION still in the Staging Area after its resolution moves to the Control Area, whichever row
it matched. A row that logs "this card" is the exception: the LOCATION stays logged.

## 13.7 The Bot's Duty Officer (solo p.7)

- When a row promotes a PERSON, it moves out of the Staging Area to the front of the Control Area.
  The SUITS card flips to "**with** Duty Officer".
- **The limit is one.** A new promotion dismisses the previous Duty Officer to the Bot Discard pile.
- If any effect, yours or the Bot's, dismisses or logs its Duty Officer for any other reason, the
  SUITS card flips back to "**no** Duty Officer".
- If an effect would make the Bot **recall** its Duty Officer, it is **dismissed** instead.
- The Duty Officer's own traits don't matter. Having one simply makes the Bot's suit rows stronger.

## 13.8 Discard-pile lookups and resolving other cards (solo p.7)

- "… a SHIP (or trait X) from the Bot Discard pile" always means the **topmost** card that matches,
  i.e. the most recently discarded one.
- When a row says to resolve another card (top of the Bot deck, top of the Supplement, a card just
  gained):
  - put it face up in the Staging Area and resolve its own row right away;
  - then return to the first card's row and continue.
  - It does not use up a Bot action.

## 13.9 INCIDENTs and unspecified choices (solo p.7)

- If the Bot would **log** an INCIDENT, it **returns** it to the Incident deck instead.
- If one of your effects offers the Bot to return an INCIDENT, it **declines**.
- For any other choice your effects force on the Bot, it takes the **first listed option it legally
  can**, even if that option does nothing.

## 13.10 Market and resources (solo p.8–9)

### 13.10.1 Gaining and taking

- A Bot effect that gains or takes "a card with X" chooses from the face-up Market only, never from
  a Market deck top.
- **"A > B":** if any card has A, take the most valuable card with A. Otherwise take the most
  valuable card with B.
- **"A / B":** take the most valuable card that has A or B (or both).
- Precedence: **">" is resolved before "/"**.
  - "A > B / C" = A if possible, else the best card with B or C.
  - "A / B > C" = the best card with A or B if possible, else C.
- If a suit's deck has run out, the chain simply falls through to the next term.
- Destination:
  - **gain** → the card goes to the Bot Discard pile;
  - **take** → the card goes **on top of the Bot deck**. Bot rows may "take" Market suits.
  - A card your effects give to the Bot, or force it to take (usually an INCIDENT), also goes on
    top of the Bot deck.
- Resources on a gained or taken card go to the Bot.

### 13.10.2 Junking

"Junk the most valuable card in the Market (ignoring any with tokens)" junks the card **most
valuable to you**. Like you, the Bot can never junk a card with tokens on it.

### 13.10.3 Resources

- **Glory:** the Bot's Glory comes from the Stardate card, or from the supply after the end has
  been triggered, exactly as for you. If the Stardate empties on the Bot's turn, follow the core
  rules.
- **Dilithium and Latinum:** the Bot gets them only in two cases:
  - Burnham is in the game (on either side), so Dilithium can sit on Market cards the Bot gains;
  - one of your effects explicitly gives the Bot resources.

## 13.11 Neutral Zone (solo p.9)

### 13.11.1 General restrictions

- The Bot never moves Ship or Away Team tokens to a LOCATION in its own Control Area.
- It never moves them to a neutral LOCATION it already holds with more than enough to secure, i.e.
  with **4+ tokens and at least 3 more than you**.

### 13.11.2 Deploying, exploring, engaging

- **Deploy a SHIP:** move it to the Control Area with its Ship token on it. Keep deployed SHIPs in
  deploy order.
- **"It explores":** warp its Ship token to the neutral LOCATION with the **fewest tokens in total**.
  Ties go to the most valuable.
- **"It engages":** warp to the neutral LOCATION where **you have the most tokens**. Ties go to the
  most valuable.
- If one of your effects makes the Bot recall or dismiss a deployed SHIP, the SHIP is discarded.
  When the Bot has a choice, it gives up the **most recently deployed** one.

### 13.11.3 Sending Away Teams

- Move one Away Team from the Bot's Captain to a neutral LOCATION.
- **Illegal targets:** like you, the Bot can't send to a LOCATION where you have more Ship tokens,
  unless the row says so.
- **Target:** the LOCATION where the **Bot already has the most tokens**. Ties, including zero, go to
  the most valuable.
- A **trait preference** ("to STARBASE > STARFLEET > LOCATION") comes first: try the first trait,
  then the next, then any LOCATION. Within each step the token rule applies.
- **No Away Team left on its Captain:** it moves one from the LOCATION where it has the **fewest**
  tokens (never the target). Ties go to the least valuable to the Bot.

## 13.12 Direct interaction (solo p.10)

### 13.12.1 The Bot attacks you

- A row part that hurts you is an attack. It is printed in red on the AC card (`@…/@` in the STCC
  text). It is an attack whether or not the card being resolved has the ATTACK trait.
- You carry out the red part yourself. For example, "you remove an Away Team" means you choose
  which one.
- Your REACTIONs to being attacked trigger.
- Cancelling an attack cancels **only the red part, and all of it**. The rest of the row still
  resolves.
- **A cancelled attack still counts as performed.** So an "Otherwise …" after "If able, you …"
  does **not** happen.
- Non-red parts that affect you are not attacks. They are printed in bold.

### 13.12.2 You attack the Bot

- **Hand attacks** (reveal, force a discard from hand …) do nothing, because the Bot has no hand.
  The same goes for attacks that make the Bot **find** a card or **choose from its own Discard
  pile**. **You decide** whether such an attack succeeded or failed. This matters for clauses like
  "if they do …" or "if they cannot …".
- This is different from an attack that makes the Bot choose between two negative effects. There
  it takes the first listed option it legally can (§13.9).
- **Steal** always succeeds, even "steal Glory". Take the stolen resources **from the supply**.
  - This does not count as gaining them, for example for a REACTION.
  - You never take resources away from the Bot, even when it has some.

### 13.12.3 You help the Bot

- If your effect lets or makes the Bot **draw**, discard the top card of the Bot deck instead.
- It declines INCIDENT returns (§13.9).
- Resources you give the Bot are gained normally: Dilithium and Latinum from the supply, Glory from
  the Stardate card.

## 13.13 End of the game and scoring (solo p.4–5)

### 13.13.1 When the game ends

- **The Burn:** the Bot wins at once.
- **Otherwise:** when the 5th Stardate card empties, finish the current round and play one more
  full round. You always start, so **the game always ends with a Bot turn**. Then both sides score.

### 13.13.2 Your score

Core rules.

### 13.13.3 The Bot's score

- **No missions.** It still scores its Specialty tracks × Focus icons, without completing one.
- **Printed VP:** normally.
- **5 VP per ENDGAME operation it owns**, instead of evaluating it. This counts whether or not the
  card is in play, and includes its Captain.
- **Glory:** 1 VP each.
- **Dilithium and Latinum:** 1 VP per 2. **Burnham Bot:** 1 VP per Dilithium.
- **Asterisk VP:** a card the Bot owns with an asterisk VP still resolves its SPECIAL scoring
  operation. Scoring happens outside play.

## 13.14 Conspiring Admirals challenge (solo p.7)

A harder setting for the Captain and Admiral levels. Shuffle the **Conspiracy** solo Directive
into the Bot's AVAILABLE cards during setup.

- It has the SURPRISE trait, so the Bot resolves its SURPRISE operation (§13.6.3). That operation
  offers **you** a choice. One option moves the card into your Draw deck, where it counts against
  your score. It is destroyed before scoring only if the Bot owns it or it has been logged.
- Its full text is in STCC; its mechanics are in `src/data/cards/solo/directives.json`.

## 13.15 Engine mapping

| Rule                            | Code                                                           |
| ------------------------------- | -------------------------------------------------------------- |
| mode, setup, Bot zones          | `src/engine/solo/setup.ts`, `GameState.solo`                   |
| the Bot's turn (BOT_STEP beats) | `src/engine/solo/turn.ts`                                      |
| row lookup                      | `src/engine/solo/classify.ts`, `src/data/cards/solo/bots.json` |
| card value, Location picks      | `src/engine/solo/value.ts`, `src/engine/solo/rank.ts`          |
| choices forced on the Bot       | `src/engine/solo/policy.ts`                                    |
| Bot scoring                     | `src/engine/solo/scoring.ts`                                   |

Interpretations the solo rulebook leaves open are logged in `docs/card-rulings.md` (entries from
052 on).
