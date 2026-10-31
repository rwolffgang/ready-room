// The solo Bot's turn (rules/13 §13.4) as a phase machine in BEATS — one beat
// per BOT_STEP intent, so the turn plays out card by card, and replays,
// undoes and saves like any other move:
//
//   CONTROL   take control of the most valuable secured LOCATION, resolve it
//   DRAW      lay the Stardate's Bot actions face down as the Staging row
//   RESOLVE   flip and resolve the next row card (once per card)
//   STARDATE  resolve a Stardate card the human handed over
//   CLEANUP   discard Staging, place Glory, end the turn
//
// A beat pushes its work under a PARK frame; when PARK runs it only records
// the next beat in `state.phase`, the stack empties and the engine halts until
// the next BOT_STEP. A beat with nothing to do falls straight through to the
// next one, so every step shows something. Mid-beat choices of the human
// (attack picks, REACTIONs) halt the run like any other choice.

import type { BotBeat, EffectCtx, Frame, GameState } from '../state'
import { player, zonesOf } from '../state'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'
import { addLog, emit, handoffStardate, moveCard } from '../resolver/runtime'
import { cardDef } from '../cards'
import { marketOffers } from '../market'
import { dropTurnModifiers } from '../modifiers'
import { handOffTurn } from '../phases'
import { otherSeat } from '../state'
import { botCard } from './acRegistry'
import { botDeckTop } from './deck'
import { securedByBot } from './rank'
import { pickByValue } from './value'

/** What a Bot PHASE_STEP frame is for (a ctx binding): a beat to run (none),
 *  the PARK that ends a beat, or the END of the turn. */
const FRAME = '$bot.frame'
/** The END frame takes the placed Glory off the Stardate card (not for the
 *  Dilithium variant, whose REMOVE_STARDATE_GLORY already did). */
const TAKE_GLORY = '$bot.takeGlory'
/** The LOCATION the CONTROL beat took control of. */
const CONTROLLED = '$bot.controlled'

const ORDER: BotBeat[] = ['CONTROL', 'DRAW', 'RESOLVE', 'STARDATE', 'CLEANUP']

function botCtx(bot: Seat, bindings: EffectCtx['bindings'] = {}): EffectCtx {
	return { actor: bot, source: '' as CardInstanceId, bindings }
}

function botFrame(bot: Seat, beat: BotBeat, kind?: 'PARK' | 'END'): Frame {
	return {
		k: 'PHASE_STEP',
		phase: { k: 'BOT', beat },
		ctx: botCtx(bot, kind === undefined ? {} : { [FRAME]: kind }),
	}
}

/** The human ended their turn: the Bot's turn starts, waiting for BOT_STEP. */
export function startBotTurn(state: GameState, bot: Seat): GameState {
	return narrate(
		{ ...state, activeSeat: bot, phase: { k: 'BOT', beat: 'CONTROL' } },
		'CONTROL',
	)
}

/** BOT_STEP: run the beat `state.phase` names. */
export function pushBotStep(state: GameState): GameState {
	const phase = state.phase
	if (phase.k !== 'BOT' || state.solo === undefined)
		throw new Error('BOT_STEP: not the Bot’s turn')
	return {
		...state,
		stack: [...state.stack, botFrame(state.solo.bot, phase.beat)],
	}
}

/** One Bot PHASE_STEP frame (dispatched from phases.ts). */
export function executeBotBeat(
	state: GameState,
	frame: Frame & { k: 'PHASE_STEP' },
): GameState {
	if (frame.phase.k !== 'BOT' || state.solo === undefined) return state
	const kind = frame.ctx?.bindings[FRAME]
	// the beat is done: only the phase moves on; the narration of what it did
	// stays up until the next beat starts
	if (kind === 'PARK') return { ...state, phase: frame.phase }
	if (kind === 'END')
		return endBotTurn(state, frame.ctx?.bindings[TAKE_GLORY] === true)
	return runFrom(state, frame.phase.beat)
}

/** Start narrating `beat` (BOT_RESOLVE adds the card and its row). */
function narrate(
	state: GameState,
	beat: BotBeat,
	card?: CardInstanceId,
): GameState {
	if (state.solo === undefined) return state
	return {
		...state,
		solo: { ...state.solo, beat: card === undefined ? { beat } : { beat, card } },
	}
}

