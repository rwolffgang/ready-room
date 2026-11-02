// STCC join layer: card-number normalisation, index precedence, printed-op
// splitting and [[token]] parsing. Fixture strings are invented, not card text.

import { describe, expect, it } from 'vitest'
import {
	buildStccIndex,
	customPackName,
	normalizeCardNumber,
	parseCustomImageMap,
	parseStccBots,
	printedOpFor,
	stccBotForSource,
	printedOps,
	splitTokens,
	toTraitId,
} from './stcc'

const rec = (card_number: string, extra: Record<string, unknown> = {}) => ({
	id: card_number,
	name: 'X',
	suit: 'Person',
	source: 'Common',
	game_box: 'Test',
	card_number,
	filename: `${card_number.replace(/\W/g, '')}.jpg`,
	...extra,
})

const text = (
	t: Partial<Record<'cost' | 'hand' | 'table' | 'goal' | 'reward', string>>,
) => ({
	cost: '',
	hand: '',
	table: '',
	goal: '',
	reward: '',
	...t,
})

describe('stcc join', () => {
	it('normalises print marks off card numbers', () => {
		expect(normalizeCardNumber('2PER01/26●')).toBe('2PER01/26')
		expect(normalizeCardNumber('1loc09/20')).toBe('1LOC09/20')
	})

	it('indexes by card number, first box wins, updated variant beats original', () => {
		const index = buildStccIndex({
			box1: [
				rec('1PER01/25'),
				rec('1PER02/25', { variant: 'original', name: 'old' }),
				rec('1PER02/25', { variant: 'updated', name: 'new' }),
			],
			box2: [rec('1PER01/25', { name: 'reprint' }), { broken: true }],
		})
		expect(index.get('1PER01/25')?.box).toBe('box1')
		expect(index.get('1PER01/25')?.image).toBe('/stcc/img/box1/1PER0125.jpg')
		expect(index.get('1PER02/25')?.name).toBe('new')
		expect(index.size).toBe(2)
	})

	it('lets a later "updated" † reprint supersede the earlier card', () => {
		const index = buildStccIndex({
			box1: [
				rec('1PER03/25', { name: 'U.S.S. Y', regular_traits: ['Doctor'] }),
				rec('1PER04/25', { name: 'Z' }),
			],
			box2: [
				rec('2PER09/26†', {
					variant: 'updated',
					name: 'U.S.S Y',
					regular_traits: ['NX-01', 'Doctor'],
				}),
				rec('2PER10/26', { variant: 'updated', name: 'Z', glory: 3 }),
			],
		})
		const y = index.get('1PER03/25')
		expect(y?.name).toBe('U.S.S. Y')
		expect(y?.card_number).toBe('1PER03/25')
		expect(y?.regular_traits).toEqual(['NX-01', 'Doctor'])
		expect(y?.image).toBe('/stcc/img/box2/2PER0926.jpg')
		// without the † mark it is a separate card, not an update
		expect(index.get('1PER04/25')?.glory).toBeUndefined()
	})

	it('splits printed text into typed operations in printed order', () => {
		const ops = printedOps(
			text({
				hand: 'Cannot be copied. [[action]] Attack Play: Do a thing. Play: Do another.',
				table: 'Activation: Gain 1 [[dilithium]].',
				goal: 'Endgame: Score [[1vp]].',
				cost: 'Have 3+ [[research]].',
			}),
		)
		expect(ops.map((o) => [o.type, o.costsAction, o.isAttack, o.text])).toEqual(
			[
				[null, false, false, 'Cannot be copied.'],
				['PLAY', true, true, 'Do a thing.'],
				['PLAY', false, false, 'Do another.'],
				['ACTIVATION', false, false, 'Gain 1 [[dilithium]].'],
				['ENDGAME', false, false, 'Score [[1vp]].'],
			],
		)
		const ours = [
			{ type: 'PLAY' },
			{ type: 'ENDGAME' },
			{ type: 'PLAY' },
			{ type: 'REACTION' },
		]
		expect(printedOpFor(ops, ours, 2)?.text).toBe('Do another.')
		expect(printedOpFor(ops, ours, 1)?.text).toBe('Score [[1vp]].')
		expect(printedOpFor(ops, ours, 3)).toBeNull()
	})

	it('reads a specialty requirement before the colon as part of the header', () => {
		const ops = printedOps(
			text({
				hand: '[[action]] Attack Play [[inf3]]: Do a thing. Play [[mil6]]: Do another.',
				table: 'Activation: Gain 1 [[dilithium]].',
			}),
		)
		expect(ops.map((o) => [o.type, o.costsAction, o.isAttack, o.text])).toEqual(
			[
				['PLAY', true, true, 'Do a thing.'],
				['PLAY', false, false, 'Do another.'],
				['ACTIVATION', false, false, 'Gain 1 [[dilithium]].'],
			],
		)
	})

	it('splits [[tokens]] out of text and maps trait spellings', () => {
		expect(splitTokens('Gain 2 [[Dilithium]] or a [[lower decker]].')).toEqual([
			{ k: 'text', text: 'Gain 2 ' },
			{ k: 'token', name: 'dilithium' },
			{ k: 'text', text: ' or a ' },
			{ k: 'token', name: 'lower decker' },
			{ k: 'text', text: '.' },
		])
		expect(toTraitId('Mind-Control')).toBe('MIND_CONTROL')
		expect(toTraitId('Lower Decker')).toBe('LOWER_DECKER')
		expect(toTraitId("Vau N'Akat")).toBe('VAU_NAKAT')
	})

	it('parses Automated Command cards by bot id and skips malformed entries', () => {
		const bot = {
			id: 'testbot',
			captain: 'Test',
			variant: null,
			traits: [{ key: '[[alien]]', text: 'Gain 1 [[glory]].' }],
			suits: [{ suit: 'ship', text: 'A.', do_text: 'B.' }],
			special: null,
			campaign: {
				win: { cards: '[[ally]]', bonus: ['BOOST: Gain 1 [[research]].'] },
				loss: { cards: '[[cargo]]', bonus: [] },
			},
		}
		const bots = parseStccBots([bot, { id: 'broken' }, 7])
		expect([...bots.keys()]).toEqual(['testbot'])
		expect(bots.get('testbot')?.suits[0]?.do_text).toBe('B.')
		expect(parseStccBots(null).size).toBe(0)
		// a crew's Bot is found through its cards' STCC source; variants never
		const both = parseStccBots([bot, { ...bot, id: 'testbot-v', variant: 'V' }])
		expect(stccBotForSource(both, 'Test')?.id).toBe('testbot')
		expect(stccBotForSource(both, 'Other')).toBeNull()
	})

	it('reads a custom pack name and its face map, rejecting anything else', () => {
		const pack = { pack: 'demo', deck: 'DEM', title: 'Demo', cards: [] }
		expect(customPackName(pack)).toBe('demo')
		expect(customPackName({ ...pack, pack: 7 })).toBeNull()
		expect(customPackName(null)).toBeNull()

		const map = { '1DEM01/25': 'demo/1DEM01-25.jpg' }
		expect(parseCustomImageMap(map)).toEqual(map)
		expect(parseCustomImageMap({ '1DEM01/25': 7 })).toBeNull()
		expect(parseCustomImageMap(['demo/1DEM01-25.jpg'])).toBeNull()
		expect(parseCustomImageMap(null)).toBeNull()
	})
})
