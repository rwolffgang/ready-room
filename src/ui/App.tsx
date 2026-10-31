// Root app shell (todo/14). Three screens:
//   - LaunchScreen — the start screen: the ways to play, captains, saved
//                    games (launch/LaunchScreen.tsx)
//   - GameScreen   — board + areas + hand + log + choice panel, hot-seat flow
//   - EndScreen    — winner banner + scoring breakdown (EndScreen.tsx, todo/10)
// plus the overlay hosts (CardDetail, PileBrowser, Rules drawer, Card List).
//
// Components never read the raw state — everything renders `useProjected()`.

import { useEffect, useState } from 'react'
import type { GameState } from '../engine/state'
import { useProjected, useGameStore, useCatalog } from './store'
import { CardDetailHost, PileBrowserHost } from './cards'
import { RulesDrawer, CardListPanel } from './rules'
import { DeckReview } from './deckReview'
import { ReplayHost } from './replay'
import { useShell, type Shell } from './mobile/shell'
import { OnlineLobby, useOnlineRoute } from './online/OnlineLobby'
import { RecapView } from './online/Recap'
import { ShorthandGuide } from './guide/ShorthandGuide'
import { useDefIndex } from './defs'
import { MobileShell } from './mobile/MobileShell'
import { ConsoleShell } from './console/ConsoleShell'
import { SettingsPanel } from './SettingsPanel'
import { deckLabel } from '../data/cardNames'
import { EndScreen } from './EndScreen'
import { CampaignScreen } from './solo/Campaign'
import { LaunchScreen } from './launch/LaunchScreen'

function useRuleAnchor(): [string | null, (a: string | null) => void] {
	const [anchor, setAnchor] = useState<string | null>(null)
	useEffect(() => {
		const listener = (e: Event) => {
			const v = (e as CustomEvent<string>).detail
			setAnchor(typeof v === 'string' ? v : null)
		}
		window.addEventListener('codex:open-rule', listener)
		return () => window.removeEventListener('codex:open-rule', listener)
	}, [])
	return [anchor, setAnchor]
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
	const catalog = useCatalog()
	const loadCatalog = useGameStore((s) => s.loadCatalog)
	const [ruleAnchor, setRuleAnchor] = useRuleAnchor()
	const inGame = useGameStore((s) => s.state !== null && s.session !== null)
	const online = useGameStore((s) => s.online !== null)
	const campaign = useGameStore((s) => s.campaignOpen)
	// phone / phone-wide / tablet / console (docs/ui-mobile.md §2)
	const { shell: chosen } = useShell()
	// the LCARS console plays local games; an online game on a wide screen
	// uses the tablet shell, which reads only the seat view
	const shell: Shell = online && chosen === 'console' ? 'tablet' : chosen
	const route = useOnlineRoute()

	useEffect(() => {
		loadCatalog()
	}, [loadCatalog])
	// going to Hails or New (a link, a bookmark, the back button) leaves the
	// open online game; an invite link switches games itself
	useEffect(() => {
		if ((route === 'hails' || route === 'new') && online)
			useGameStore.getState().newGame()
	}, [route, online])

	return (
		<div className="app">
			{route !== null && catalog !== null ? (
				<OnlineLobby key={route} route={route} />
			) : online ? (
				<OnlineGame shell={shell} />
			) : !inGame && campaign !== null && catalog !== null ? (
				<CampaignScreen id={campaign} catalog={catalog} />
			) : !inGame ? (
				<LaunchScreen catalogReady={catalog !== null} />
			) : (
				<GameFlow shell={shell} />
			)}
			<Overlays
				ruleAnchor={ruleAnchor}
				setRuleAnchor={setRuleAnchor}
				shell={shell}
			/>
		</div>
	)
}

/** An open online game: connecting, then "Previously on…" when there is news
 *  from the other captain, then the bridge (docs/ui-mobile.md §5). */
function OnlineGame({ shell }: { shell: Shell }) {
	const online = useGameStore((s) => s.online)
	const error = useGameStore((s) => s.error)
	const dismissRecap = useGameStore((s) => s.dismissRecap)
	const defs = useDefIndex()
	if (online === null) return null
	const view = online.view
	if (view === null || (online.recap === null && !online.recapSeen))
		return (
			<main className="ol-screen">
				<p className="ol-sub">Connecting to the game server…</p>
				{error !== null && (
					<>
						<p className="ol-alert" role="alert">
							{error}
						</p>
						<button
							type="button"
							className="ol-pill"
							onClick={() => {
								useGameStore.getState().newGame()
								window.location.hash = 'hails'
							}}
						>
							Back to Hails
						</button>
					</>
				)}
			</main>
		)
	if (!online.recapSeen && online.recap !== null)
		return (
			<RecapView
				recap={online.recap}
				names={[
					view.players[0].name ?? deckLabel(view.players[0].deck),
					view.players[1].name ?? deckLabel(view.players[1].deck),
				]}
				defs={defs}
				defOfIid={(iid) => view.state.cards[iid]?.def ?? null}
				onContinue={dismissRecap}
			/>
		)
	return <GameFlow shell={shell} />
}

function Overlays({
	ruleAnchor,
	setRuleAnchor,
	shell,
}: {
	ruleAnchor: string | null
	setRuleAnchor: (a: string | null) => void
	shell: Shell
}) {
	const rulesOpen = useGameStore((s) => s.rulesOpen)
	const cardListOpen = useGameStore((s) => s.cardListOpen)
	const deckReviewOpen = useGameStore((s) => s.deckReviewOpen)
	const setRulesOpen = useGameStore((s) => s.setRulesOpen)
	const setCardListOpen = useGameStore((s) => s.setCardListOpen)
	const setDeckReviewOpen = useGameStore((s) => s.setDeckReviewOpen)
	const guide = useGameStore((s) => s.guide)
	const openGuide = useGameStore((s) => s.openGuide)
	const closeGuide = useGameStore((s) => s.closeGuide)
	const settingsOpen = useGameStore((s) => s.settingsOpen)
	const setSettingsOpen = useGameStore((s) => s.setSettingsOpen)
	return (
		<>
			{/* the phone shells draw the same detail as a Rosetta sheet */}
			{shell === 'console' && <CardDetailHost />}
			<PileBrowserHost />
			<ReplayHost />
			{rulesOpen && (
				<RulesDrawer
					openAnchor={ruleAnchor}
					onClose={() => {
						setRulesOpen(false)
						setRuleAnchor(null)
					}}
				/>
			)}
			{cardListOpen && <CardListPanel onClose={() => setCardListOpen(false)} />}
			{deckReviewOpen && (
				<DeckReview onClose={() => setDeckReviewOpen(false)} />
			)}
			{guide !== null && (
				<ShorthandGuide
					section={guide}
					onSection={openGuide}
					onClose={closeGuide}
				/>
			)}
			{settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
		</>
	)
}

// ---------------------------------------------------------------------------
// In-game flow
// ---------------------------------------------------------------------------

function GameFlow({ shell }: { shell: Shell }) {
	const projected = useProjected()
	if (projected === null) {
		return (
			<main className="game-screen">
				<p>Loading…</p>
			</main>
		)
	}
	const state = projected as unknown as GameState
	if (state.result !== null && state.result.kind === 'COMPLETE') {
		return <EndScreen onNewGame={() => useGameStore.getState().newGame()} />
	}
	if (shell !== 'console') return <MobileShell shell={shell} />
	return <ConsoleShell state={state} />
}
