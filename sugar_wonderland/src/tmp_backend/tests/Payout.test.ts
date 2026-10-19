import { Data } from "../Data";
import { Multiplier, Payout } from "../Payout";
import { describe, it, expect, beforeEach } from 'vitest';
import { Grid, SymbolDetector } from "../SymbolDetector";


// Scatter 1, 3, 5
// Wildcard 2, 3, 4

describe('Payout', () => {
	let symbolDetector: SymbolDetector;

	beforeEach(() => {
		symbolDetector = new SymbolDetector();
	});

  it('should return 0 if no win', () => {
    const data = new Data();
		data.symbols = [
			[1, 0, 1, 4 ,1],
			[0, 3, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];
    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(0);
  });


	it('symbol 1 winline 0', () => {
    const data = new Data();

		data.bet = 1;
		data.symbols = [
			[1, 1, 1, 4 ,1],
			[0, 3, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];

    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(2.5);
  });

	it('symbol 1 winline 0, 10, 18', () => {
    const data = new Data();

		data.bet = 1;
		data.symbols = [
			[1, 1, 1, 4 ,1],
			[0, 1, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];

    data.wins = symbolDetector.getWins(data);

    const payout = Payout.calc(data);
    expect(payout).toBe(7.5);
  });


	it('symbol 1 winline 0 wildcardsx2', () => {
    const data = new Data();
		const w2 = Data.WILDCARDS[0];

		data.bet = 1;
		data.symbols = [
			[1,w2, 1, 4 ,1],
			[0, 3, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];

    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(5.0);
  });

	it('symbol 1 winline 0 wildcardsx2 * 2', () => {
    const data = new Data();
		const w2 = Data.WILDCARDS[0];

		data.bet = 1;
		data.symbols = [
			[1,w2,w2, 4 ,1],
			[0, 3, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];

    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(10.0);
  });

	it('symbol 1 winline 0 wildcardsx2 * 2 * 2', () => {
    const data = new Data();
		const w2 = Data.WILDCARDS[0];

		data.bet = 1;
		data.symbols = [
			[1,w2,w2,w2, 2],
			[0, 3, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];

    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(60.0);
	});

	it('symbol 1 winline 0 wildcardsx3', () => {
    const data = new Data();
		const w2 = Data.WILDCARDS[1];

		data.bet = 1;
		data.symbols = [
			[1,w2, 1, 4 ,1],
			[0, 3, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];

    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(7.5);
  });

	it('symbol 1 winline 0 wildcardsx3 * 2', () => {
    const data = new Data();
		const w2 = Data.WILDCARDS[1];

		data.bet = 1;
		data.symbols = [
			[1,w2,w2, 4 ,1],
			[0, 3, 2, 4, 1],
			[1, 2, 3, 1, 4],
		];

    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(22.5);
  });


	it('[winline:7, symbol:9, multi: 4, 2], [winline:12, symbol:9, multi: 4, 2]', () => {
    const data = new Data();
		const w0 = Data.WILDCARDS[0];
		const w2 = Data.WILDCARDS[2];

		data.bet = 1;
		data.symbols = [
			[ 9, 9, 6,w0, 7],
			[ 1, 6,w2, 5,11],
			[ 7,10,w2, 6, 1],
		];

    data.wins = symbolDetector.getWins(data);
    const payout = Payout.calc(data);
    expect(payout).toBe(2.4);

		const multiplierMatrix = Payout.getMultiplierMatrix(data);
		let expected = new Map([
			[7, new Multiplier(9, 2)],
			[12, new Multiplier(9, 0.4)],
		]);
		for (const [winline, multiplier] of multiplierMatrix) {
				expect(multiplier).toEqual(expected.get(winline));
		}
  });

});