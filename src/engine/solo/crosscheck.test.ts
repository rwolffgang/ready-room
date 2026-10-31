// The solo Bots' Automated Command mechanics stay in step with the STCC card
// text (tools/lib/crosscheckBots.ts). Needs the fetched STCC data, so it is
// skipped where `npm run fetch-cards` has not run (CI, the hosted build).

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../../data/catalog'
import { crosscheckBots } from '../../../tools/lib/crosscheckBots'
import { loadStccBotsNode, loadStccNode, VENDOR_DIR } from '../../../tools/stcc-node'

const fetched = existsSync(join(VENDOR_DIR, 'bots.json'))

describe.skipIf(!fetched)('Automated Command mechanics vs STCC', () => {
	it('match every crew, trait key, suit row and printed attack', async () => {
		const catalog = await loadCatalog()
		const issues = crosscheckBots(
			catalog.bots ?? [],
			await loadStccBotsNode(),
			catalog.defs,
			await loadStccNode({ custom: false }),
		)
		expect(issues).toEqual([])
		expect(catalog.bots?.map((b) => b.deck).sort()).toEqual([
			'BUR',
			'KOL',
			'PIC',
			'SEL',
			'SHR',
			'SIS',
		])
	})
})
