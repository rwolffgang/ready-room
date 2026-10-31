// The Five-Year Mission (rules/14) in the app: the setup screen's panel to
// start or continue a campaign, the campaign's logbook between games (your
// rank, the next game, the upgrade after each game, the performance review),
// and the hook that logs a campaign game's result when it ends. The record
// itself is src/session/campaign.ts; each game is an ordinary solo save that
// names its campaign.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CardCatalog } from '../../engine/setup'
import type { BonusRef, GameState } from '../../engine/state'
import type { DeckId } from '../../data/ids'
import type { BotBonus, CardDef } from '../../data/schema'
import { describe } from '../../engine/describe'
import { replay, type Session } from '../../session/log'
import {
	CAMPAIGN_MODES,
	CHALLENGES,
	applyUpgrade,
	currentGame,
	isOver,
	leanStart,
	newCampaign,
	nextGameConfig,
	nextLevel,
	nextStep,
	opponents,
	pendingUpgrade,
	performanceReview,
	rankOf,
	recordResult,
	startGame as logGame,
	upgradeOptions,
	type Campaign,
	type CampaignGame,
	type CampaignMode,
	type Challenge,
	type Upgrade,
} from '../../session/campaign'
import { cardNameById, deckLabel } from '../../data/cardNames'
import { OpText } from '../cards'
import { getSessionStore } from '../persistence'
import { stccBotFor } from '../stcc'
import { useGameStore, useProjected, useSession } from '../store'
import { AcText } from './AutomatedCommand'
import { Portrait, RankPips } from '../launch/parts'
import {
	CHALLENGE_LABEL,
	MODE_LABEL,
	RANK_LABEL,
	SOLO_LEVEL_LABEL,
} from './labels'

const nowIso = () => new Date().toISOString()
const randomSeed = () => Math.floor(Math.random() * 0x7fffffff)

function newCampaignId(): string {
	return `campaign-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x3fffffff).toString(36)}`
}

/** The Bot crews of the catalog (those with Automated Command cards). */
function botCrews(catalog: CardCatalog): DeckId[] {
	return (catalog.bots ?? []).map((b) => b.deck)
}

/** Does `crew` start with a deployed SHIP (the One ship challenge needs one)? */
function hasStartingShip(catalog: CardCatalog, crew: DeckId): boolean {
	return catalog.defs.some(
		(d) =>
			d.deck === crew && d.suit === 'SHIP' && d.startPosition === 'DEPLOYED',
	)
}

const card = (def: string) => <OpText text={`[[card:${def}]]`} plain />

// ---------------------------------------------------------------------------
// The setup screen's panel
// ---------------------------------------------------------------------------

