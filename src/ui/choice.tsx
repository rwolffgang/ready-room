// The choice panel (todo/14 §4, docs/ui-spec.md §4) — one renderer per
// PendingChoice kind from src/engine/choiceUi.ts. Key behaviours:
//   - always show prompt + source card + min/max + live selection count;
//   - "select in situ": CHOOSE_CARDS / CHOOSE_LOCATION candidates are toggled
//     where they physically are (Hand / Market / Neutral Zone render the
//     accent ring from the store's `selected`), and the panel lists them too;
//   - disabled candidates are greyed WITH their reason;
//   - route by choice.seat: in hot-seat, a choice for the opponent shows the
//     pass-the-device interstitial first (docs/ui-spec.md §4).
//
// Every renderer hands a selection to `confirmChoice`, which dispatches
// RESOLVE_CHOICE; the engine re-validates (never trust the client).

import { useState, type ReactNode } from 'react'
import type {
	PendingChoice,
	ChoiceDisabledCard,
	ChoiceOption,
} from '../engine/resolver/choices'
import type { OperationRef } from '../engine/state'
import { otherSeat, zoneKey } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import type { Seat, ZoneRef } from '../engine/resolver/queries'
import type { MarketSuit, SpecialtyId, TraitId } from '../data/ids'
import { describeOperation } from '../engine/describe'
import {
	useProjected,
	useSelected,
	useViewerSeat,
	useGameStore,
	confirmChoice,
	usePendingChoice,
} from './store'
import { CardFace, CardSprite, OpText } from './cards'
import { MarketSlot } from './board'
import { LocationCard, isLocationInPlay } from './location'
import { OperationOptions, operationOptions } from './opOptions'
import { seatLabel } from './format'
import { useDefForIid, useDefById, type CardDef } from './defs'
import { cardName, withCardNames } from '../data/cardNames'
import { printedOpFor, printedOps } from '../data/stcc'
import { stccCard } from './stcc'

/** The sentinel "skip" Location candidate for the Control Step (phases.ts). */
const SKIP_CONTROL = '__SKIP__' as CardInstanceId

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

/** The card's printed wording of operation #opIndex (without its header), or
 *  our own rendering when the STCC text has none. */
function opWording(def: CardDef, opIndex: number): string | null {
	const op = def.operations[opIndex]
	if (op === undefined) return null
	const stcc = stccCard(def)
	const printed =
		stcc === null
			? null
			: printedOpFor(printedOps(stcc.text), def.operations, opIndex)
	return printed?.text ?? describeOperation(op)
}

function SourceCard({
	sourceCard,
	sourceDef,
	sourceOp,
	label,
}: {
	sourceCard: CardInstanceId | null
	sourceDef?: string | undefined
	/** the resolving operation: its wording says why the choice is asked */
	sourceOp?: number | undefined
	label?: string | undefined
}) {
	// The instance may have gone face-down (an Incident returned to its deck
	// mid-effect, an ALLY gained onto the deck top) — fall back to the def id
	// stamped on the choice. A card nobody may name is left out.
	const liveDef = useDefForIid(sourceCard)
	const stampedDef = useDefById(sourceDef ?? '')
	const def = liveDef ?? stampedDef
	if (sourceCard === null || def === null) return null
	const type =
		sourceOp === undefined ? undefined : def.operations[sourceOp]?.type
	const wording = sourceOp === undefined ? null : opWording(def, sourceOp)
	return (
		<span className="source-card">
			{label !== undefined && <span>{label}</span>}
			{liveDef !== null ? (
				<CardSprite iid={sourceCard} size="micro" detailOnHover={false} />
			) : (
				<CardFace def={def} size="micro" />
			)}
			<span className="source-card-body">
				<span className="source-card-name">{cardName(def)}</span>
				{type !== undefined && wording !== null && (
					<span className="source-card-op">
						<span className="source-card-op-type">
							{type.charAt(0) + type.slice(1).toLowerCase()}:
						</span>{' '}
						<OpText text={wording} plain />
					</span>
				)}
			</span>
		</span>
	)
}

