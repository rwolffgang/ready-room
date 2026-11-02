// Shared board components (todo/14 §3, docs/ui-spec.md §2). All read the
// projected state — the only game-viewing surface. The console lays them out
// across the table (src/ui/console/, docs/ui-lcars.md §4).
//
// Hook discipline: every component calls its hooks unconditionally at the top
// (React rules even though the react-hooks linter plugin is not configured).

import type { ReactNode } from 'react'
import type { GameState } from '../engine/state'
import { zoneKey, player } from '../engine/state'
import { dutyOfficerSlots } from '../engine/dutyOfficers'
import type { CardInstanceId } from '../engine/ids'
import type { Seat, ZoneRef } from '../engine/resolver/queries'
import type { SpecialtyId, MarketSuit } from '../data/ids'
import { MARKET_SUITS_FOUR } from '../engine/market'
import { shipTokensAt } from '../engine/queries/board'
import { canPlay } from '../engine/queries/legality'
import {
	useProjected,
	useGameStore,
	useViewerSeat,
	useLegal,
	useRealState,
} from './store'
import { CardSprite, CardStack, browsePile } from './cards'
import { LocationCard } from './location'
import { TableCard } from './tableCard'
import { seatLabel, specialtyName } from './format'
import { Icon, suitIconId } from './icons'
import { DeltaCounter } from './delta'
import { HIDDEN_DEF } from './projection'
import { deckLabel, missionTitle, withCardNames } from '../data/cardNames'
import { describePredicate } from '../engine/describe'
import { isSoloBot } from '../engine/solo/seat'

// ---------------------------------------------------------------------------
// shared helpers (hooks — call at the top of a component)
// ---------------------------------------------------------------------------

function useStateGame(): GameState | null {
	const projected = useProjected()
	return projected === null ? null : (projected as unknown as GameState)
}

function useZones(ref: ZoneRef): readonly CardInstanceId[] {
	const projected = useProjected()
	return projected?.zones[zoneKey(ref)] ?? []
}

// ---------------------------------------------------------------------------
// Centre piles — the decks between the two players
// ---------------------------------------------------------------------------

/**
 * The shared piles as decks on the table (docs/ui-lcars.md §4): the Stardate
 * pile with the Glory on its top card, the Incident deck (the Burn is lost by
 * whoever holds more Incidents when it runs out, so it warns at ≤2 and the
 * frame goes red at ≤1), and the Junk, which is public and browsable.
 */
export function CentrePiles() {
	const projected = useProjected()
	const state = useStateGame()
	const junk = useZones({ k: 'JUNK' })
	const incidents = useZones({ k: 'INCIDENT_DECK' })
	if (state === null) return null
	const top = state.stardates.pile[0]
	const topDef = top !== undefined ? projected?.cards[top]?.def : undefined
	return (
		<section className="panel centre-piles" aria-label="Shared piles">
			<h3>Piles</h3>
			<div className="centre-stacks">
				<div className="stardate-pile" aria-label="Stardate track">
					<CardStack
						label="Stardates"
						count={state.stardates.pile.length}
						deck
					/>
					<span className="stardate-name">
						{top === undefined ? '—' : topDef === HIDDEN_DEF ? '??' : topDef}
					</span>
					<DeltaCounter
						pool="stardate"
						label="Stardate Glory"
						className="stardate-glory"
						title="Glory tokens on the current Stardate card"
					>
						<Icon id="GLO" label="Glory" />
						<span className="stardate-glory-n">
							{state.stardates.gloryOnTop}
						</span>
					</DeltaCounter>
				</div>
				<CardStack
					label="Incidents"
					count={incidents.length}
					warn={incidents.length <= 2}
					deck
				/>
				<CardStack label="Junk" count={junk.length} browse={junk} deck />
			</div>
			{state.resolutionTriggered && (
				<div className="resolution-banner" role="status">
					⚠ Resolution — the round finishes, then final scoring
				</div>
			)}
		</section>
	)
}