/** Start a campaign with Player 1's captain and side, or continue one. */
export function CampaignSetupPanel({
	catalog,
	you,
	side,
}: {
	catalog: CardCatalog
	you: DeckId
	side: 'BASIC' | 'ADVANCED'
}) {
	const openCampaign = useGameStore((s) => s.openCampaign)
	const [saved, setSaved] = useState<Campaign[] | null>(null)
	const [mode, setMode] = useState<CampaignMode>('NORMAL')
	const [picked, setPicked] = useState<Challenge[]>([])
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
	const reload = useCallback(() => {
		void getSessionStore()
			.listCampaigns()
			.then(setSaved)
			.catch(() => setSaved([]))
	}, [])
	useEffect(reload, [reload])
	if (botCrews(catalog).length === 0) return null
	const shipOk = hasStartingShip(catalog, you)
	const toggle = (c: Challenge) =>
		setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))
	const begin = async () => {
		const c = newCampaign({
			id: newCampaignId(),
			crew: you,
			side,
			mode,
			challenges: picked.filter((x) => x !== 'ONE_SHIP' || shipOk),
			now: nowIso(),
		})
		await getSessionStore().saveCampaign(c)
		openCampaign(c.id)
	}
	return (
		<section className="lr-campaign" aria-label="Five-Year Mission">
			{saved !== null && saved.length > 0 && (
				<div className="lr-sub">
					<h3 className="lr-sub-head">Campaigns on this device</h3>
					<ul className="lr-campaigns">
						{saved.map((c) => {
							const rank = rankOf(c)
							const played = c.games.filter((g) => g.won !== undefined).length
							return (
								<li key={c.id} className={isOver(c) ? 'is-over' : undefined}>
									<Portrait
										catalog={catalog}
										deck={c.crew}
										className="lr-avatar"
									/>
									<span className="lr-campaign-meta">
										<strong>{deckLabel(c.crew)}</strong>
										<span>
											<RankPips rank={rank} /> {RANK_LABEL[rank]} ·{' '}
											{MODE_LABEL[c.mode].title} · {played} game
											{played === 1 ? '' : 's'}
											{isOver(c) ? ' · over' : ''}
										</span>
									</span>
									<span className="lr-campaign-actions">
										<button
											type="button"
											className="btn micro btn-primary"
											onClick={() => openCampaign(c.id)}
										>
											{isOver(c) ? 'Logbook' : 'Continue'}
										</button>
										<button
											type="button"
											className="btn micro"
											onClick={() => {
												if (confirmDelete !== c.id)
													return setConfirmDelete(c.id)
												void getSessionStore()
													.removeCampaign(c.id)
													.then(() => {
														setConfirmDelete(null)
														reload()
													})
											}}
											aria-label={`delete campaign ${deckLabel(c.crew)}`}
										>
											{confirmDelete === c.id ? 'Really delete?' : 'Delete'}
										</button>
									</span>
								</li>
							)
						})}
					</ul>
				</div>
			)}
			<fieldset className="lr-sub">
				<legend className="lr-sub-head">Mode</legend>
				<div className="lr-cards">
					{CAMPAIGN_MODES.map((m) => (
						<label key={m} className={`lr-card${mode === m ? ' is-on' : ''}`}>
							<input
								type="radio"
								name="campaign-mode"
								checked={mode === m}
								onChange={() => setMode(m)}
							/>
							<strong>{MODE_LABEL[m].title}</strong>
							<span>{MODE_LABEL[m].text}</span>
						</label>
					))}
				</div>
			</fieldset>
			<fieldset className="lr-sub">
				<legend className="lr-sub-head">
					Challenges <small>optional</small>
				</legend>
				<div className="lr-cards lr-cards-wide">
					{CHALLENGES.map((c) => {
						const off = c === 'ONE_SHIP' && !shipOk
						const on = picked.includes(c) && !off
						return (
							<label
								key={c}
								className={`lr-card lr-card-check${on ? ' is-on' : ''}${off ? ' is-off' : ''}`}
								title={off ? 'Your crew has no starting SHIP' : undefined}
							>
								<input
									type="checkbox"
									checked={on}
									disabled={off}
									onChange={() => toggle(c)}
								/>
								<strong>{CHALLENGE_LABEL[c].title}</strong>
								<span>{CHALLENGE_LABEL[c].text}</span>
							</label>
						)
					})}
				</div>
			</fieldset>
			<div className="lr-launchbar">
				<div className="lr-ctas">
					<button type="button" className="lr-go" onClick={() => void begin()}>
						Begin a Five-Year Mission as {deckLabel(you)}
					</button>
				</div>
			</div>
		</section>
	)
}

// ---------------------------------------------------------------------------
// The logbook between games
// ---------------------------------------------------------------------------

/** What a bonus does: the printed text from the fetched STCC data, else our
 *  own description of its mechanics. */