function ChoiceHeader({
	choice,
	extra,
	sourceLabel,
}: {
	choice: PendingChoice
	extra?: ReactNode
	/** words before the source card ("Triggered by") */
	sourceLabel?: string
}) {
	return (
		<div className="choice-head">
			<div className="choice-prompt">
				<strong>
					<OpText text={choice.prompt} plain />
				</strong>
				<SourceCard
					sourceCard={choice.sourceCard}
					sourceDef={choice.sourceDef}
					sourceOp={choice.sourceOp}
					label={sourceLabel}
				/>
			</div>
			{extra !== undefined && <div className="choice-extra">{extra}</div>}
		</div>
	)
}

// ---------------------------------------------------------------------------
// the panel
// ---------------------------------------------------------------------------

export function ChoicePanel() {
	const choice = usePendingChoice()
	const viewer = useViewerSeat()
	// the house AI answers its own choices (the bot bar shows it thinking)
	const botToMove = useGameStore((s) => s.botToMove)
	if (choice === null || botToMove !== null) return null

	// Hot-seat routing (todo/14 §4): a REACTION choice for the opponent shows a
	// pass-the-device interstitial before the actual choices.
	if (choice.seat !== viewer) {
		return (
			<section
				className="panel choice-panel pass-device"
				aria-label="Pass the device"
			>
				<h3>Choice for {seatLabel(choice.seat)}</h3>
				<p>
					{choice.k === 'OPTIONAL_TRIGGERS'
						? 'A reaction window is open and the opponent must answer.'
						: 'The deciding player must answer this prompt.'}
				</p>
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => useGameStore.getState().setViewer(choice.seat)}
				>
					Pass device — I&apos;m {seatLabel(choice.seat)}
				</button>
				<SourceCard
					sourceCard={choice.sourceCard}
					sourceDef={choice.sourceDef}
				/>
			</section>
		)
	}

	switch (choice.k) {
		case 'CONFIRM':
			return <ConfirmChoice choice={choice} />
		case 'CHOOSE_OPTION':
			return <ChooseOptionChoice choice={choice} />
		case 'CHOOSE_CARDS':
			return <ChooseCardsChoice choice={choice} />
		case 'CHOOSE_LOCATION':
			return <ChooseLocationChoice choice={choice} />
		case 'CHOOSE_SUIT':
			return <ChooseSuitChoice choice={choice} />
		case 'CHOOSE_TRAIT':
			return <ChooseTraitChoice choice={choice} />
		case 'CHOOSE_SPECIALTY':
			return <ChooseSpecialtyChoice choice={choice} />
		case 'CHOOSE_DESTINATION':
			return <ChooseDestinationChoice choice={choice} />
		case 'CHOOSE_AMOUNT':
			return <ChooseAmountChoice choice={choice} />
		case 'ORDER_OPERATIONS':
			return <OrderOperationsChoice choice={choice} />
		case 'OPTIONAL_TRIGGERS':
			return <OptionalTriggersChoice choice={choice} />
		case 'CHOOSE_WITNESS':
			return <ChooseWitnessChoice choice={choice} />
		case 'CHOOSE_WILDCARD_AS':
			return <ChooseWildcardChoice choice={choice} />
		case 'ORDER_CARDS':
			return <OrderCardsChoice choice={choice} />
	}
}

function ConfirmChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CONFIRM' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(true)}
				>
					Confirm
				</button>
				<button
					type="button"
					className="btn"
					onClick={() => confirmChoice(false)}
				>
					Cancel / decline
				</button>
			</div>
		</section>
	)
}

function ChooseOptionChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_OPTION' }>
}) {
	const byCard = operationOptions(choice.options)
	if (byCard !== null)
		return (
			<section className="panel choice-panel">
				<ChoiceHeader choice={choice} />
				<OperationOptions byCard={byCard} seat={choice.seat} size="hand" />
			</section>
		)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.options.map((opt: ChoiceOption) => (
					<button
						key={opt.key}
						type="button"
						className={`btn option-row${opt.enabled ? '' : ' option-disabled'}`}
						disabled={!opt.enabled}
						title={opt.enabled ? undefined : opt.reason}
						onClick={() => confirmChoice({ key: opt.key })}
					>
						<span>
							<OpText text={opt.label} plain />
						</span>
						{!opt.enabled && opt.reason !== undefined && (
							<span className="muted small"> — {opt.reason}</span>
						)}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseCardsChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_CARDS' }>
}) {
	const selected = useSelected()
	const projected = useProjected()
	const viewer = useViewerSeat()
	if (projected === null) return null
	const { min, max, optional } = choice
	const disabledByIid = new Map(
		(choice.disabled ?? []).map((d: ChoiceDisabledCard) => [d.iid, d.reason]),
	)
	const hidden = new Set(choice.hidden ?? [])
	const candidates = [
		...choice.candidates,
		...(choice.disabled ?? []).map((d) => d.iid),
	]
	const canConfirm = !(selected.length < min || selected.length > max)
	// a SELECT over Locations in play (e.g. 1SIS11-25's "a controlled
	// Location") gets the same Location picker as the Location choice
	const locationsOnly = candidates.every((iid) =>
		isLocationInPlay(projected.cards[iid]?.zone),
	)

	// Group candidates by zone so the panel keeps spatial context inline. A
	// Market deck's top card (the one card a gain may take face down) is not a
	// group of its own: it is the deck in its suit's Market slot.
	const deckPicks = new Map<string, number>()
	for (const iid of candidates) {
		const z = projected.cards[iid]?.zone
		if (z?.k === 'MARKET_DECK')
			deckPicks.set(z.suit, (deckPicks.get(z.suit) ?? 0) + 1)
	}
	const groups = new Map<string, CandidateGroup>()
	for (const iid of candidates) {
		const z = projected.cards[iid]?.zone
		if (z === undefined) continue
		const asMarket = z.k === 'MARKET_DECK' && deckPicks.get(z.suit) === 1
		const { key, label } = asMarket
			? { key: 'MARKET_OFFER', label: 'Market' }
			: groupOf(z as ZoneRef, viewer)
		const group = groups.get(key) ?? {
			label,
			market: key === 'MARKET_OFFER',
			iids: [],
		}
		group.iids.push(iid)
		groups.set(key, group)
	}

	return (
		<section
			className="panel choice-panel"
			aria-label={withCardNames(choice.prompt)}
		>
			<ChoiceHeader
				choice={choice}
				extra={
					<span className={`choice-count${canConfirm ? '' : ' muted'}`}>
						{selected.length} selected · min {min} · max {max}
						{optional === true ? ' · optional' : ''}
					</span>
				}
			/>
			{locationsOnly ? (
				<LocationPicker
					offered={choice.candidates}
					disabled={disabledByIid}
					selected={selected}
				/>
			) : (
				<CardCandidates
					groups={groups}
					disabledByIid={disabledByIid}
					hidden={hidden}
					selected={selected}
				/>
			)}
			{/* the decision comes after looking at the cards */}
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					disabled={!canConfirm}
					onClick={() => confirmChoice(selected)}
				>
					Confirm {selected.length > 0 ? `(${selected.length})` : ''}
				</button>
				{optional === true && (
					<button
						type="button"
						className="btn"
						onClick={() => confirmChoice([])}
					>
						Decline / none
					</button>
				)}
				<button
					type="button"
					className="btn"
					onClick={() => useGameStore.getState().setSelected([])}
				>
					Clear
				</button>
			</div>
		</section>
	)
}

interface CandidateGroup {
	label: string
	/** Market offers: drawn as on the table, each by its suit's deck */
	market: boolean
	iids: CardInstanceId[]
}

/** Where a group of candidates lies, in the player's words (the key keeps
 *  each seat's and each suit's piles apart). */
function groupOf(z: ZoneRef, viewer: Seat): { key: string; label: string } {
	switch (z.k) {
		case 'MARKET_OFFER':
			return { key: 'MARKET_OFFER', label: 'Market' }
		case 'MARKET_DECK':
			return { key: `MARKET_DECK:${z.suit}`, label: `${z.suit} deck` }
		case 'NEUTRAL_ZONE':
			return { key: 'NEUTRAL_ZONE', label: 'Neutral Zone' }
		case 'JUNK':
			return { key: 'JUNK', label: 'Junk' }
		case 'INCIDENT_DECK':
			return { key: z.k, label: 'Incident deck' }
		case 'ENCOUNTER_DECK':
			return { key: z.k, label: 'Encounter deck' }
		case 'LOCATION_DECK':
			return { key: z.k, label: 'Location deck' }
		case 'STARDATE_PILE':
			return { key: z.k, label: 'Stardates' }
		case 'BOX':
			return { key: z.k, label: 'Out of the game' }
		case 'BEAMED':
			return { key: 'BEAMED', label: 'Beamed aboard' }
		default: {
			const whose = z.seat === viewer ? 'Your' : 'Their'
			return { key: `${z.k}:${z.seat}`, label: `${whose} ${SEAT_ZONE[z.k]}` }
		}
	}
}

const SEAT_ZONE: Record<Extract<ZoneRef, { seat: Seat }>['k'], string> = {
	HAND: 'hand',
	DRAW: 'Draw pile',
	DISCARD: 'Discard pile',
	RESERVE: 'Reserve',
	DEVELOPMENT: 'Development pile',
	LOG: "Captain's Log",
	STAGING: 'Staging Area',
	FLEET: 'Fleet Area',
	LOCATION_AREA: 'Location Area',
	DUTY_OFFICER: 'Duty Officer',
	CAPTAIN: 'Captain',
	STATUS: 'Status',
}

/** The Market group's candidates by suit, in the order they were offered:
 *  the face-up offers, and the deck when its top card is a candidate. */
function marketSlots(
	iids: readonly CardInstanceId[],
	cards: Readonly<Record<string, { zone: ZoneRef } | undefined>>,
) {
	const bySuit = new Map<
		MarketSuit,
		{ suit: MarketSuit; offers: CardInstanceId[]; deck?: CardInstanceId }
	>()
	for (const iid of iids) {
		const z = cards[iid]?.zone
		if (z?.k !== 'MARKET_OFFER' && z?.k !== 'MARKET_DECK') continue
		const slot = bySuit.get(z.suit) ?? { suit: z.suit, offers: [] }
		if (z.k === 'MARKET_OFFER') slot.offers.push(iid)
		else slot.deck = iid
		bySuit.set(z.suit, slot)
	}
	return [...bySuit.values()]
}

/** The card choice's own candidate rows: the offered cards grouped by zone,
 *  each with where its ship stands and why a greyed one can't be picked.
 *  Market offers lie as on the table — the suit banner over its deck and
 *  the offered card (MarketSlot) — not as a row of bare cards. */
function CardCandidates({
	groups,
	disabledByIid,
	hidden,
	selected,
}: {
	groups: ReadonlyMap<string, CandidateGroup>
	disabledByIid: ReadonlyMap<CardInstanceId, string>
	hidden: ReadonlySet<CardInstanceId>
	selected: readonly CardInstanceId[]
}) {
	const projected = useProjected()
	if (projected === null) return null
	const tile = (iid: CardInstanceId) => {
		const disabledReason = disabledByIid.get(iid)
		const isSel = selected.includes(iid)
		const isHiddenCandidate = hidden.has(iid)
		const click =
			disabledReason === undefined
				? () => useGameStore.getState().cardClicked(iid)
				: undefined
		// a Location in play brings its Away Teams and ships along
		const isLocation = isLocationInPlay(projected.cards[iid]?.zone)
		const Sprite = isLocation ? LocationCard : CardSprite
		return (
			<div
				key={iid}
				className={`candidate-tile${isLocation ? ' location-tile' : ''}${isSel ? ' candidate-selected' : ''}${disabledReason !== undefined ? ' candidate-disabled' : ''}`}
				title={disabledReason}
			>
				<div className="candidate-card-wrap">
					<Sprite
						iid={iid}
						size="board"
						selected={isSel}
						dimmed={disabledReason !== undefined}
						reason={disabledReason}
						onClick={click}
					/>
				</div>
				<ShipWhere iid={iid} />
				{disabledReason !== undefined && (
					<span className="muted small why-not">why not: {disabledReason}</span>
				)}
				{isHiddenCandidate && !isSel && (
					<span className="muted small">(face down)</span>
				)}
			</div>
		)
	}
	return (
		<div className="candidate-groups">
			{[...groups.entries()].map(([key, group]) => (
				<div key={key} className="candidate-group">
					<span className="candidate-group-label">
						{group.label}
						{group.market ? '' : ` · ${group.iids.length}`}
					</span>
					<div
						className={`candidate-row${group.market ? ' candidate-market' : ''}`}
					>
						{group.market
							? marketSlots(
									group.iids,
									projected.cards as unknown as Readonly<
										Record<string, { zone: ZoneRef } | undefined>
									>,
								).map(({ suit, offers, deck }) => (
									<MarketSlot
										key={suit}
										suit={suit}
										deckPick={
											deck === undefined
												? undefined
												: {
														selected: selected.includes(deck),
														disabled: disabledByIid.get(deck),
														onClick: () =>
															useGameStore.getState().cardClicked(deck),
													}
										}
									>
										{offers.map(tile)}
									</MarketSlot>
								))
							: group.iids.map(tile)}
					</div>
				</div>
			))}
		</div>
	)
}

const NO_REASONS: ReadonlyMap<CardInstanceId, string> = new Map()

function ChooseLocationChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_LOCATION' }>
}) {
	const selected = useSelected()
	const chosen = selected[0] ?? null
	const skip = choice.candidates.includes(SKIP_CONTROL)

	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<LocationPicker
				offered={choice.candidates.filter((iid) => iid !== SKIP_CONTROL)}
				disabled={NO_REASONS}
				selected={selected}
			/>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					disabled={chosen === null}
					onClick={() => confirmChoice(chosen!)}
				>
					Confirm
				</button>
				{skip && (
					<button
						type="button"
						className="btn"
						onClick={() => confirmChoice(SKIP_CONTROL)}
					>
						Skip (decline take-control)
					</button>
				)}
			</div>
		</section>
	)
}

