// The official solo Bot's Automated Command cards (rules/13 §13.6), drawn the
// way the STCC card scanner draws them: the TRAITS card and the SUITS card on
// the side its Duty Officer decides, every row with its trait or suit chips
// and the printed text (fetched STCC data: [[icons]], the red attack part,
// what YOU may do in blue). Without fetched data (the hosted build) the rows
// are our own describe() of their mechanics. The row the Bot is resolving is
// lit. Plus the strip that narrates the Bot's current beat.

import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import type { AcRowRef, BotBeat, GameState } from '../../engine/state'
import type { CardInstanceId } from '../../engine/ids'
import { botCard } from '../../engine/solo/acRegistry'
import { cardDef } from '../../engine/cards'
import { describe } from '../../engine/describe'
import { HIDDEN_DEF } from '../../engine/projection'
import { BOT_SUITS, type BotCard, type BotSuit } from '../../data/schema'
import type { StccBot } from '../../data/stcc'
import { stccBotFor } from '../stcc'
import { OpText } from '../cards'
import { setDetail, useProjected } from '../store'
import { useEscape } from '../console/useShortcut'
import { SOLO_LEVEL_LABEL } from './labels'

/** The Bot's crew data, its STCC text (or null) and the narration. */
export function useSoloBot(): {
	state: GameState
	ac: BotCard
	text: StccBot | null
	hasDo: boolean
} | null {
	const projected = useProjected()
	if (projected === null) return null
	const state = projected as unknown as GameState
	const solo = state.solo
	if (state.mode !== 'SOLO' || solo === undefined) return null
	const ac = botCard(solo.crew)
	if (ac === undefined) return null
	const captain = state.zones[`CAPTAIN:${solo.bot}`]?.[0]
	const def = captain === undefined ? undefined : state.cards[captain]?.def
	const text = def === undefined ? null : stccBotFor(cardDef(def))
	const hasDo = (state.zones[`DUTY_OFFICER:${solo.bot}`]?.length ?? 0) > 0
	return { state, ac, text, hasDo }
}

// ---------------------------------------------------------------------------
// STCC row markup: @…/@ red (an attack on you), $…/$ blue (you may …),
// ^…^ and *…* emphasis, #newline a line break; [[tokens]] via OpText.
// ---------------------------------------------------------------------------

type Tone = 'plain' | 'attack' | 'you'

export function segments(text: string): { tone: Tone; text: string }[] {
	const out: { tone: Tone; text: string }[] = []
	let tone: Tone = 'plain'
	let buf = ''
	const flush = () => {
		if (buf !== '') out.push({ tone, text: buf })
		buf = ''
	}
	for (let i = 0; i < text.length; i++) {
		const two = text.slice(i, i + 2)
		if (two === '/@' || two === '/$') {
			flush()
			tone = 'plain'
			i++
		} else if (text[i] === '@' || text[i] === '$') {
			flush()
			tone = text[i] === '@' ? 'attack' : 'you'
		} else buf += text[i]
	}
	flush()
	return out
}

export function AcText({ text }: { text: string }) {
	const clean = text.replace(/\^|\*/g, '')
	return (
		<>
			{segments(clean).map((seg, i) => (
				<span
					key={i}
					className={seg.tone === 'plain' ? undefined : `ac-${seg.tone}`}
				>
					{seg.text.split('#newline').map((line, j) => (
						<Fragment key={j}>
							{j > 0 && <br />}
							<OpText text={line} plain />
						</Fragment>
					))}
				</span>
			))}
		</>
	)
}

/** Our own words for a row when there is no fetched STCC text. */
function OurText({ effect }: { effect: Parameters<typeof describe>[0] }) {
	let text: string
	try {
		text = describe(effect)
	} catch {
		text = '—'
	}
	return <OpText text={text} plain />
}

// ---------------------------------------------------------------------------
// One row, the two cards, the panel
// ---------------------------------------------------------------------------

function sameRow(a: AcRowRef | undefined, b: AcRowRef): boolean {
	if (a === undefined) return false
	return JSON.stringify(a) === JSON.stringify(b)
}

function Row({
	head,
	suit,
	active,
	children,
}: {
	head: ReactNode
	suit?: string | undefined
	active: boolean
	children: ReactNode
}) {
	return (
		<div
			className={`ac-row${active ? ' ac-row-active' : ''}${suit !== undefined ? ` card-suit-${suit.toLowerCase()}` : ''}`}
			aria-current={active ? 'step' : undefined}
		>
			<span className="ac-key">{head}</span>
			<span className="ac-text">{children}</span>
		</div>
	)
}

export function AcCards({ compact = false }: { compact?: boolean }) {
	const bot = useSoloBot()
	if (bot === null) return null
	const { state, ac, text, hasDo } = bot
	const crew = state.solo!.crew
	const lit = state.solo?.beat?.row
	const suitText = (suit: BotSuit) =>
		text?.suits.find((r) => r.suit.toUpperCase() === suit)
	return (
		<div className={`ac-cards${compact ? ' ac-compact' : ''}`}>
			<section className="ac-card ac-traits" aria-label="TRAITS card">
				<h4>TRAITS</h4>
				<div className="ac-surprise">
					<OpText text="[[surprise]]" plain /> Resolve this card’s Surprise
					operation.
				</div>
				{ac.traits.map((row, i) => (
					<Row
						key={i}
						active={sameRow(lit, { deck: crew, trait: i })}
						head={
							<OpText
								text={
									text?.traits[i]?.key ??
									row.match.map((t) => `[[${t.toLowerCase()}]]`).join(' / ')
								}
								plain
							/>
						}
					>
						{text?.traits[i] !== undefined ? (
							<AcText text={text.traits[i].text} />
						) : (
							<OurText effect={row.effect} />
						)}
					</Row>
				))}
			</section>
			<section className="ac-card ac-suits" aria-label="SUITS card">
				<h4>
					SUITS{' '}
					<small>{hasDo ? 'with Duty Officer' : 'with no Duty Officer'}</small>
				</h4>
				{BOT_SUITS.map((suit) => {
					const printed = suitText(suit)
					const effect = hasDo ? ac.suits[suit].do : ac.suits[suit].noDo
					return (
						<Row
							key={suit}
							suit={suit}
							active={sameRow(lit, { deck: crew, suit, do: hasDo })}
							head={<span className="suit-pill">{suit}</span>}
						>
							{printed !== undefined ? (
								<AcText text={hasDo ? printed.do_text : printed.text} />
							) : (
								<OurText effect={effect} />
							)}
						</Row>
					)
				})}
			</section>
		</div>
	)
}