function BonusText({
	catalog,
	at,
	bonus,
}: {
	catalog: CardCatalog
	at: BonusRef
	bonus: BotBonus | undefined
}) {
	const captain = catalog.defs.find(
		(d) => d.deck === at.deck && d.suit === 'CAPTAIN',
	)
	const printed =
		captain === undefined
			? undefined
			: stccBotFor(captain)?.campaign?.[at.side].bonus[at.index]
	if (printed !== undefined)
		return <AcText text={printed.replace(/^\s*\w+:\s*/, '')} />
	if (bonus === undefined) return <>—</>
	if (bonus.k === 'TO_REINFORCEMENT')
		return (
			<>
				Move a non-INCIDENT card from your{' '}
				{bonus.from === 'RESERVE' ? 'Reserve deck' : 'Available cards'} to your
				Reinforcement pile.
			</>
		)
	let text: string
	try {
		text = describe(bonus.effect as Parameters<typeof describe>[0])
	} catch {
		text = '—'
	}
	return (
		<>
			{bonus.when === 'BEFORE_HAND'
				? 'Before your starting hand: '
				: 'At the start: '}
			<OpText text={text} plain />
		</>
	)
}

function bonusOf(catalog: CardCatalog, ref: BonusRef): BotBonus | undefined {
	return catalog.bots?.find((b) => b.deck === ref.deck)?.campaign?.[ref.side]
		.bonus[ref.index]
}

function upgradeLabel(catalog: CardCatalog, u: Upgrade | undefined) {
	if (u === undefined) return '—'
	if (u.k === 'NONE') return 'none'
	if (u.k === 'CARD') return card(u.def)
	if (u.def !== undefined) return card(u.def)
	return (
		<BonusText catalog={catalog} at={u.ref} bonus={bonusOf(catalog, u.ref)} />
	)
}