/** The Location picker every choice of Locations goes through — the Location
 *  choice and a card choice that offers only Locations in play. It lays them
 *  out by area like the board: Your Location Area and the Neutral Zone always,
 *  the opponent's area when it holds one on offer. Every Location carries its
 *  Away Teams and ships; the ones not on offer stay, greyed, so the tokens
 *  around the table can still be read. */
function LocationPicker({
	offered,
	disabled,
	selected,
}: {
	offered: readonly CardInstanceId[]
	/** greyed with the engine's reason (CHOOSE_CARDS `disabled`) */
	disabled: ReadonlyMap<CardInstanceId, string>
	selected: readonly CardInstanceId[]
}) {
	const projected = useProjected()
	const viewer = useViewerSeat()
	if (projected === null) return null
	const zone = (ref: ZoneRef) => projected.zones[zoneKey(ref)] ?? []
	const theirs = zone({ k: 'LOCATION_AREA', seat: otherSeat(viewer) })
	const groups: [string, readonly CardInstanceId[]][] = [
		['Your Location Area', zone({ k: 'LOCATION_AREA', seat: viewer })],
		[
			'Neutral Zone',
			([0, 1, 2] as const).flatMap((slot) => zone({ k: 'NEUTRAL_ZONE', slot })),
		],
	]
	if (theirs.some((iid) => offered.includes(iid) || disabled.has(iid)))
		groups.push(["Opponent's Location Area", theirs])
	const shown = new Set(groups.flatMap(([, iids]) => iids))
	const elsewhere = offered.filter((iid) => !shown.has(iid))
	if (elsewhere.length > 0) groups.push(['Elsewhere', elsewhere])

	return (
		<div className="candidate-groups location-groups">
			{groups
				.filter(([, iids]) => iids.length > 0)
				.map(([label, iids]) => (
					<div key={label} className="candidate-group">
						<span className="candidate-group-label">{label}</span>
						<div className="candidate-row">
							{iids.map((iid) => {
								const isOffered = offered.includes(iid)
								const reason = disabled.get(iid)
								const isSel = selected.includes(iid)
								return (
									<div
										key={iid}
										className={`candidate-tile location-tile${isSel ? ' candidate-selected' : ''}`}
										title={reason}
									>
										<LocationCard
											iid={iid}
											selected={isSel}
											dimmed={!isOffered}
											reason={reason}
											onClick={
												isOffered
													? () => useGameStore.getState().cardClicked(iid)
													: undefined
											}
										/>
										<LocationLabel iid={iid} />
										{reason !== undefined && (
											<span className="muted small why-not">
												why not: {reason}
											</span>
										)}
									</div>
								)
							})}
						</div>
					</div>
				))}
		</div>
	)
}

