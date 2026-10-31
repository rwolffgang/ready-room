// Stardate-track spec data (todo/12 pass 3). The static `CardDefSchema` has no
// field for a Stardate card's sequence, printed Glory, or modes (docs/data-model
// .md §1 — collides with the `StardateSpec` wrapper in src/engine/setup.ts), so
// those live here in a small derived table keyed by card id. The 32 defs on
// disk (src/data/cards/common/stardate.json) are the single source of truth for
// the card faces; this file supplies the track metadata, and both loaders
// (src/data/catalog.ts + src/ui/browserCatalog.ts) build the `StardateSpec[]`
// via `stardateSpecs()` so the Node and browser paths cannot drift.
//
// Source: the physical card scans in the user's Tabletop Simulator mod
// (workshop 3474332258 "Star Trek: Captain's Chair W/ Promo Cards", the seven
// face-up Stardate decks under the "Stardate Cards" label). STCC has no
// Stardate cards. Every card prints a title, a sequence number (top right), a
// Glory amount (bottom left), a collector number SD01–SD32 and — solo cards
// only — a Bot action count (bottom right). Ids are `sd-NN` = the printed SDNN.
//
//   SD01–SD05  2-PLAYER             Glory 5,7,7,6,5 (30)
//   SD06–SD07  SOLO CADET PRACTICE  Glory 5,5
//   SD08–SD12  SOLO VS ENSIGN BOT      6,7,7,6,5 (31)  Bot 2,2,2,2,3
//   SD13–SD17  SOLO VS LIEUTENANT BOT  5,7,7,6,5 (30)  Bot 2,2,3,3,3
//   SD18–SD22  SOLO VS COMMANDER BOT   5,7,7,6,5 (30)  Bot 2,3,3,3,4
//   SD23–SD27  SOLO VS CAPTAIN BOT     5,6,7,6,5 (29)  Bot 3,3,3,4,4
//   SD28–SD32  SOLO VS ADMIRAL BOT     5,5,6,6,5 (27)  Bot 3,3,4,4,5
//
// The solo cards are the SOLO mode's (rules/13 §13.2): setup takes the five of
// the chosen difficulty level, and each one's Bot action count rides along in
// `StardateSpec.solo`.

import type { CardDef } from './schema'
import type {
	GameMode,
	SoloLevel,
	SoloStardate,
	StardateSpec,
} from '../engine/setup'

interface StardateMeta {
	id: string
	sequence: number
	glory: number
	modes: GameMode[]
	solo?: SoloStardate
}

const META = new Map<string, StardateMeta>()

function addSet(
	firstSd: number,
	glories: number[],
	modes: GameMode[],
	solo?: { level: SoloLevel; botActions: number[] },
): void {
	for (const [i, glory] of glories.entries()) {
		const id = `sd-${String(firstSd + i).padStart(2, '0')}`
		const meta: StardateMeta = { id, sequence: i + 1, glory, modes }
		if (solo !== undefined)
			meta.solo = { level: solo.level, botActions: solo.botActions[i]! }
		META.set(id, meta)
	}
}

// rules/02 §2.1 #11: the 2-player game uses the five "2-PLAYER" cards.
addSet(1, [5, 7, 7, 6, 5], ['TWO_PLAYER'])
// rules/10 §10.1: Cadet Training uses the two "SOLO CADET PRACTICE" cards.
addSet(6, [5, 5], ['CADET'])
addSet(8, [6, 7, 7, 6, 5], ['SOLO'], { level: 'ENSIGN', botActions: [2, 2, 2, 2, 3] })
addSet(13, [5, 7, 7, 6, 5], ['SOLO'], {
	level: 'LIEUTENANT',
	botActions: [2, 2, 3, 3, 3],
})
addSet(18, [5, 7, 7, 6, 5], ['SOLO'], {
	level: 'COMMANDER',
	botActions: [2, 3, 3, 3, 4],
})
addSet(23, [5, 6, 7, 6, 5], ['SOLO'], {
	level: 'CAPTAIN',
	botActions: [3, 3, 3, 4, 4],
})
addSet(28, [5, 5, 6, 6, 5], ['SOLO'], {
	level: 'ADMIRAL',
	botActions: [3, 3, 4, 4, 5],
})

/** Total Stardate faces the pipeline must ship (SD01–SD32: 5 two-player +
 *  2 Cadet + 5 solo levels × 5). */
export const STARDATE_COUNT = META.size

/** Wrap the parsed `CardDef[]` from common/stardate.json into `StardateSpec[]`.
 *  Every def must have a track entry (a card with no sequence/glory/modes is a
 *  hard error — same spirit as the schema gate). */
export function stardateSpecs(defs: CardDef[]): StardateSpec[] {
	if (defs.length !== STARDATE_COUNT) {
		throw new Error(
			`stardate.json must carry exactly ${STARDATE_COUNT} cards (got ${defs.length})`,
		)
	}
	const seen = new Set<string>()
	const out = defs.map((def): StardateSpec => {
		if (seen.has(def.id))
			throw new Error(`stardate.json has a duplicate card id '${def.id}'`)
		seen.add(def.id)
		const meta = META.get(def.id)
		if (meta === undefined) {
			throw new Error(
				`stardate.json card '${def.id}' has no sequence/glory/mode mapping (src/data/stardate.ts)`,
			)
		}
		const spec: StardateSpec = {
			id: def.id,
			name: def.name ?? def.id,
			sequence: meta.sequence,
			glory: meta.glory,
			modes: meta.modes,
			def,
		}
		if (meta.solo !== undefined) spec.solo = meta.solo
		return spec
	})
	for (const meta of META.values()) {
		if (!seen.has(meta.id)) {
			throw new Error(
				`stardate mapping for '${meta.id}' has no card face in stardate.json`,
			)
		}
	}
	return out
}