export function AcPanel({ onClose }: { onClose: () => void }) {
	const bot = useSoloBot()
	useEscape(true, onClose)
	if (bot === null) return null
	const { state } = bot
	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div
				className="modal ac-modal"
				role="dialog"
				aria-label="The Bot’s Automated Command cards"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="modal-head">
					<strong>
						The Bot’s Automated Command cards ·{' '}
						{SOLO_LEVEL_LABEL[state.solo!.level]}
					</strong>
					<button type="button" className="btn micro" onClick={onClose}>
						Close
					</button>
				</div>
				<AcCards />
				<p className="muted small">
					The Bot ignores its cards’ text: it looks up the first TRAITS row that
					names a trait of the card, else the row for its suit. Red text is an
					attack on you; blue text is something you may do.
				</p>
			</div>
		</div>
	)
}

/** A TRAITS or SUITS row's printed text, or our own words for it. */
function rowWording(
	row: Exclude<AcRowRef, { surprise: true }>,
	ac: BotCard,
	text: StccBot | null,
): ReactNode {
	if ('trait' in row) {
		const t = text?.traits[row.trait]
		return t !== undefined ? (
			<AcText text={t.text} />
		) : (
			<OurText effect={ac.traits[row.trait]!.effect} />
		)
	}
	const t = text?.suits.find((r) => r.suit.toUpperCase() === row.suit)
	return t !== undefined ? (
		<AcText text={row.do ? t.do_text : t.text} />
	) : (
		<OurText effect={ac.suits[row.suit as BotSuit][row.do ? 'do' : 'noDo']} />
	)
}

/** "Bot’s <traits / suit> row", naming a row the way its card heads it. */
export function AcRowName({ row }: { row: AcRowRef }) {
	const bot = useSoloBot()
	if (bot === null || 'surprise' in row) return null
	const key =
		'trait' in row
			? (bot.text?.traits[row.trait]?.key ??
				(bot.ac.traits[row.trait]?.match ?? [])
					.map((t) => `[[${t.toLowerCase()}]]`)
					.join(' / '))
			: row.suit
	return (
		<>
			Bot’s <OpText text={key} plain /> row
		</>
	)
}

/** A choice asked by an Automated Command row (choice.tsx): which row of the
 *  Bot's cards it is, and the row's text — so it never reads as the printed
 *  text of the card the Bot is resolving. */
export function AcRowSource({ row }: { row: AcRowRef }) {
	const bot = useSoloBot()
	if (bot === null || 'surprise' in row) return null
	return (
		<span className="source-card-op">
			<span className="source-card-op-type">
				<AcRowName row={row} />:
			</span>{' '}
			<span className="source-card-row">
				{rowWording(row, bot.ac, bot.text)}
			</span>
		</span>
	)
}

// ---------------------------------------------------------------------------
// The narration strip
// ---------------------------------------------------------------------------

const BEAT_WORD: Record<BotBeat, string> = {
	CONTROL: 'Control',
	DRAW: 'Draws its row',
	RESOLVE: 'Resolves',
	STARDATE: 'Stardate',
	CLEANUP: 'Clean-up',
}

/** The Bot's current beat: what it resolves, through which row, and a button
 *  for the whole cards. */
export function BotBeatStrip() {
	const bot = useSoloBot()
	const [open, setOpen] = useState(false)
	if (bot === null) return null
	const { state, ac, text } = bot
	const solo = state.solo!
	const beat = solo.beat
	const myTurn = state.phase.k !== 'BOT'
	// the card is named (its name comes from the fetched STCC data); a click
	// opens it
	const card = beat?.card as CardInstanceId | undefined
	const seen = card === undefined ? undefined : state.cards[card]?.def
	const def = seen === HIDDEN_DEF ? undefined : seen
	const row = beat?.row
	let rowText: ReactNode = null
	if (row !== undefined && !('surprise' in row))
		rowText = rowWording(row, ac, text)
	else if (row !== undefined) rowText = <em>its own Surprise operation</em>
	return (
		<div className="bot-beat" aria-live="polite">
			<span className="bot-beat-head">
				{myTurn
					? 'The Bot waits'
					: `Bot · ${BEAT_WORD[beat?.beat ?? 'CONTROL']}`}
			</span>
			{!myTurn && card !== undefined && def !== undefined && (
				<button
					type="button"
					className="bot-beat-card"
					onClick={() => setDetail(card)}
					title="Read the card"
				>
					<OpText text={`[[card:${def}]]`} plain />
				</button>
			)}
			{!myTurn && rowText !== null && (
				<span className="bot-beat-row">{rowText}</span>
			)}
			<button
				type="button"
				className="btn micro"
				onClick={() => setOpen(true)}
				title="The Bot’s Automated Command cards"
			>
				Command cards
			</button>
			{open && <AcPanel onClose={() => setOpen(false)} />}
		</div>
	)
}