/** Under a Fleet SHIP candidate: where its token is right now, so a choice like
 *  "beam to a SHIP … to send an Away Team where this ship is" shows the
 *  destination. Same wording as the phone tile's chip (tile/CardTile.tsx). */
function ShipWhere({ iid }: { iid: CardInstanceId }) {
	const projected = useProjected()
	const card = projected?.cards[iid]
	const at = card?.shipTokenAt ?? null
	const atDef = useDefForIid(at === 'SUPPLY' ? null : at)
	if (card?.zone.k !== 'FLEET') return null
	return (
		<span className="small ship-where">
			{at === null
				? 'token on card'
				: at === 'SUPPLY'
					? 'token in supply'
					: `at ${cardName(atDef) ?? at}`}
		</span>
	)
}

function LocationLabel({ iid }: { iid: CardInstanceId }) {
	const def = useDefForIid(iid)
	return <span className="small">{cardName(def) ?? iid}</span>
}

function ChooseSuitChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_SUIT' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.suits.map((suit: MarketSuit) => (
					<button
						key={suit}
						type="button"
						className="btn"
						onClick={() => confirmChoice(suit)}
					>
						{suit}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseTraitChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_TRAIT' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.traits.map((trait: TraitId) => (
					<button
						key={trait}
						type="button"
						className="btn"
						onClick={() => confirmChoice(trait)}
					>
						{trait}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseSpecialtyChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_SPECIALTY' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.specialties.map((s: SpecialtyId) => (
					<button
						key={s}
						type="button"
						className={`btn specialty-btn specialty-${s.toLowerCase()}`}
						onClick={() => confirmChoice(s)}
					>
						{s}
					</button>
				))}
			</div>
		</section>
	)
}

function ChooseDestinationChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_DESTINATION' }>
}) {
	const destinationDefault = useGameStore((s) => s.destinationDefault)
	const [remember, setRemember] = useState(destinationDefault !== null)
	const pick = (opt: 'DECK_TOP' | 'DISCARD') => {
		if (remember) useGameStore.getState().setDestinationDefault(opt)
		else useGameStore.setState({ destinationDefault: null })
		confirmChoice(opt)
	}
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-dest">
				<div className="dest-card">
					<CardSprite iid={choice.card} size="board" detailOnHover={false} />
				</div>
				<div className="dest-options">
					{choice.options.map((opt) => (
						<button
							key={opt}
							type="button"
							className={`btn btn-primary dest-btn${destinationDefault === opt ? ' dest-default' : ''}`}
							onClick={() => pick(opt)}
						>
							{opt === 'DECK_TOP' ? 'Top of deck' : 'Discard pile'}
						</button>
					))}
					<label className="dest-remember">
						<input
							type="checkbox"
							checked={remember}
							onChange={(e) => setRemember(e.target.checked)}
						/>
						Remember decision
					</label>
				</div>
			</div>
		</section>
	)
}

function ChooseAmountChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_AMOUNT' }>
}) {
	const [value, setValue] = useState(choice.min)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader
				choice={choice}
				extra={
					<span className="choice-count muted">
						{choice.min}..{choice.max}
					</span>
				}
			/>
			<div className="choice-actions amount-row">
				<button
					type="button"
					className="btn"
					onClick={() => setValue(Math.max(choice.min, value - 1))}
					aria-label="decrease"
				>
					−
				</button>
				<strong className="amount-value">{value}</strong>
				<button
					type="button"
					className="btn"
					onClick={() => setValue(Math.min(choice.max, value + 1))}
					aria-label="increase"
				>
					+
				</button>
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(value)}
				>
					Confirm {value}
				</button>
			</div>
		</section>
	)
}