/** The campaign's logbook: where it stands and what comes next. */
export function CampaignScreen({
	id,
	catalog,
}: {
	id: string
	catalog: CardCatalog
}) {
	const openCampaign = useGameStore((s) => s.openCampaign)
	const [c, setC] = useState<Campaign | null | undefined>(undefined)
	const [error, setError] = useState<string | null>(null)
	const load = useCallback(() => {
		void getSessionStore()
			.loadCampaign(id)
			.then(async (loaded) => {
				// a game that ended without its result logged (the app closed on
				// the end screen): log it from its save now
				const game = loaded === null ? undefined : currentGame(loaded)
				if (loaded !== null && game !== undefined) {
					const save = await getSessionStore().load(game.sessionId)
					if (save !== null && save.meta.result === 'COMPLETE') {
						const next = logResult(loaded, save, replay(save, catalog))
						if (next !== loaded) await getSessionStore().saveCampaign(next)
						return setC(next)
					}
				}
				setC(loaded)
			})
			.catch((e: unknown) => setError(String(e)))
	}, [id, catalog])
	useEffect(load, [load])
	const save = async (next: Campaign) => {
		await getSessionStore().saveCampaign(next)
		setC(next)
	}
	if (c === undefined)
		return <main className="campaign-screen">Loading the logbook…</main>
	if (c === null)
		return (
			<main className="campaign-screen">
				<p>This campaign is gone.</p>
				<button
					type="button"
					className="btn"
					onClick={() => openCampaign(null)}
				>
					Back
				</button>
			</main>
		)
	const step = nextStep(c)
	const review = step === 'OVER' ? performanceReview(c) : null
	return (
		<main className="campaign-screen">
			<header className="campaign-head">
				<h1>Five-Year Mission · {deckLabel(c.crew)}</h1>
				<p className="campaign-rank">
					<strong>{RANK_LABEL[rankOf(c)]}</strong> · {MODE_LABEL[c.mode].title}{' '}
					· {c.side === 'BASIC' ? 'Basic' : 'Advanced'} side
					{c.challenges.length > 0 &&
						` · ${c.challenges.map((x) => CHALLENGE_LABEL[x].title).join(', ')}`}
				</p>
			</header>
			{error !== null && <p role="alert">{error}</p>}

			{review !== null && (
				<section
					className="panel campaign-review"
					aria-label="Performance review"
				>
					<h2>Performance review: {review.title}</h2>
					<p>{review.text}</p>
				</section>
			)}
			{step === 'NEXT_GAME' && (
				<NextGame campaign={c} catalog={catalog} onSave={save} />
			)}
			{step === 'PLAY' && <ContinueGame campaign={c} onMissing={setError} />}
			{step === 'UPGRADE' && (
				<UpgradePicker campaign={c} catalog={catalog} onSave={save} />
			)}

			<section className="panel campaign-log" aria-label="Logbook">
				<h2>Logbook</h2>
				{c.games.length === 0 ? (
					<p className="muted small">No games yet.</p>
				) : (
					<table className="end-table">
						<thead>
							<tr>
								<th scope="col">#</th>
								<th scope="col">The Bot</th>
								<th scope="col">Score</th>
								<th scope="col">Result</th>
								<th scope="col">Upgrade</th>
							</tr>
						</thead>
						<tbody>
							{c.games.map((g, i) => (
								<tr key={g.sessionId}>
									<td>{i + 1}</td>
									<td>
										{deckLabel(g.bot)} ({SOLO_LEVEL_LABEL[g.level]})
									</td>
									<td>
										{g.score === undefined
											? '—'
											: `${g.score[0]} – ${g.score[1]}`}
									</td>
									<td>
										{g.won === undefined ? 'playing' : g.won ? 'won' : 'lost'}
									</td>
									<td>{upgradeLabel(catalog, g.upgrade)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				<h3>Reinforcement pile</h3>
				{c.reinforcement.length === 0 ? (
					<p className="muted small">Empty.</p>
				) : (
					<ul className="campaign-cards">
						{c.reinforcement.map((d) => (
							<li key={d}>{card(d)}</li>
						))}
					</ul>
				)}
				<h3>Boosts</h3>
				{c.boosts.length === 0 ? (
					<p className="muted small">None yet.</p>
				) : (
					<ul className="campaign-cards">
						{c.boosts.map((b, i) => (
							<li key={i}>
								<BonusText
									catalog={catalog}
									at={b}
									bonus={bonusOf(catalog, b)}
								/>
							</li>
						))}
					</ul>
				)}
			</section>
			<button type="button" className="btn" onClick={() => openCampaign(null)}>
				Back to the start screen
			</button>
		</main>
	)
}

/** Pick the next opponent and start the game. */
function NextGame({
	campaign: c,
	catalog,
	onSave,
}: {
	campaign: Campaign
	catalog: CardCatalog
	onSave: (c: Campaign) => Promise<void>
}) {
	const startGame = useGameStore((s) => s.startGame)
	const choices = opponents(c, botCrews(catalog))
	const [bot, setBot] = useState<DeckId | 'RANDOM'>('RANDOM')
	const [lean, setLean] = useState<'DIL' | 'LAT'>('DIL')
	const level = nextLevel(c)
	const go = async () => {
		const vs =
			bot === 'RANDOM'
				? choices[Math.floor(Math.random() * choices.length)]!
				: bot
		const config = nextGameConfig(c, vs, randomSeed(), lean)
		startGame(config, undefined, { campaignId: c.id })
		const session = useGameStore.getState().session
		if (session === null) return
		await onSave(logGame(c, config, session.id, nowIso()))
	}
	return (
		<section className="panel campaign-next" aria-label="Next game">
			<h2>Game {c.games.length + 1}</h2>
			<p className="small">
				The Bot plays at <strong>{SOLO_LEVEL_LABEL[level]}</strong>. You may not
				face a crew you have already beaten.
			</p>
			<div className="deck-picker">
				<strong>Opponent</strong>
				<select
					value={bot}
					onChange={(e) => setBot(e.target.value as DeckId | 'RANDOM')}
					aria-label="The Bot’s crew"
				>
					<option value="RANDOM">At random</option>
					{choices.map((d) => (
						<option key={d} value={d}>
							{deckLabel(d)}
						</option>
					))}
				</select>
			</div>
			{leanStart(c) === 1 && (
				<div className="deck-picker">
					<strong>Lean start: begin without</strong>
					<select
						value={lean}
						onChange={(e) => setLean(e.target.value as 'DIL' | 'LAT')}
						aria-label="Resource to start without"
					>
						<option value="DIL">Dilithium</option>
						<option value="LAT">Latinum</option>
					</select>
				</div>
			)}
			<button
				type="button"
				className="btn btn-primary btn-lg"
				disabled={choices.length === 0}
				onClick={() => void go()}
			>
				Start game {c.games.length + 1}
			</button>
		</section>
	)
}

/** The game in progress: back to its save. */
function ContinueGame({
	campaign: c,
	onMissing,
}: {
	campaign: Campaign
	onMissing: (msg: string) => void
}) {
	const resumeGame = useGameStore((s) => s.resumeGame)
	const game = currentGame(c)!
	const go = async () => {
		const save = await getSessionStore().load(game.sessionId)
		if (save === null) return onMissing('The save of this game is gone.')
		resumeGame(save)
	}
	return (
		<section className="panel campaign-next" aria-label="Game in progress">
			<h2>Game {c.games.length} in progress</h2>
			<p className="small">
				Against {deckLabel(game.bot)} at {SOLO_LEVEL_LABEL[game.level]}.
			</p>
			<button
				type="button"
				className="btn btn-primary btn-lg"
				onClick={() => void go()}
			>
				Continue game {c.games.length}
			</button>
		</section>
	)
}

/** After a game: Option A (a Market card) or Option B (a bonus). */
function UpgradePicker({
	campaign: c,
	catalog,
	onSave,
}: {
	campaign: Campaign
	catalog: CardCatalog
	onSave: (c: Campaign) => Promise<void>
}) {
	const defs = useMemo(
		() => new Map<string, CardDef>(catalog.defs.map((d) => [d.id, d])),
		[catalog],
	)
	const game = pendingUpgrade(c)!
	const bot = catalog.bots?.find((b) => b.deck === game.bot)
	const options = useMemo(() => upgradeOptions(c, bot, defs), [c, bot, defs])
	const [choice, setChoice] = useState<number>(0)
	const [crewCard, setCrewCard] = useState<string | null>(null)
	if (options === undefined) return null
	const offers: {
		key: string
		label: React.ReactNode
		upgrade: (def?: string) => Upgrade
		cards?: string[]
	}[] = [
		...options.cards.map((def) => ({
			key: `card:${def}`,
			label: <>Add {card(def)} to your Reinforcement pile</>,
			upgrade: (): Upgrade => ({ k: 'CARD', def }),
		})),
		...options.bonuses.map((b) => ({
			key: `bonus:${b.ref.index}`,
			label: (
				<BonusText
					catalog={catalog}
					at={b.ref}
					bonus={bonusOf(catalog, b.ref)}
				/>
			),
			upgrade: (def?: string): Upgrade => ({ k: 'BONUS', ref: b.ref, def }),
			...(b.k === 'TO_REINFORCEMENT' ? { cards: b.cards } : {}),
		})),
	]
	const picked = offers[choice]
	const needsCard = picked?.cards !== undefined
	const pickedCard = needsCard ? (crewCard ?? picked.cards![0]) : undefined
	const take = async () => {
		const upgrade: Upgrade =
			picked === undefined ? { k: 'NONE' } : picked.upgrade(pickedCard)
		await onSave(applyUpgrade(c, options, upgrade, nowIso()))
	}
	return (
		<section className="panel campaign-upgrade" aria-label="Upgrade">
			<h2>
				{game.won === true ? 'Victory' : 'Defeat'} against {deckLabel(game.bot)}
				: upgrade your deck
			</h2>
			{offers.length === 0 ? (
				<p className="small">
					{options.marketOnly
						? 'None of your Market cards matches, and the Market-only challenge closes the bonuses: no upgrade this time.'
						: 'Nothing matches: no upgrade this time.'}
				</p>
			) : (
				<>
					<p className="muted small">
						{options.cards.length > 0 && options.bonuses.length > 0
							? 'A Market card you owned that matches the Bot’s list, or one of its bonuses:'
							: options.cards.length > 0
								? 'A Market card you owned that matches the Bot’s list:'
								: 'None of your Market cards matches, so pick one of the Bot’s bonuses:'}
					</p>
					<div className="campaign-offers" role="radiogroup">
						{offers.map((o, i) => (
							<label key={o.key} className="small">
								<input
									type="radio"
									name="campaign-upgrade"
									checked={choice === i}
									onChange={() => {
										setChoice(i)
										setCrewCard(null)
									}}
								/>{' '}
								{o.label}
							</label>
						))}
					</div>
					{needsCard && (
						<div className="deck-picker">
							<strong>Card</strong>
							<select
								value={pickedCard}
								onChange={(e) => setCrewCard(e.target.value)}
								aria-label="The crew card to move"
							>
								{picked.cards!.map((d) => (
									<option key={d} value={d}>
										{cardNameById(d)}
									</option>
								))}
							</select>
						</div>
					)}
				</>
			)}
			<button
				type="button"
				className="btn btn-primary btn-lg"
				onClick={() => void take()}
			>
				{offers.length === 0 ? 'Continue' : 'Take this upgrade'}
			</button>
		</section>
	)
}

// ---------------------------------------------------------------------------
// The end of a campaign game
// ---------------------------------------------------------------------------

/** Your result in a finished campaign game. */
function logResult(c: Campaign, save: Session, state: GameState): Campaign {
	const end = state.result
	if (end?.kind !== 'COMPLETE') return c
	const bot = state.solo?.bot ?? 1
	const you = bot === 1 ? 0 : 1
	const totals = end.scoreboard.breakdown.map((b) => b.total)
	return recordResult(
		c,
		{
			sessionId: save.id,
			score: [totals[you]!, totals[bot]!],
			won: end.scoreboard.winners.includes(you),
			marketOwned: state.solo?.marketOwned ?? [],
		},
		nowIso(),
	)
}

/** On the end screen of a campaign game: log the result once, and offer the
 *  way back to the logbook. */
export function CampaignEnd() {
	const session = useSession()
	const projected = useProjected()
	const real = useGameStore((s) => s.state)
	const openCampaign = useGameStore((s) => s.openCampaign)
	const newGame = useGameStore((s) => s.newGame)
	const id = session?.campaignId
	const [logged, setLogged] = useState<CampaignGame | null>(null)
	useEffect(() => {
		if (
			id === undefined ||
			session === null ||
			real === null ||
			real.result === null
		)
			return
		void getSessionStore()
			.loadCampaign(id)
			.then(async (c) => {
				if (c === null) return
				const next = logResult(c, session, real)
				if (next !== c) await getSessionStore().saveCampaign(next)
				setLogged(next.games.find((g) => g.sessionId === session.id) ?? null)
			})
	}, [id, session, real])
	if (id === undefined || projected === null) return null
	return (
		<section className="panel campaign-end" aria-label="Five-Year Mission">
			<p className="small">
				Five-Year Mission
				{logged?.won !== undefined
					? logged.won
						? ': a win — you are promoted.'
						: ': a loss.'
					: '.'}
				{(projected as unknown as GameState).solo?.lost === 'STARTING_SHIP' &&
					' You lost your starting SHIP.'}
			</p>
			<button
				type="button"
				className="btn btn-primary btn-lg"
				onClick={() => {
					newGame()
					openCampaign(id)
				}}
			>
				To the logbook
			</button>
		</section>
	)
}