/** Run `beat`, or the first later beat that has something to do. */
function runFrom(state: GameState, beat: BotBeat): GameState {
	const bot = state.solo!.bot
	for (let i = ORDER.indexOf(beat); i < ORDER.length; i++) {
		const b = ORDER[i]!
		const r = beatWork(state, bot, b)
		if (r === null) continue
		const next = b === 'CLEANUP' ? null : nextBeat(b)
		const below: Frame[] =
			b === 'CLEANUP'
				? [] // the CLEANUP work carries its own END frame
				: [botFrame(bot, next!, 'PARK')]
		const s = narrate({ ...r.state, phase: { k: 'BOT', beat: b } }, b, r.card)
		return { ...s, stack: [...s.stack, ...below, ...r.frames] }
	}
	return state // unreachable: CLEANUP always has work
}

function nextBeat(beat: BotBeat): BotBeat {
	return beat === 'RESOLVE' ? 'RESOLVE' : ORDER[ORDER.indexOf(beat) + 1]!
}

/** A beat's work: the state after its immediate moves plus the frames to run
 *  (pushed above the PARK, so the last one runs first) — or null when the beat
 *  has nothing to do. */
function beatWork(
	state: GameState,
	bot: Seat,
	beat: BotBeat,
): { state: GameState; frames: Frame[]; card?: CardInstanceId } | null {
	switch (beat) {
		case 'CONTROL':
			return controlWork(state, bot)
		case 'DRAW':
			return drawWork(state, bot)
		case 'RESOLVE':
			return zonesOf(state, { k: 'BOT_ROW', seat: bot }).length === 0
				? null
				: {
						state,
						frames: [
							{
								k: 'EFFECT',
								node: { k: 'BOT_RESOLVE', from: 'ROW' },
								ctx: botCtx(bot),
								ip: 0,
							},
						],
					}
		case 'STARDATE':
			return stardateWork(state, bot)
		case 'CLEANUP':
			return cleanupWork(state, bot)
	}
}

/** rules/13 §13.4 #2: take control of the most valuable secured LOCATION
 *  (tokens returned, the opponent paid for theirs, the Neutral Zone refilled
 *  — TAKE_CONTROL), then resolve it through its row. */
function controlWork(
	state: GameState,
	bot: Seat,
): { state: GameState; frames: Frame[]; card?: CardInstanceId } | null {
	const loc = securedByBot(state, bot)
	if (loc === null) return null
	const ctx = botCtx(bot, { [CONTROLLED]: loc })
	return {
		state,
		card: loc,
		frames: [
			{
				k: 'EFFECT',
				node: { k: 'BOT_RESOLVE', from: 'BOUND', bound: CONTROLLED },
				ctx,
				ip: 0,
			},
			{
				k: 'EFFECT',
				node: {
					k: 'TAKE_CONTROL',
					target: { zones: ['NEUTRAL_LOCATIONS'], bound: CONTROLLED },
				},
				ctx,
				ip: 0,
			},
		],
	}
}

/** The current Stardate card's Bot actions (the final card's stay in force
 *  once the end has been triggered — it stays in the pile as the marker). */
export function botActionsNow(state: GameState): number {
	return state.stardates.botActions?.[0] ?? 0
}

/** rules/13 §13.4 #3: draw the Bot actions face down into the Staging row. */
function drawWork(
	state: GameState,
	bot: Seat,
): { state: GameState; frames: Frame[]; card?: CardInstanceId } | null {
	let s = state
	let drawn = 0
	for (let i = 0; i < botActionsNow(state); i++) {
		const r = botDeckTop(s, bot)
		s = r.state
		if (r.top === null) break
		s = moveCard(s, r.top, { k: 'BOT_ROW', seat: bot })
		drawn++
	}
	if (drawn === 0) return null
	s = addLog(s, {
		kind: 'EVENT',
		seat: bot,
		message: `lays ${drawn} card${drawn === 1 ? '' : 's'} face down as its Staging row`,
	})
	return { state: s, frames: [] }
}