// ---------------------------------------------------------------------------
// ordering / reactions
// ---------------------------------------------------------------------------

function OrderList<T>({
	order,
	move,
	render,
	ariaPrefix,
}: {
	order: T[]
	move: (up: boolean, index: number) => void
	render: (item: T, index: number) => ReactNode
	ariaPrefix: string
}) {
	return (
		<ol className="order-list">
			{order.map((item, i) => (
				<li key={ariaPrefix + i} className="order-row">
					<span className="order-index">{i + 1}</span>
					{render(item, i)}
					<span className="order-actions">
						<button
							type="button"
							className="btn micro"
							disabled={i === 0}
							onClick={() => move(true, i)}
							aria-label="move up"
						>
							↑
						</button>
						<button
							type="button"
							className="btn micro"
							disabled={i === order.length - 1}
							onClick={() => move(false, i)}
							aria-label="move down"
						>
							↓
						</button>
					</span>
				</li>
			))}
		</ol>
	)
}

function OpName({ ref }: { ref: OperationRef }) {
	const def = useDefForIid(ref.card)
	const op = def?.operations[ref.opIndex]
	return (
		<span className="op-name">
			<strong>{cardName(def) ?? ref.card}</strong>
			{op !== undefined && (
				<span className="muted small">
					{' '}
					— <OpText text={describeOperation(op)} plain />
				</span>
			)}
		</span>
	)
}

function OrderOperationsChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'ORDER_OPERATIONS' }>
}) {
	const [order, move] = useOrderState<OperationRef>(choice.pending)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<OrderList
				order={order}
				move={move}
				ariaPrefix="op"
				render={(ref) => <OpName ref={ref} />}
			/>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(order)}
				>
					Resolve in this order
				</button>
				<button
					type="button"
					className="btn"
					onClick={() => confirmChoice(choice.pending)}
				>
					Auto (current order)
				</button>
			</div>
		</section>
	)
}

function OptionalTriggersChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'OPTIONAL_TRIGGERS' }>
}) {
	const [picked, setPicked] = useState<OperationRef[]>([])
	const toggle = (ref: OperationRef) => {
		setPicked((prev) => {
			const has = prev.some(
				(p) => p.card === ref.card && p.opIndex === ref.opIndex,
			)
			return has
				? prev.filter(
						(p) => !(p.card === ref.card && p.opIndex === ref.opIndex),
					)
				: [...prev, ref]
		})
	}
	const several = choice.offered.length > 1
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} sourceLabel="Triggered by" />
			<ul className="reaction-list">
				{choice.offered.map((ref) => (
					<ReactionRow
						key={`${ref.card}#${ref.opIndex}`}
						opRef={ref}
						order={
							picked.findIndex(
								(p) => p.card === ref.card && p.opIndex === ref.opIndex,
							) + 1
						}
						showOrder={several}
						onToggle={() => toggle(ref)}
					/>
				))}
			</ul>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					disabled={picked.length === 0}
					onClick={() => confirmChoice(picked)}
				>
					Use selected ({picked.length})
				</button>
				<button type="button" className="btn" onClick={() => confirmChoice([])}>
					{several ? 'Skip all' : 'Skip'}
				</button>
			</div>
			{several && (
				<p className="muted small">
					The reactions you pick resolve in the order you pick them.
				</p>
			)}
		</section>
	)
}

/** One offered REACTION: its card, the card's printed wording of the
 *  operation, and the toggle. `order` is its place among the picked ones
 *  (0 = not picked); hovering highlights the card where it sits in play. */
