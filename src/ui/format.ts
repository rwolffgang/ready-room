// Small display helpers (todo/14). Kept free of JSX so it can be imported from
// anywhere (including tests). Icons/colours: never colour alone — every
// specialty/suit label pairs a glyph with its text (docs/ui-spec.md §8).
//
// Also owns the human labels for engine enums so the components stay dumb.

import type { BotBeat, Phase } from '../engine/state'
import type { ResourceId, SpecialtyId, Suit } from '../data/ids'
import type { Seat } from '../engine/resolver/queries'

export const SPECIALTY_GLYPH: Record<SpecialtyId, string> = {
	RESEARCH: '◎',
	INFLUENCE: '◈',
	MILITARY: '▲',
}

export const RESOURCE_GLYPH: Record<ResourceId, string> = {
	DIL: '◆',
	LAT: '⬥',
	GLO: '★',
}

export const RESOURCE_LABEL: Record<ResourceId, string> = {
	DIL: 'Dilithium',
	LAT: 'Latinum',
	GLO: 'Glory',
}

export function specialtyName(s: SpecialtyId): string {
	return s.charAt(0) + s.slice(1).toLowerCase()
}

/** Plain-string form for `title` attributes; render `<SpecialtyLabel>`
 *  (icons.tsx) for the on-screen label. */
export function specialtyLabel(s: SpecialtyId): string {
	return `${SPECIALTY_GLYPH[s]} ${specialtyName(s)}`
}

export function resourceLabel(r: ResourceId): string {
	return `${RESOURCE_GLYPH[r]} ${RESOURCE_LABEL[r]}`
}

export function seatLabel(seat: Seat): string {
	return seat === 0 ? 'Player 1' : 'Player 2'
}

/** Compact "5m ago" / "HH:MM" label for a save's updatedAt (todo/17 §1 — the
 *  load screen sorts/drives the list by this, so both fine and coarse humans
 *  need a readable form). */
export function shortUpdatedAt(iso: string): string {
	const d = new Date(iso)
	if (Number.isNaN(d.getTime())) return '—'
	const diffMs = Date.now() - d.getTime()
	const mins = Math.floor(diffMs / 60000)
	if (mins < 1) return 'just now'
	if (mins < 60) return `${mins}m ago`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	if (days < 7) return `${days}d ago`
	return d.toLocaleDateString()
}

export function shortSeat(seat: Seat): string {
	return seat === 0 ? 'P1' : 'P2'
}

export function suitLabel(suit: Suit): string {
	return suit
}

export function phaseLabel(phase: Phase): string {
	switch (phase.k) {
		case 'SETUP':
			return 'Setup'
		case 'RESUPPLY':
			return 'Resupply'
		case 'CONTROL':
			return 'Control'
		case 'ACTION':
			return 'Action'
		case 'CLEANUP':
			return `Clean-up ${cleanupSubLabel(phase.sub)}`
		case 'BOT':
			return `Bot ${BOT_BEAT_LABELS[phase.beat]}`
		case 'GAME_OVER':
			return 'Game over'
	}
}

const BOT_BEAT_LABELS: Record<BotBeat, string> = {
	CONTROL: 'control',
	DRAW: 'draws',
	RESOLVE: 'resolves',
	STARDATE: 'stardate',
	CLEANUP: 'clean-up',
}

const CLEANUP_LABELS: Record<string, string> = {
	OPERATIONS: '(operations)',
	STARDATE: '(stardate)',
	GLORY_PLACEMENT: '(glory)',
	GLORY_TAKEN: '(glory)',
	CADET_WIPE: '(cadet wipe)',
	DISCARD: '(discard)',
	DRAW: '(draw)',
	REFRESH: '(refresh)',
}

function cleanupSubLabel(sub: string): string {
	return CLEANUP_LABELS[sub] ?? sub
}
