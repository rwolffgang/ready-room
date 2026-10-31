// The card-data hash (todo/17 §1). Sessions record it to detect card-data
// drift between saves (src/session/log.ts `checkCardData`), the online server
// stamps it on every game, and the house AI's learned value function
// (src/bot/learned.ts) records the hash it was trained on, so weights trained
// on other card data fall back to the hand-tuned evaluation.

import type { CardCatalog } from '../engine/setup'
import type { DeckId } from './ids'

/** Deterministic drift-detector over the card data a session was played
 *  against: defs + stardates + crew boards, keyed canonically, hashed with two
 *  additive 32-bit passes. Not cryptographic — it exists to catch "I edited a
 *  card" between weeks, not adversarial collisions. */
export function cardDataHash(catalog: CardCatalog): string {
	const defs = [...catalog.defs]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((d) => JSON.stringify(d))
	const stardates = [...catalog.stardates]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((sd) => JSON.stringify(sd))
	const boards = Object.keys(catalog.boards)
		.sort()
		.map((deck) => `${deck}=${JSON.stringify(catalog.boards[deck as DeckId])}`)
	const bots = [...(catalog.bots ?? [])]
		.sort((a, b) => a.deck.localeCompare(b.deck))
		.map((bot) => JSON.stringify(bot))
	const payload = `v1|${defs.join('\n')}|${stardates.join('\n')}|${boards.join('\n')}${
		bots.length > 0 ? `|${bots.join('\n')}` : ''
	}`
	return hashString(payload)
}

/** FNV-1a and djb2 over a string's UTF-16 code units, as 16 hex digits. */
export function hashString(payload: string): string {
	let h1 = 0x811c9dc5 // FNV-1a
	let h2 = 5381 // djb2
	for (let i = 0; i < payload.length; i++) {
		const c = payload.charCodeAt(i)
		h1 ^= c
		h1 = Math.imul(h1, 0x01000193)
		h2 = (Math.imul(h2, 33) + c) >>> 0
	}
	const a = (h1 >>> 0).toString(16).padStart(8, '0')
	const b = (h2 >>> 0).toString(16).padStart(8, '0')
	return `${a}${b}`
}

// Callers recompute the hash often (refreshMeta after every intent); the
// catalog is identity-stable within a session, so memoise per catalog object
// (a full catalog hash is a few hundred KB of JSON — not worth redoing).
const catalogHashCache = new WeakMap<CardCatalog, string>()

/** `cardDataHash`, memoised per catalog object. */
export function cardDataHashCached(catalog: CardCatalog): string {
	const hit = catalogHashCache.get(catalog)
	if (hit !== undefined) return hit
	const hash = cardDataHash(catalog)
	catalogHashCache.set(catalog, hash)
	return hash
}