/** A seat's Draw and Discard as two decks — on your side by the hand dock,
 *  on theirs in the opponent band. The Discard is public, so both browse. */
export function DeckPiles({ seat }: { seat: Seat }) {
	const state = useStateGame()
	const draw = useZones({ k: 'DRAW', seat })
	const discard = useZones({ k: 'DISCARD', seat })
	const supplement = useZones({ k: 'SUPPLEMENT', seat })
	// the official solo Bot (rules/13 §13.2): its Bot deck and its Supplement
	const bot = state !== null && isSoloBot(state, seat)
	return (
		<div className="deck-piles" aria-label={`${seatLabel(seat)} deck`}>
			<CardStack label={bot ? 'Bot deck' : 'Draw'} count={draw.length} deck />
			<CardStack label="Discard" count={discard.length} browse={discard} deck />
			{bot && <CardStack label="Supplement" count={supplement.length} deck />}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/** `label` stands in for the heading (the console makes it the close-up's
 *  door: the suits fill the top row, so a button has no room there). */
export function Market({ label }: { label?: ReactNode | undefined }) {
	return (
		<section className="panel market" aria-label="Market" data-anchor="supply">
			<h3>{label ?? 'Market'}</h3>
			<div className="market-row">
				{MARKET_SUITS_FOUR.map((suit) => (
					<MarketSuitCol key={suit} suit={suit} />
				))}
			</div>
		</section>
	)
}

function MarketSuitCol({ suit }: { suit: MarketSuit }) {
	const deck = useZones({ k: 'MARKET_DECK', suit })
	const offers = useZones({ k: 'MARKET_OFFER', suit })
	return (
		<div className="market-col">
			<div className="market-head">
				<span
					className={`suit-pill suit-banner card-suit-${suit.toLowerCase()}`}
				>
					<Icon id={suitIconId(suit)} label={suit} size="md" />
					{suit}
				</span>
				<CardStack label={`${suit} deck`} count={deck.length} deck />
			</div>
			<div className="market-offer-slot">
				{offers.length > 0 ? (
					offers.map((iid) => <CardSprite key={iid} iid={iid} size="board" />)
				) : (
					<div className="empty-slot muted">empty</div>
				)}
			</div>
		</div>
	)
}

/** One Market suit as it lies on the table, for the choice panel's Market
 *  candidates: the suit banner over its deck, face down on the left, and the
 *  offered card face up on the right (the board's Market keeps the deck in
 *  its banner row, to fit four suits beside the Neutral Zone). When the
 *  deck's top card is itself a candidate, the deck is the pick (`deckPick`):
 *  a click selects it, and it rings like any selected card. */
export function MarketSlot({
	suit,
	deckPick,
	children,
}: {
	suit: MarketSuit
	deckPick?:
		| { selected: boolean; disabled?: string | undefined; onClick: () => void }
		| undefined
	children: ReactNode
}) {
	const deck = useZones({ k: 'MARKET_DECK', suit })
	return (
		<div className="market-slot">
			<span className={`suit-pill suit-banner card-suit-${suit.toLowerCase()}`}>
				<Icon id={suitIconId(suit)} label={suit} size="md" />
				{suit}
			</span>
			<div className="market-pair">
				{deckPick === undefined ? (
					<CardStack label={`${suit} deck`} count={deck.length} deck />
				) : (
					<div
						className={`cardstack cardstack-deck deck-pick${deckPick.selected ? ' candidate-selected' : ''}${deckPick.disabled !== undefined ? ' candidate-disabled' : ''}`}
						title={deckPick.disabled ?? `The top card of the ${suit} deck`}
					>
						<button
							type="button"
							className="stack-back"
							onClick={deckPick.onClick}
							disabled={deckPick.disabled !== undefined}
							aria-pressed={deckPick.selected}
							aria-label={`Top card of the ${suit} deck (${deck.length})`}
						>
							<span className="stack-n">{deck.length}</span>
						</button>
						<div className="stack-count">top card, face down</div>
					</div>
				)}
				{children !== undefined &&
					(!Array.isArray(children) || children.length > 0) && (
						<div className="market-slot-card">{children}</div>
					)}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Neutral Zone
// ---------------------------------------------------------------------------

/** `aside` sits over the three Locations, where the Market has its suit row
 *  (the console's close-up button). */
export function NeutralZone({ aside }: { aside?: ReactNode | undefined }) {
	return (
		<section className="panel neutral-zone" aria-label="Neutral Zone">
			<h3>Neutral Zone</h3>
			<div>
				{aside !== undefined && <div className="nz-head">{aside}</div>}
				<div className="nz-row">
					{([0, 1, 2] as const).map((slot) => (
						<LocationSlot key={slot} slot={slot} />
					))}
				</div>
			</div>
		</section>
	)
}

function LocationSlot({ slot }: { slot: 0 | 1 | 2 }) {
	const state = useStateGame()
	const locs = useZones({ k: 'NEUTRAL_ZONE', slot })
	if (state === null) return null
	const loc = locs[0]
	const ships0 = loc !== undefined ? shipTokensAt(state, loc, 0) : 0
	const ships1 = loc !== undefined ? shipTokensAt(state, loc, 1) : 0
	// the standees on the card show the ships; the count is the tooltip
	return (
		<div
			className="location-slot"
			title={
				loc === undefined ? undefined : `Ships: P1 ${ships0} · P2 ${ships1}`
			}
		>
			{loc === undefined ? (
				<div className="empty-slot muted">no Location</div>
			) : (
				<LocationCard
					iid={loc}
					onClick={() => useGameStore.getState().cardClicked(loc)}
				/>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// PlayerArea — the in-play zones from rules/02 §2.3
// ---------------------------------------------------------------------------

type AreaZoneK =
	'DUTY_OFFICER' | 'LOCATION_AREA' | 'CAPTAIN' | 'FLEET' | 'STAGING'

function ZoneRow({
	seat,
	k,
	title,
	full,
}: {
	seat: Seat
	k: AreaZoneK
	title: string
	/** Takes a line of its own (the Staging Area). */
	full?: boolean | undefined
}) {
	const iids = useZones({ k, seat })
	return (
		<div
			className={`area-zone zone-${k.toLowerCase().replace('_', '-')}${full === true ? ' area-full' : ''}`}
		>
			<div className="area-slot-label">{title}</div>
			<div className="slot-group">
				{iids.length === 0 ? (
					<span className="empty-slot muted">empty</span>
				) : (
					iids.map((iid) => (
						<TableCard
							key={iid}
							iid={iid}
							onClick={() => useGameStore.getState().cardClicked(iid)}
						/>
					))
				)}
			</div>
		</div>
	)
}

/**
 * A seat's in-play zones. The printed board has three rows (Duty Officer +
 * Location Area, Captain + Fleet, Staging); a laptop screen has room for two,
 * so the zones flow in two lines — Captain, Fleet, Duty Officer and Location
 * Area on the first, the Staging Area on its own — and wrap only when a late
 * game runs out of width (docs/ui-lcars.md §4). The Duty Officer and the
 * Location Area share a row on the printed board, so they wrap as one.
 */
export function PlayerArea({
	seat,
	head = true,
	aside,
}: {
	seat: Seat
	/** The seat heading and action tray; the console's own area drops it,
	 *  since the head bar already carries both. */
	head?: boolean
	/** At the end of the first line of zones (the console's close-up
	 *  button); a full line pushes it onto its own. */
	aside?: ReactNode | undefined
}) {
	const state = useStateGame()
	const viewer = useViewerSeat()
	if (state === null) return null
	const isMine = seat === viewer
	const doCount = (state.zones[zoneKey({ k: 'DUTY_OFFICER', seat })] ?? [])
		.length
	const doSlots = dutyOfficerSlots(state, seat).length
	return (
		<section
			className={`panel player-area ${isMine ? 'area-mine' : 'area-theirs'}`}
			aria-label={`Player ${seat + 1} area`}
		>
			{head && (
				<div className="area-head">
					<strong>
						{seatLabel(seat)} {isMine ? '(you)' : ''}
					</strong>
					<ActionTray seat={seat} />
				</div>
			)}
			<div className="area-flow">
				<ZoneRow seat={seat} k="CAPTAIN" title="Captain" />
				<ZoneRow seat={seat} k="FLEET" title="Fleet Area" />
				<div className="area-pair">
					<ZoneRow
						seat={seat}
						k="DUTY_OFFICER"
						title={
							doSlots > 1
								? `Duty Officers (${doCount}/${doSlots})`
								: 'Duty Officer'
						}
					/>
					<ZoneRow seat={seat} k="LOCATION_AREA" title="Location Area" />
				</div>
				{aside !== undefined && <div className="area-aside">{aside}</div>}
				<ZoneRow seat={seat} k="STAGING" title="Staging Area" full />
			</div>
		</section>
	)
}

/**
 * The action budget as tokens: one lit action token per action still
 * available (no cap — gained actions show), then a hollow one per action
 * already spent this turn, and the count in words. It is also the flight
 * anchor for actions, so paying one visibly flies a token onto the card.
 */
export function ActionTray({
	seat,
	size = 'md',
}: {
	seat: Seat
	size?: 'md' | 'lg'
}) {
	const state = useStateGame()
	if (state === null) return null
	const { available, spent } = player(state, seat).actions
	const title = `${available} action${available === 1 ? '' : 's'} left · ${spent} used this turn`
	return (
		<DeltaCounter
			pool={`player:${seat}:ACTION`}
			label={`${seatLabel(seat)} actions`}
			className={`action-tray tray-${size} tray-seat-${seat}${available === 0 ? ' tray-empty' : ''}`}
			title={title}
		>
			<span className="tray-icons">
				{Array.from({ length: available }).map((_, i) => (
					<span key={`a${i}`} className="tray-token tray-available">
						<Icon id="ACTION" label="available action" size="md" />
					</span>
				))}
				{Array.from({ length: spent }).map((_, i) => (
					<span key={`s${i}`} className="tray-token tray-spent">
						<Icon id="ACTION" label="used action" size="md" />
					</span>
				))}
			</span>
			<span className="tray-count">
				<strong>{available}</strong> left
			</span>
		</DeltaCounter>
	)
}

// ---------------------------------------------------------------------------
// Crew board — specialty tracks + missions
// ---------------------------------------------------------------------------

export function CrewBoard({ seat }: { seat: Seat }) {
	const state = useStateGame()
	const legal = useLegal()
	const viewer = useViewerSeat()
	const reserve = useZones({ k: 'RESERVE', seat })
	const development = useZones({ k: 'DEVELOPMENT', seat })
	const log = useZones({ k: 'LOG', seat })
	if (state === null) return null
	const pl = player(state, seat)
	const done = pl.missions.filter((m) => m.completed).length
	return (
		<section
			className="panel crew-board crew-console"
			aria-label={`Player ${seat + 1} crew board`}
		>
			<div className="crew-head">
				<strong>Crew board — {deckLabel(pl.deckId)}</strong>
				<span className="muted">
					{pl.boardSide === 'BASIC' ? 'Basic' : 'Advanced'} side
				</span>
			</div>
			<>
				{/* The console reads like the printed board: three specialty bars
              lit up to the marker, each capped by its position and the
              multiplier Focus icons score at right now (docs/ui-lcars.md §4.1). */}
				<div className="console-tracks">
					{SPECIALTIES.map((s) => (
						<SpecialtyBar
							key={s}
							specialty={s}
							position={pl.specialties[s]}
							multipliers={pl.tracks[s]}
						/>
					))}
				</div>
				{/* The piles beside the board — counts you glance at, so they are
              tiles, not card backs. Reserve, Development and the Captain's
              Log sit beside the Crew board (rules/02 §2.3); your own Log is
              browsable, an opponent's is a count only (rules/04 §4.5). Your
              resources and Away Teams are in the top bar. */}
				<div className="console-tiles">
					<PileTile label="Reserve" iids={reserve} browse={false} />
					<PileTile label="Development" iids={development} browse />
					<PileTile label="Log" iids={log} browse={seat === viewer} />
					<span
						className="console-tile tile-pile tile-missions"
						title={`${done} of ${pl.missions.length} missions completed`}
					>
						<span className="tile-n">
							{done}
							<small>/{pl.missions.length}</small>
						</span>
						<span className="tile-label">Missions</span>
					</span>
				</div>
			</>
			<div className="missions">
				{pl.missions.map((m, i) => {
					// only your own missions take a Complete button — the opponent's
					// crew board also shows on the viewscreen
					const ready =
						seat === viewer &&
						state.activeSeat === seat &&
						state.phase.k === 'ACTION' &&
						legal.some((it) => it.t === 'COMPLETE_MISSION' && it.index === i)
					return (
						<div
							key={i}
							className={`mission${m.completed ? ' mission-done' : ''}${ready ? ' mission-ready' : ''}`}
						>
							<span
								className="mission-index"
								title={
									m.completed
										? 'completed'
										: ready
											? 'ready to complete'
											: 'open'
								}
							>
								<Icon id="VP" label="Mission" size="md" />
								<span className="mission-state" aria-hidden="true" />M{i + 1}
								<span className="sr-only">
									{m.completed ? ' completed' : ready ? ' ready' : ' open'}
								</span>
							</span>
							{/* mission VP only scores on the Advanced side (rules/07 §7.4.1 #6) */}
							{pl.boardSide === 'ADVANCED' && (
								<span className="mission-vp muted">VP {m.vp}</span>
							)}
							{ready && (
								<button
									type="button"
									className="btn btn-primary"
									onClick={() =>
										useGameStore
											.getState()
											.dispatch({ t: 'COMPLETE_MISSION', index: i })
									}
								>
									Complete
								</button>
							)}
							<span className="mission-text" title={m.cardId}>
								{missionTitle(m)} — {withCardNames(describePredicate(m.goal))}
							</span>
						</div>
					)
				})}
			</div>
		</section>
	)
}

const SPECIALTIES = ['RESEARCH', 'INFLUENCE', 'MILITARY'] as const
const TRACK_MAX = 15 // rules/07 §7.1: every track runs 0 to 15
const SPECIALTY_ABBR: Record<SpecialtyId, string> = {
	RESEARCH: 'Res',
	INFLUENCE: 'Inf',
	MILITARY: 'Mil',
}

/**
 * One specialty track as an LCARS bar: a cap (printed icon + name), one
 * segment per step lit up to the marker, the board side's multiplier glyphs
 * printed in their segments, and an end-cap reading out the position and the
 * multiplier Focus icons score at right now.
 */
export function SpecialtyBar({
	specialty,
	position,
	multipliers,
}: {
	specialty: SpecialtyId
	position: number
	multipliers: { step: number; value: number }[]
}) {
	// the highest glyph reached; ×0 below an Advanced side's first glyph
	// (rules/07 §7.1.4)
	const current = multipliers.reduce(
		(v, m) => (position >= m.step && m.value > v ? m.value : v),
		0,
	)
	const next = multipliers.find((m) => m.step > position)
	const name = specialtyName(specialty)
	const summary = `${name}: step ${position} of ${TRACK_MAX} · Focus icons score ×${current}${next !== undefined ? ` · ×${next.value} at step ${next.step}` : ''}`
	return (
		<div
			className={`console-track s-${specialty.toLowerCase()}`}
			role="group"
			aria-label={summary}
			title={summary}
		>
			<span className="console-track-cap">
				<Icon id={`SPECIALTY:${specialty}`} label={name} />
				<span aria-hidden="true">{SPECIALTY_ABBR[specialty]}</span>
			</span>
			<span className="console-segs" aria-hidden="true">
				{Array.from({ length: TRACK_MAX + 1 }).map((_, step) => {
					const mult = multipliers.find((m) => m.step === step)
					const cls =
						step === position ? ' seg-at' : step < position ? ' seg-lit' : ''
					return (
						<span
							key={step}
							className={`console-seg${cls}${mult !== undefined ? ' track-mult' : ''}`}
						>
							{mult !== undefined ? `×${mult.value}` : ''}
						</span>
					)
				})}
			</span>
			<span className="console-readout">
				<span className="readout-pos">{position}</span>
				<span className="readout-mult">×{current}</span>
			</span>
		</div>
	)
}

/** A pile beside the Crew board as a console tile; a button when browsable. */
function PileTile({
	label,
	iids,
	browse,
}: {
	label: string
	iids: readonly CardInstanceId[]
	browse: boolean
}) {
	const body = (
		<>
			<span className="tile-n">{iids.length}</span>
			<span className="tile-label">{label}</span>
		</>
	)
	if (!browse || iids.length === 0)
		return (
			<span
				className="console-tile tile-pile"
				title={
					browse
						? `${label}: empty`
						: `${label}: ${iids.length} · contents hidden`
				}
			>
				{body}
			</span>
		)
	return (
		<button
			type="button"
			className="console-tile tile-pile tile-browse"
			title={`browse ${label}`}
			aria-label={`${label} (${iids.length}) — browse`}
			onClick={() => browsePile(label, iids)}
		>
			{body}
		</button>
	)
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------

/** `size`: hand-sized in the dock, on `--card-w` in the hand close-up. */
export function Hand({
	seat,
	size = 'hand',
}: {
	seat: Seat
	size?: 'hand' | 'board'
}) {
	const state = useStateGame()
	// Legality must be evaluated on the real engine state — the projected view
	// hides facedown decks (HIDDEN_DEF), which starves the canPlay probe of the
	// candidate cards a PLAY effect needs (e.g. RECRUIT's "gain a PERSON/ALLY").
	const realState = useRealState()
	const viewer = useViewerSeat()
	const iids = useZones({ k: 'HAND', seat })
	if (state === null || realState === null) return null
	const mine = seat === viewer
	const inTurn = mine && state.activeSeat === seat && state.phase.k === 'ACTION'

	return (
		<section
			className={`panel hand${mine ? '' : ' hand-opponent'}`}
			aria-label={`Player ${seat + 1} hand`}
		>
			<div className="hand-head">
				<strong>{seatLabel(seat)} hand</strong>
				<span className="muted">
					{iids.length} card{iids.length === 1 ? '' : 's'}
				</span>
			</div>
			<div className="hand-row">
				{iids.map((iid) => {
					const card = state.cards[iid]
					if (card === undefined) return null
					if (card.def === HIDDEN_DEF) {
						return (
							<CardSprite
								key={iid}
								iid={iid}
								size={size}
								detailOnHover={false}
							/>
						)
					}
					const check = inTurn ? canPlay(realState, seat, iid) : null
					// Single click always opens the card detail (the "what can I do"
					// view). Double click is the fast path for a card with exactly one
					// legal action — e.g. a hand card with a single legal PLAY. A card
					// that can be played more than one way (e.g. UTILIZE: pay an action
					// for one effect, or a free one) has no single legal action, so
					// double click does nothing and the player picks from the detail.
					const canAct = inTurn && state.pendingChoice === null
					const playOps = check !== null && check.ok ? check.operations : []
					const multiPlay = canAct && playOps.length > 1
					const singlePlay = canAct && playOps.length === 1
					const dimmed = inTurn ? !singlePlay && !multiPlay : false
					const reason = dimmed ? (check?.reasons.join('; ') ?? null) : null
					return (
						<CardSprite
							key={iid}
							iid={iid}
							size={size}
							dimmed={dimmed}
							reason={reason}
							onClick={() => useGameStore.getState().cardClicked(iid)}
						/>
					)
				})}
			</div>
			{!mine && (
				<p className="muted small">Opponent's hand — face down in hot-seat.</p>
			)}
			{mine && iids.length === 0 && <p className="muted small">Empty hand.</p>}
		</section>
	)
}
