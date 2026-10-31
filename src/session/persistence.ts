// Save/load (docs/state-machine.md §7, todo/17 §1). A save IS the Session —
// a few KB of plain JSON (seed + setup + intent log + meta). The GameState
// (hundreds of KB of card instances) is never serialised: load + replay
// recomputes it byte-exactly, so no card object or instance reference ever
// crosses the storage boundary.
//
// `Storage` is the seam: `InMemoryStorage` mocks IndexedDB for headless tests,
// `createIdbStorage` is the browser adapter wrapping idb-keyval (lazily — it
// only touches the global `indexedDB` on first use, so node/jsdom can import
// this module safely).

import { createStore, get, set, del, keys, type UseStore } from 'idb-keyval'
import type { Session } from './log'
import { SESSION_VERSION } from './log'
import { parseOpponents } from './opponents'
import {
	deleteCampaign,
	listCampaigns,
	loadCampaign,
	saveCampaign,
	type Campaign,
} from './campaign'

/** Versioned key namespace: `ready-room:session:v1:<gameId>`. Bumping the
 *  version isolates saves across incompatible formats. */
export const SESSION_KEY_PREFIX = 'ready-room:session:v1'
export const DEFAULT_DB_NAME = 'ready-room'
export const DEFAULT_STORE_NAME = 'sessions'

export function sessionKey(id: string): string {
	return `${SESSION_KEY_PREFIX}:${id}`
}

/** Minimal async key/value seam. IndexedDB (idb-keyval) and the in-memory
 *  test adapter both implement it; the session layer never touches
 *  `indexedDB` directly. */
export interface Storage {
	get(key: string): Promise<unknown>
	set(key: string, value: unknown): Promise<void>
	del(key: string): Promise<void>
	keys(): Promise<string[]>
}

/** In-memory storage for headless tests (todo/17 elsewhere uses it to mock
 *  IndexedDB). Values cross a JSON boundary on write — exactly the
 *  serialisability guarantee a save must satisfy, so a session that stores is
 *  a session that survives the browser. */
export class InMemoryStorage implements Storage {
	private readonly map = new Map<string, unknown>()

	async get(key: string): Promise<unknown> {
		return this.map.get(key)
	}

	async set(key: string, value: unknown): Promise<void> {
		this.map.set(key, JSON.parse(JSON.stringify(value)))
	}

	async del(key: string): Promise<void> {
		this.map.delete(key)
	}

	async keys(): Promise<string[]> {
		return [...this.map.keys()]
	}
}

/** Browser adapter: lazily opens an idb-keyval store on first use. Throws a
 *  clear error when `indexedDB` is absent (node tests — use InMemoryStorage). */
export function createIdbStorage(
	dbName: string = DEFAULT_DB_NAME,
	storeName: string = DEFAULT_STORE_NAME,
): Storage {
	let idbStore: UseStore | null = null
	const getStore = (): UseStore => {
		if (typeof indexedDB === 'undefined') {
			throw new Error(
				'IndexedDB is not available here — pass an InMemoryStorage in tests/headless',
			)
		}
		idbStore ??= createStore(dbName, storeName)
		return idbStore
	}
	return {
		// async arrows so a missing `indexedDB` surfaces as a rejection (matching
		// the Storage contract), not a synchronous throw.
		get: async (key) => get(key, getStore()),
		set: async (key, value) => set(key, value, getStore()),
		del: async (key) => del(key, getStore()),
		keys: async () => (await keys(getStore())).map(String),
	}
}

/** Bounded validator: shape-check a decoded value into a Session of the
 *  current version, or null (absent key / foreign version). */
export function parseSession(raw: unknown): Session | null {
	if (typeof raw !== 'object' || raw === null) return null
	const s = raw as {
		version?: unknown
		id?: unknown
		setup?: unknown
		log?: unknown
		meta?: unknown
		opponents?: unknown
	}
	if (s.version !== SESSION_VERSION) return null
	if (typeof s.id !== 'string') return null
	if (typeof s.setup !== 'object' || s.setup === null) return null
	if (!Array.isArray(s.log)) return null
	if (s.meta === undefined) return null
	// optional house-AI seats: keep the valid entries, drop anything else
	if (s.opponents === undefined) return raw as Session
	const opponents = parseOpponents(s.opponents)
	const { opponents: _dropped, ...rest } = raw as Session
	return (opponents === undefined ? rest : { ...rest, opponents }) as Session
}

export async function saveSession(
	storage: Storage,
	session: Session,
): Promise<void> {
	if (session.version !== SESSION_VERSION) {
		throw new Error(
			`saveSession: refusing to store unsupported version ${String(session.version)}`,
		)
	}
	await storage.set(sessionKey(session.id), session)
}

export async function loadSession(
	storage: Storage,
	id: string,
): Promise<Session | null> {
	return parseSession(await storage.get(sessionKey(id)))
}

export async function deleteSession(
	storage: Storage,
	id: string,
): Promise<void> {
	await storage.del(sessionKey(id))
}

/** Every stored save, newest first. Each entry carries its full meta, so the
 *  load screen browses (deck names, sides, turn number, score estimate)
 *  without replaying anything (todo/17 §1). */
export async function listSessions(storage: Storage): Promise<Session[]> {
	const keys = await storage.keys()
	const out: Session[] = []
	for (const key of keys) {
		if (!key.startsWith(SESSION_KEY_PREFIX)) continue
		const parsed = parseSession(await storage.get(key))
		if (parsed !== null) out.push(parsed)
	}
	return out.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt))
}

/** JSON export — the shareable bug-report format (todo/17 §3):
 *  `exportSession` produces a file, `importSession` parses it back. */
export function exportSession(session: Session): string {
	return JSON.stringify(session, null, 2)
}

export function importSession(text: string): Session {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch (err) {
		throw new Error(`importSession: not valid JSON (${(err as Error).message})`)
	}
	const parsed = parseSession(raw)
	if (parsed !== null) return parsed
	const version = (raw as { version?: unknown } | null)?.version
	throw new Error(
		`importSession: unsupported or malformed session${version === undefined ? '' : ` (version ${String(version)})`}`,
	)
}

/** Thin convenience wrapper over the free functions so the UI layer can hold
 *  one object instead of threading a Storage through every call site. */
export class SessionStore {
	constructor(private readonly storage: Storage) {}

	save(session: Session): Promise<void> {
		return saveSession(this.storage, session)
	}

	load(id: string): Promise<Session | null> {
		return loadSession(this.storage, id)
	}

	remove(id: string): Promise<void> {
		return deleteSession(this.storage, id)
	}

	list(): Promise<Session[]> {
		return listSessions(this.storage)
	}

	// Five-Year Mission campaigns live beside the saves (src/session/campaign.ts)
	saveCampaign(c: Campaign): Promise<void> {
		return saveCampaign(this.storage, c)
	}

	loadCampaign(id: string): Promise<Campaign | null> {
		return loadCampaign(this.storage, id)
	}

	removeCampaign(id: string): Promise<void> {
		return deleteCampaign(this.storage, id)
	}

	listCampaigns(): Promise<Campaign[]> {
		return listCampaigns(this.storage)
	}
}

export type { Session }
