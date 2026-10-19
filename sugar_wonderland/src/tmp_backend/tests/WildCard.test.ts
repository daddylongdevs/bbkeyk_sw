import { beforeEach, describe, it, expect } from 'vitest';
import { Grid, SymbolDetector } from '../SymbolDetector';
import { Data } from '../Data';


describe('WildCard', () => {
	let symbolDetector: SymbolDetector;

	beforeEach(() => {
    symbolDetector = new SymbolDetector();
  });

  it('should detect wild card 0', () => {
		const data = new Data();
    data.symbols = [
      [12, 7,  7,  1,  1],
      [ 5, 5,  5,  5,  5],
      [ 6, 6,  6,  6,  6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[0], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

		// console.log("matchingGrids", matchingGrids);

    expect(matchingGrids.length).toBe(3);

    const expected = [
      new Grid( 0,  0, 12),
      new Grid( 1,  0,  7),
      new Grid( 2,  0,  7),
    ];

    for (let i = 0; i < matchingGrids.length; i++) {
      expect(matchingGrids[i]).toEqual(expected[i]);
    }
  });

	it('should detect wild card 1', () => {
		const data = new Data();
    data.symbols = [
      [ 7, 12,  7,  1,  1],
      [ 5,  5,  5,  5,  5],
      [ 6,  6,  6,  6,  6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[0], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

		// console.log("matchingGrids", matchingGrids);

    expect(matchingGrids.length).toBe(3);

    const expected = [
      new Grid( 0,  0,  7),
      new Grid( 1,  0, 12),
      new Grid( 2,  0,  7),
    ];

    for (let i = 0; i < matchingGrids.length; i++) {
      expect(matchingGrids[i]).toEqual(expected[i]);
    }
  });

	it('should detect wild card 2', () => {
		const data = new Data();
    data.symbols = [
      [ 7,  7, 12,  1,  1],
      [ 5,  5,  5,  5,  5],
      [ 6,  6,  6,  6,  6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[0], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

		// console.log("matchingGrids1", matchingGrids);

    expect(matchingGrids.length).toBe(3);

    const expected = [
      new Grid( 0,  0,  7),
      new Grid( 1,  0,  7),
      new Grid( 2,  0, 12),
    ];

    for (let i = 0; i < matchingGrids.length; i++) {
      expect(matchingGrids[i]).toEqual(expected[i]);
    }
  });
});