/** rules/13 §13.4 #4.1: a Stardate card handed to the Bot does its effect,
 *  then leaves play. */
function stardateWork(
	state: GameState,
	bot: Seat,
): { state: GameState; frames: Frame[]; card?: CardInstanceId } | null {
	const held = player(state, bot).heldStardate
	if (held === null) return null
	const players = state.players.map((pl) =>
		pl.seat === bot ? { ...pl, heldStardate: null } : pl,
	) as GameState['players']
	const s = moveCard({ ...state, players }, held, { k: 'BOX' })
	const wipe = cardDef(s.cards[held]!.def).operations.findIndex(
		(o) => o.type === 'CLEANUP',
	)
	if (wipe < 0) return { state: s, frames: [] }
	return {
		state: s,
		frames: [
			{
				k: 'OPERATION',
				card: held,
				opIndex: wipe,
				ctx: { actor: bot, source: held, bindings: {} },
				phase: 0,
			},
		],
	}
}

/** rules/13 §13.4 #4.2–#4.3: discard the Staging Area, then put 1 Glory on
 *  the Market card least valuable to the human — or, for the Dilithium Bot,
 *  remove 1 Glory from the Stardate card and put 2 Dilithium there. */
function cleanupWork(
	state: GameState,
	bot: Seat,
): { state: GameState; frames: Frame[] } {
	let s = state
	for (const iid of zonesOf(s, { k: 'STAGING', seat: bot }))
		s = emit(moveCard(s, iid, { k: 'DISCARD', seat: bot }), {
			k: 'CARD_DISCARDED',
			iid,
			seat: bot,
		})
	const dilithium = botCard(s.solo!.crew)?.special === 'DILITHIUM'
	const target = pickByValue(s, marketOffers(s), otherSeat(bot), 'LEAST')
	const end: Frame = {
		k: 'PHASE_STEP',
		phase: { k: 'BOT', beat: 'CLEANUP' },
		ctx: botCtx(bot, { [FRAME]: 'END', [TAKE_GLORY]: !dilithium && target !== null }),
	}
	if (target === null) return { state: s, frames: [end] }
	const res = dilithium ? 'DIL' : 'GLO'
	const amount = dilithium ? 2 : 1
	const card = s.cards[target]!
	s = {
		...s,
		cards: {
			...s.cards,
			[target]: {
				...card,
				resourceTokens: {
					...card.resourceTokens,
					[res]: (card.resourceTokens[res] ?? 0) + amount,
				},
			},
		},
	}
	s = addLog(s, {
		kind: 'EVENT',
		seat: bot,
		iid: target,
		message: `places ${amount} ${res === 'GLO' ? '{GLO}' : '{DIL}'} on ${target}`,
	})
	const frames: Frame[] = [end]
	if (dilithium)
		frames.push({
			k: 'EFFECT',
			node: { k: 'REMOVE_STARDATE_GLORY', amount: 1 },
			ctx: botCtx(bot),
			ip: 0,
		})
	return { state: s, frames }
}

/** End of the Bot's turn: the placed Glory leaves the Stardate card (from the
 *  supply once the end is triggered — handing the card over when it empties),
 *  turn-long effects end, and the human's turn begins (handOffTurn). */
function endBotTurn(state: GameState, takeGlory: boolean): GameState {
	const bot = state.solo!.bot
	let s = state
	if (
		takeGlory &&
		!s.resolutionTriggered &&
		s.stardates.pile.length > 0 &&
		s.stardates.gloryOnTop > 0
	) {
		const gloryOnTop = s.stardates.gloryOnTop - 1
		s = { ...s, stardates: { ...s.stardates, gloryOnTop } }
		if (gloryOnTop <= 0) s = handoffStardate(s, bot)
	}
	let cards = s.cards
	for (const [iid, c] of Object.entries(s.cards))
		if (c.owner === bot && c.exhausted)
			cards = { ...cards, [iid]: { ...c, exhausted: false } }
	s = dropTurnModifiers(dropTurnModifiers({ ...s, cards }, bot), otherSeat(bot))
	const { beat: _done, ...solo } = s.solo!
	return handOffTurn({ ...s, solo }, bot)
}