function ReactionRow({
	opRef,
	order,
	showOrder,
	onToggle,
}: {
	opRef: OperationRef
	order: number
	/** several are offered, so the pick order matters */
	showOrder: boolean
	onToggle: () => void
}) {
	const def = useDefForIid(opRef.card)
	const text = def === null ? null : opWording(def, opRef.opIndex)
	const setHoverIid = useGameStore((s) => s.setHoverIid)
	const picked = order > 0
	return (
		<li
			className={`reaction-row${picked ? ' reaction-picked' : ''}`}
			onClick={(e) => {
				// the whole row toggles; the button is the keyboard path
				if ((e.target as HTMLElement).closest('button') === null) onToggle()
			}}
			onMouseEnter={() => setHoverIid(opRef.card)}
			onMouseLeave={() => setHoverIid(null)}
		>
			<CardSprite
				iid={opRef.card}
				size="micro"
				detailOnHover={false}
				hoverable={false}
			/>
			<div className="reaction-body">
				<strong className="reaction-name">{cardName(def) ?? opRef.card}</strong>
				{text !== null && (
					<p className="reaction-text">
						<OpText text={text} plain />
					</p>
				)}
			</div>
			<button
				type="button"
				className={`btn reaction-toggle${picked ? ' option-selected' : ''}`}
				aria-pressed={picked}
				onClick={onToggle}
			>
				{!picked ? 'Use' : showOrder ? `✓ ${order}` : '✓'}
			</button>
		</li>
	)
}

function ChooseWitnessChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_WITNESS' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="witness-sets">
				{choice.sets.map((set, si) => (
					<div key={si} className="witness-set">
						<span className="muted small">Witness set {si + 1}</span>
						<div className="witness-cards">
							{set.map((iid) => (
								<CardSprite
									key={iid}
									iid={iid}
									size="board"
									detailOnHover={false}
								/>
							))}
						</div>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => confirmChoice(set)}
						>
							Choose this set
						</button>
					</div>
				))}
			</div>
		</section>
	)
}

function ChooseWildcardChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'CHOOSE_WILDCARD_AS' }>
}) {
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<div className="choice-options">
				{choice.traits.map((trait) => (
					<button
						key={trait}
						type="button"
						className="btn btn-primary"
						onClick={() => confirmChoice(trait)}
					>
						Treat as {trait}
					</button>
				))}
			</div>
		</section>
	)
}

function OrderCardsChoice({
	choice,
}: {
	choice: Extract<PendingChoice, { k: 'ORDER_CARDS' }>
}) {
	const [order, move] = useOrderState<CardInstanceId>(choice.cards)
	return (
		<section className="panel choice-panel">
			<ChoiceHeader choice={choice} />
			<OrderList
				order={order}
				move={move}
				ariaPrefix="card"
				render={(iid) => <OrderCardLine iid={iid} />}
			/>
			<div className="choice-actions">
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => confirmChoice(order)}
				>
					Confirm order
				</button>
			</div>
		</section>
	)
}

function OrderCardLine({ iid }: { iid: CardInstanceId }) {
	const def = useDefForIid(iid)
	return (
		<span className="op-name">
			<span className="op-card-micro">
				<CardSprite iid={iid} size="micro" detailOnHover={false} />
			</span>
			<strong>{cardName(def) ?? iid}</strong>
		</span>
	)
}

// Shared state for ordering choices (array + up/down mover + setter). Also
// drives the phone's ordering sheets (src/ui/mobile/ChoiceSheet.tsx).
export function useOrderState<T>(
	initial: T[],
): [T[], (up: boolean, index: number) => void, (list: T[]) => void] {
	const [order, setOrder] = useState<T[]>(initial)
	const move = (up: boolean, index: number) => {
		setOrder((prev) => {
			const target = up ? index - 1 : index + 1
			if (target < 0 || target >= prev.length) return prev
			const next = [...prev]
			const item = next[index]
			if (item === undefined) return prev
			next.splice(index, 1)
			next.splice(target, 0, item)
			return next
		})
	}
	return [order, move, setOrder]
}
