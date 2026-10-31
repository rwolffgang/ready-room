// Rules-conformance suite (todo/16-testing.md §1). ONE describe block per
// numbered edge case in rules/12-edge-cases-and-rulings.md (§12.1 … §12.30),
// each named after its section so a failure points straight at the rule.
//
// Where a ruling is already covered by an existing test, the group carries a
// pointer comment plus a marker `it` that names the covering tests (keep it
// DRY — no duplicated fixtures). Genuinely uncovered rulings get a small
// fixture-built test here; two of them (§12.23, §12.26) were real engine gaps,
// fixed in src/engine (draw.ts / phases.ts / completeMission.ts).
//
// Fixtures are hand-built CardDefs (resolver/testUtils) so a failure can be
// read in one screen, never the full catalog.

import { describe, expect, it } from 'vitest'
import { CardDefSchema } from '../data/schema'
import {
	NOT_IN_THIS_BOX,
	NOT_IN_THIS_BOX_SUITS,
	NOT_IN_THIS_BOX_TRAITS,
} from '../data/ids'
import {
	fresh,
	register,
	makeDef,
	place,
	pushAndRun,
	op,
	ID,
	setActions,
} from './resolver/testUtils'
import { reduce } from './intents'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { runCollecting } from './resolver/stack'
import {
	moveCard,
	player,
	inPlayCards,
	zoneKey,
	type GameState,
	type MissionState,
	type GameEvent,
	type EffectCtx,
} from './state'
import { canActivate, canComplete } from './queries/legality'
import { gainResource } from './resolver/runtime'
import { drawCards } from './resolver/primitives/draw'
import { referencesUnprinted, warnUnprinted } from './market'
import { assertSerialisable } from './invariants'
import type { Effect } from './resolver/nodes'
import type { CardInstanceId } from './ids'

const gain = (res: 'DIL' | 'LAT' | 'GLO', amount: number): Effect => ({
	k: 'GAIN_RESOURCE',
	res,
	amount,
})

/** A mission on seat 0's board, uncompleted. */
function mission(
	goal: MissionState['goal'],
	reward: MissionState['reward'] = { k: 'NOOP' },
): MissionState {
	return {
		index: 0,
		goal,
		reward,
		vp: 5,
		completed: false,
	}
}

function withMission(s: GameState, m: MissionState): GameState {
	const players = s.players.map((pl) =>
		pl.seat === 0 ? { ...pl, missions: [m] } : pl,
	) as GameState['players']
	return { ...s, players }
}

/** Auto-answer every PendingChoice with the first legal selection (todo/09
 *  idiom — covers every kind, including CHOOSE_WITNESS / CHOOSE_WILDCARD_AS). */
function firstPick(c: PendingChoice): unknown {
	switch (c.k) {
		case 'CONFIRM':
			return true
		case 'CHOOSE_CARDS':
			return c.candidates.slice(0, c.min)
		case 'CHOOSE_LOCATION':
			return c.candidates[0]
		case 'CHOOSE_SUIT':
			return c.suits[0]
		case 'CHOOSE_TRAIT':
			return c.traits[0]
		case 'CHOOSE_SPECIALTY':
			return c.specialties[0] ?? 'RESEARCH'
		case 'CHOOSE_DESTINATION':
			return c.options[0] ?? 'DECK_TOP'
		case 'CHOOSE_AMOUNT':
			return c.max
		case 'ORDER_OPERATIONS':
			return c.pending
		case 'OPTIONAL_TRIGGERS':
			return c.offered
		case 'CHOOSE_WITNESS':
			return c.sets[0]
		case 'CHOOSE_WILDCARD_AS':
			return c.traits[0]
		case 'ORDER_CARDS':
			return c.cards
		case 'CHOOSE_OPTION': {
			const opt = c.options.find((o) => o.enabled) ?? c.options[0]!
			return { key: opt.key }
		}
	}
}

/** Drive any stack/choice state to a halt, answering every pending choice with
 *  `pick` and collecting every drained event (todo/08 idiom). */
function drive(
	state: GameState,
	pick: (c: PendingChoice) => unknown,
): { state: GameState; events: GameEvent[] } {
	let s = state
	const events: GameEvent[] = []
	let guard = 0
	while (
		s.result === null &&
		(s.pendingChoice !== null || s.stack.length > 0)
	) {
		if (++guard > 2000) throw new Error('drive: too many iterations')
		if (s.pendingChoice !== null) {
			const c = s.pendingChoice
			s = applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: pick(c),
			})
		}
		const r = runCollecting(s)
		s = r.state
		events.push(...r.events)
	}
	return { state: s, events }
}

// ---------------------------------------------------------------------------
// §12.1 … §12.30 — one group per numbered ruling in rules/12
// ---------------------------------------------------------------------------

describe('rules/12 §12.1 — cost vs. benefit', () => {
	// POINTER: resolver/primitives/payThen.test.ts — "PAY_THEN: cost
	// pre-validation" (an unpayable cost refuses the whole operation before any
	// mutation) and "§5: unresolvable benefits are skipped, sequence continues"
	// (spend 2 DIL, gain CARGO + draw 1 with an empty CARGO offer → still pays
	// and draws, the gain is skipped). Cross-checked by resolver/probe.test.ts
	// "an unpayable cost probes false" (the dry-run gate behind canPlay).
	it('pointer — covered by payThen.test.ts / probe.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.2 — play legality is determined by resolvability', () => {
	// POINTER: queries/legality.test.ts — canPlay includes "an unpayable cost
	// chain makes the effect unresolvable (probe dry-run)"; the dry-run itself is
	// resolver/probe.test.ts (side-effect free, first legal selection per choice).
	it('pointer — covered by queries/legality.test.ts / probe.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.3 — the Staging Area is a weird zone', () => {
	// POINTER: zoneProps.test.ts row "STAGING: in play, counts, NO table ops,
	// unordered, public (rules/12 §12.3)"; phases.test.ts "Staging-Area cards
	// fire their CLEAN-UP operations (rules/12 §12.3)"; queries/counting.test.ts
	// counts staged skill icons.
	it('pointer — covered by zoneProps / phases / counting tests (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.4 — self-logging cards are never in play for counting', () => {
	// A PLAY operation that ends "Log this card" (p.21): the card is in LOG, not
	// in play, once the operation lands — no moment remains at which its
	// suit/traits are countable.
	it('a "Log this card" PLAY leaves the card in LOG, not in play', () => {
		register([
			makeDef({
				id: 'logger',
				suit: 'PERSON',
				operations: [op('PLAY', { k: 'LOG', target: 'THIS' })],
			}),
		])
		let s = fresh()
		s = place(s, 'logger', ID('lg1'), { k: 'HAND', seat: 0 }, 0)
		const { state, events } = reduce(s, {
			t: 'PLAY_CARD',
			iid: ID('lg1'),
			operationIndex: 0,
		})
		expect(state.cards[ID('lg1')]!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(inPlayCards(state, 0)).not.toContain(ID('lg1'))
		expect(events.some((e) => e.k === 'CARD_PLAYED')).toBe(true)
		expect(events.some((e) => e.k === 'PUT_INTO_PLAY')).toBe(false)
		assertSerialisable(state)
	})
})

describe('rules/12 §12.5 — beamed cards: in play, but crippled', () => {
	// POINTER: zoneProps.test.ts row "BEAMED: in play, counts traits, NO skills,
	// NO table ops, public (rules/12 §12.5)"; queries/counting.test.ts
	// "countSkillIcons (rules/12 §12.3/§12.5)" — beamed skill icons never count;
	// the beamed-contribution dismissal is §12.26 below.
	it('pointer — covered by zoneProps / counting tests (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.6 — cascade semantics', () => {
	// POINTER: moveCard.test.ts "moveCard cascades (todo/05 §3)" — "beam 2 to a
	// SHIP, dismiss the SHIP → all 3 in Discard"; "dismiss the beamed card → the
	// SHIP is untouched"; "a LOCATION leaving play dismisses its Ships, returns
	// Away Teams and detaches modifiers".
	it('pointer — covered by moveCard.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.7 — action tokens are reminders, not locks', () => {
	// A token never blocks ACTIVATION; dismiss/recall/log move the token with
	// the card and never refund the action (rules/08 → dismiss).
	it('a token on a FLEET card does not block its ACTIVATION', () => {
		register([
			makeDef({
				id: 'tokship',
				suit: 'SHIP',
				operations: [op('ACTIVATION', gain('DIL', 1), { costsAction: true })],
			}),
		])
		let s = fresh()
		s = setActions(s, 0, 1)
		s = place(s, 'tokship', ID('s1'), { k: 'FLEET', seat: 0 }, 0, {
			actionTokens: 1,
		})
		expect(canActivate(s, 0, ID('s1'), 0).ok).toBe(true)
		const { state } = reduce(s, {
			t: 'ACTIVATE',
			iid: ID('s1'),
			operationIndex: 0,
		})
		expect(player(state, 0).resources.DIL).toBe(1)
		expect(state.cards[ID('s1')]!.actionTokens).toBe(1) // the reminder survives the activation
		assertSerialisable(state)
	})

	it('dismissing a card moves the token with it and never refunds the action', () => {
		register([makeDef({ id: 'tokcard', suit: 'PERSON', operations: [] })])
		let s: GameState = fresh()
		s = {
			...s,
			players: s.players.map((pl) =>
				pl.seat === 0 ? { ...pl, actions: { available: 0, spent: 3 } } : pl,
			) as GameState['players'],
		}
		s = place(s, 'tokcard', ID('c1'), { k: 'FLEET', seat: 0 }, 0, {
			actionTokens: 1,
			exhausted: true,
		})
		const before = player(s, 0).actions
		s = moveCard(s, ID('c1'), { k: 'DISCARD', seat: 0 }) // a dismiss
		expect(s.cards[ID('c1')]!.actionTokens).toBe(1) // set aside as a reminder, not refunded
		expect(player(s, 0).actions).toEqual(before)
		assertSerialisable(s)
	})
})

describe('rules/12 §12.8 — gain ≠ take ≠ steal ≠ enlist ≠ find', () => {
	// POINTER: todo09.test.ts event-emission table — gain/scan resolve through
	// GAIN and emit the "when you gain" triggers; take/find/enlist/steal do NOT
	// (todo/09 §1: "steal/take don't fire the gain triggers"). rules/08 →
	// take/steal/gain.
	it('pointer — covered by todo09.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.9 — the Stardate handoff can fire mid-effect', () => {
	it('empties the current card, hands it to the inactive player, refills, then continues the same effect', () => {
		let s = fresh()
		s = {
			...s,
			stardates: { pile: [ID('sd1'), ID('sd2'), ID('sd3')], gloryOnTop: 2 },
		}
		s = gainResource(s, 0, 'GLO', 3)
		expect(player(s, 0).resources.GLO).toBe(3)
		expect(player(s, 1).heldStardate).toBe(ID('sd1')) // handed over mid-effect, not at a step boundary
		expect(s.stardates.pile).toEqual([ID('sd2'), ID('sd3')]) // the emptied card left the pile
		expect(s.stardates.gloryOnTop).toBe(2) // sd2 refilled (3), then the remaining gain drained it to 2
		expect(s.resolutionTriggered).toBe(false)
		assertSerialisable(s)
	})

	it('the last Stardate is not handed over: it triggers a Resolution and the gain continues from the supply', () => {
		let s = fresh()
		s = { ...s, stardates: { pile: [ID('sd1')], gloryOnTop: 2 } }
		s = gainResource(s, 0, 'GLO', 5)
		expect(player(s, 0).resources.GLO).toBe(5) // all 5 still gained, the remainder from the supply
		expect(player(s, 1).heldStardate).toBeNull()
		expect(s.stardates.pile).toEqual([ID('sd1')])
		expect(s.resolutionTriggered).toBe(true)
		assertSerialisable(s)
	})
})

describe('rules/12 §12.10 — Resolution changes the Glory source globally', () => {
	// POINTER: endgame.test.ts "Resolution — final Stardate card (rules/12
	// §12.9–§12.10)" — includes "after Resolution, all Glory comes from the
	// supply (already triggered)".
	it('pointer — covered by endgame.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.11 — the Burn is an immediate, continuous check', () => {
	// POINTER: endgame.test.ts "The Burn (rules/03 §3.1, rules/12 §12.11)" —
	// fires when the last INCIDENT is taken, Reserve excluded, Burn beats Glory;
	// m1-exit.test.ts "Game 2 (Burn path)" (full scripted game);
	// phases.test.ts "Burn during the extra turns ends the game immediately
	// (takes priority)".
	it('pointer — covered by endgame / m1-exit / phases tests (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.12 — WILDCARD is opt-in and scoped', () => {
	// POINTER: queries/traits.test.ts matchTrait — "a WILDCARD matches only when
	// allowWildcard (never compelled)"; scoring.test.ts "a WILDCARD satisfies no
	// scoring predicate (12.12) — but does satisfy a goal".
	it('pointer — covered by traits / scoring tests (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.13 — duplicate has three special behaviours', () => {
	// POINTER: resolver/primitives/duplicate.test.ts — §7.1 self-reference
	// redirection, §7.2 impossible sub-effects skipped, §7.3 nested duplicate is
	// a no-op, §7.4 no extra action cost, §7.5 specialty gates still apply.
	it('pointer — covered by resolver/primitives/duplicate.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.14 — force inverts choice ownership', () => {
	// POINTER: resolver/primitives/force.test.ts — "the active player decides
	// (seat = you)" vs "the OPPONENT decides (seat = them)", and "an entirely
	// unresolvable forced effect is ignored"; resolver/choices.test.ts covers
	// choice validity and resumption.
	it('pointer — covered by force.test.ts / choices.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.15 — Away Team placement is blocked by Ship tokens only', () => {
	// POINTER: queries/board.test.ts "canSendAwayTeam (rules/12 §12.15)" — "more
	// opponent Ship tokens blocks; a tie does not", "Away Teams never block",
	// "a controlled Location is always allowed"; todo08.test.ts SEND_AWAY_TEAM.
	it('pointer — covered by board.test.ts / todo08.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.16 — warping is one-way off the card', () => {
	// POINTER: todo08.test.ts "WARP & DEPLOY (todo/08 §7, rules/12 §12.16)" —
	// staying put is not warping, a token never returns to the card; moveCard.test.ts
	// "recall sends the Ship token to the SUPPLY, never back onto the card".
	it('pointer — covered by todo08.test.ts / moveCard.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.17 — taking control pays the opponent only', () => {
	// POINTER: todo08.test.ts "TAKE_CONTROL" — 1 Glory per token the opponent
	// had there; your own losses pay nothing; both sides' tokens are cleared.
	it('pointer — covered by todo08.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.18 — a Location RESUPPLY does not fire on the takeover turn', () => {
	// POINTER: phases.test.ts "a secured Location offers CHOOSE_LOCATION with a
	// Skip; taking control refills the Neutral Zone" — REGRESSION (todo/06 DoD,
	// rules/12 §12.18): the Location's RESUPPLY op does NOT fire this turn —
	// Resupply already passed before the Control Step.
	it('pointer — covered by phases.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.19 — junking vs. wiping', () => {
	// POINTER: todo08.test.ts "JUNK & WIPE_MARKET (todo/08 §5, rules/12 §12.19)"
	// — you may never junk a Market card that has resource tokens; a Stardate
	// wipe clears the tokens to the supply and junks the card anyway.
	it('pointer — covered by todo08.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.20 — Neutral Zone wipes spare occupied Locations', () => {
	// POINTER: todo08.test.ts "WIPE_NEUTRAL_ZONE (todo/08 §6, rules/12 §12.20)"
	// — junks only zero-token Locations; occupied Locations survive untouched.
	it('pointer — covered by todo08.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.21 — hand size is not a hand limit', () => {
	// POINTER: phases.test.ts "7 cards in hand with hand size 5 → draw 0,
	// discard 0 (unless chosen), end with 7". The Clean-up draw-to-cap seam
	// (drawCards untilHandSize) is shared with §12.23 below.
	it('pointer — covered by phases.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.22 — deck cycling can happen many times in one draw', () => {
	// POINTER: resolver/primitives/draw.test.ts — "drawing 6 from a 1-card deck
	// with 3 Reserve enlists each Reserve in order, drawn right after"; "with an
	// affordable Development the draw halts at a MAY offer (resumable frame)";
	// "draw without a refill source simply draws nothing further".
	it('pointer — covered by resolver/primitives/draw.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.23 — a Development cost can cost you the draw', () => {
	// New: the Clean-up draw stops once the hand reaches hand size, so a
	// Development whose cost filled the hand is enlisted but NOT drawn (p.14
	// rulebook example). Engine fix: draw.ts (untilHandSize + handAtCap) and
	// phases.ts (cleanupDraw passes the cap).
	register([
		makeDef({ id: 'devinc', suit: 'INCIDENT', operations: [] }),
		makeDef({
			id: 'dev',
			suit: 'DIRECTIVE',
			developmentCost: { k: 'COST_TAKE_INCIDENT', count: 1 },
			operations: [],
		}),
		makeDef({ id: 'fill', suit: 'PERSON', operations: [] }),
	])

	function costState(): GameState {
		let s = fresh()
		for (let i = 0; i < 4; i++)
			s = place(s, 'fill', ID(`f${i + 1}`), { k: 'HAND', seat: 0 }, 0)
		// Two incidents: taking one as the Development cost must NOT empty the
		// deck (that would Burn the game mid-draw, §12.11) — the cold path needs a
		// non-final incident just like the p.14 rulebook example.
		s = place(s, 'devinc', ID('inc1'), { k: 'INCIDENT_DECK' }, null)
		s = place(s, 'devinc', ID('inc2'), { k: 'INCIDENT_DECK' }, null)
		s = place(s, 'dev', ID('dev1'), { k: 'DEVELOPMENT', seat: 0 }, 0)
		return s
	}

	it('the enlisted Development stays on top of the deck when its cost fills the hand', () => {
		const base = costState()
		const s = drive(
			drawCards(base, 0, 1, { untilHandSize: player(base, 0).handSize }),
			firstPick,
		).state
		expect(s.cards[ID('dev1')]!.zone).toEqual({ k: 'DRAW', seat: 0 }) // enlisted, not drawn
		expect(s.zones[zoneKey({ k: 'HAND', seat: 0 })]).toHaveLength(5) // f1..f4 + inc1 (the cost)
		expect(s.zones[zoneKey({ k: 'HAND', seat: 0 })]).not.toContain(ID('dev1'))
		assertSerialisable(s)
	})

	it('an INCIDENT taken as a cost becomes the taker’s card', () => {
		const base = costState()
		const s = drive(
			drawCards(base, 0, 1, { untilHandSize: player(base, 0).handSize }),
			firstPick,
		).state
		// owner-less in HAND, the projection drew it as a card back to its holder
		expect(s.cards[ID('inc1')]!.owner).toBe(0)
	})

	it('an ordinary "draw N" (no hand-size cap) does draw the enlisted Development', () => {
		const s = drive(drawCards(costState(), 0, 1), firstPick).state
		expect(s.cards[ID('dev1')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.zones[zoneKey({ k: 'HAND', seat: 0 })]).toHaveLength(6)
		assertSerialisable(s)
	})
})

describe('rules/12 §12.24 — REACTIONs interrupt and nest', () => {
	// POINTER: todo09.test.ts — windows interrupt at the point the condition was
	// met and the interrupted operation resumes; a card reacts to its own
	// deploy/take-control; several reactors resolve in the player's chosen order;
	// nested reaction chains (§12.24).
	it('pointer — covered by todo09.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.25 — PASSIVEs are mandatory and unstoppable', () => {
	// POINTER: todo09.test.ts — exhausted PASSIVEs still apply, even when
	// unfavourable and on either player's turn; a self-retriggering PASSIVE is
	// caught by the loop guard.
	it('pointer — covered by todo09.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.26 — missions consume the beamed cards that enabled them', () => {
	// New: COMPLETE_MISSION dismisses every beamed card that contributed to the
	// goal; SHIPs/LOCATIONs/Staging contributors are never dismissed; where
	// several sets of beamed cards could satisfy the goal, the player chooses.
	// Engine fix: resolver/primitives/completeMission.ts (witnessSets /
	// witnessOf / dismissWitnesses).
	register([
		makeDef({
			id: 'allyA',
			suit: 'PERSON',
			traits: ['ANDORIAN'],
			operations: [],
		}),
		makeDef({ id: 'ship', suit: 'SHIP', operations: [] }),
	])

	const andorianCount2: MissionState['goal'] = {
		k: 'HAS_TRAIT_IN_PLAY',
		trait: 'ANDORIAN',
		count: 2,
	}

	function withShip(beamed: number): GameState {
		let s = withMission(fresh(), mission(andorianCount2))
		s = place(s, 'ship', ID('ship1'), { k: 'FLEET', seat: 0 }, 0)
		for (let i = 1; i <= beamed; i++) {
			s = place(
				s,
				'allyA',
				ID(`a${i}` as CardInstanceId),
				{ k: 'BEAMED', host: 'ship1' },
				0,
			)
		}
		return s
	}

	it('the beamed contributors are dismissed on completion, the SHIP is not', () => {
		const s = withShip(2)
		expect(canComplete(s, 0, 0)).toBe(true)
		const { state } = reduce(s, { t: 'COMPLETE_MISSION', index: 0 })
		expect(state.players[0].missions[0]!.completed).toBe(true)
		expect(state.cards[ID('ship1')]!.zone).toEqual({ k: 'FLEET', seat: 0 }) // SHIP stays
		expect(state.cards[ID('a1')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(state.cards[ID('a2')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		assertSerialisable(state)
	})

	it('several satisfying beamed sets surface a CHOOSE_WITNESS; the picked set is dismissed', () => {
		const s = withShip(3) // three beamed ANDORIANs, goal needs 2 → three sets of two
		const { state } = drive(
			pushAndRun(s, { k: 'COMPLETE_MISSION', index: 0 }, ID('ship1'), 0),
			firstPick,
		)
		expect(state.players[0].missions[0]!.completed).toBe(true)
		expect(state.cards[ID('a1')]!.zone).toEqual({ k: 'DISCARD', seat: 0 }) // the picked set (sets[0])
		expect(state.cards[ID('a2')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(state.cards[ID('a3')]!.zone).toEqual({ k: 'BEAMED', host: 'ship1' }) // unpicked one stays
		assertSerialisable(state)
	})
})

describe('rules/12 §12.27 — no missions completed = zero Focus VP', () => {
	// POINTER: scoring.test.ts "score — Focus suppression (rules/12 §12.27,
	// §7.2.2)" — missionsCompleted === 0 → whole Focus block is 0 and
	// focusSuppressed is true.
	it('pointer — covered by scoring.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.28 — ENDGAME only fires in play; printed VP always counts', () => {
	// POINTER: scoring.test.ts — "a logged card with an ENDGAME op contributes
	// printed VP but 0 ENDGAME (12.28)" and "asterisk VP (rules/12 §12.28)" — a
	// vpAsterisk card scores via its SPECIAL operation even out of play.
	it('pointer — covered by scoring.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.29 — Reserve and Development are removed before scoring', () => {
	// POINTER: scoring.test.ts "score — Reserve / Development are removed first
	// (rules/12 §12.29)"; end-to-end totals in pic-shr-game.test.ts (final
	// scoring with a hand-computed scoreboard).
	it('pointer — covered by scoring.test.ts / pic-shr-game.test.ts (see comment)', () => {
		/* full fixtures live in the pointed-at file (DRY) */
	})
})

describe('rules/12 §12.30 — unimplemented content stays recognised-but-inert', () => {
	// DRONE / ASSIMILATE, MISSIONS suits, the SURPRISE trait, unprinted cards and
	// the box-unused icons must never crash the engine — reserved, not active.
	it('the box-unused icon ids and the MISSION suit are reserved; SURPRISE is live (solo)', () => {
		for (const id of ['JEM_HADAR', 'VORTA', 'XB', 'HELMET', 'MIND_CONTROL']) {
			expect(NOT_IN_THIS_BOX.has(id)).toBe(true)
		}
		expect(NOT_IN_THIS_BOX_SUITS.has('MISSION')).toBe(true)
		expect(NOT_IN_THIS_BOX_TRAITS.has('SURPRISE')).toBe(false)
		expect(NOT_IN_THIS_BOX.has('ANDORIAN')).toBe(false)
	})

	it('a card using the reserved MISSION suit still parses against the schema', () => {
		const def = makeDef({ id: 'missioncard', suit: 'MISSION', operations: [] })
		expect(CardDefSchema.safeParse(def).success).toBe(true)
	})

	it('a query naming an unprinted card is recognised as unsatisfiable and warns once', () => {
		expect(
			referencesUnprinted({ zones: ['IN_PLAY'], filter: { ids: [] } }),
		).toBe(true)
		expect(
			referencesUnprinted({
				zones: ['IN_PLAY'],
				filter: { ids: ['1LOC01-20'] },
			}),
		).toBe(false)
		const ctx: EffectCtx = { actor: 0, source: ID('src'), bindings: {} }
		const unprinted = { zones: [], filter: { ids: [] } }
		let s = warnUnprinted(fresh(), [unprinted], ctx)
		const hits = (st: GameState) =>
			st.log.filter((e) => e.message.startsWith('Unprinted card referenced'))
		expect(hits(s)).toHaveLength(1)
		s = warnUnprinted(s, [unprinted], ctx) // one-time warning only
		expect(hits(s)).toHaveLength(1)
		assertSerialisable(s)
	})
})
