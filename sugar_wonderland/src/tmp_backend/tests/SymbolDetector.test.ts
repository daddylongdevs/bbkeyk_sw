import { Data } from '../Data';
import { Grid, SymbolDetector } from '../SymbolDetector';
import { beforeEach, describe, it, expect } from 'vitest';

describe('SymbolDetector', () => {
  let symbolDetector: SymbolDetector;

  beforeEach(() => {
    symbolDetector = new SymbolDetector();
  });

  it('return matching grid winline 0', () => {
    const data = new Data();
    data.symbols = [
      [7, 7, 7, 1, 1],
      [5, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[0], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

    expect(matchingGrids.length).toBe(3);

    const expected = [
      new Grid(0, 0, 7),
      new Grid(1, 0, 7),
      new Grid(2, 0, 7),
    ];

    for (let i = 0; i < matchingGrids.length; i++) {
      expect(matchingGrids[i]).toEqual(expected[i]);
    }
  });

  it('return no matching grid winline 0', () => {
    const data = new Data();
    data.symbols = [
      [1, 7, 7, 7, 1],
      [5, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[0], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

    expect(matchingGrids.length).toBe(0);
  });

  it('return matching grid winline 1', () => {
    const data = new Data();
    data.symbols = [
      [1, 7, 7, 7, 1],
      [5, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[1], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

    expect(matchingGrids.length).toBe(5);

    const expected = [
      new Grid(0, 1, 5),
      new Grid(1, 1, 5),
      new Grid(2, 1, 5),
      new Grid(3, 1, 5),
      new Grid(4, 1, 5),
    ];

    for (let i = 0; i < matchingGrids.length; i++) {
      expect(matchingGrids[i]).toEqual(expected[i]);
    }
  });

  it('return no matching grid winline 1', () => {
    const data = new Data();
    data.symbols = [
      [1, 7, 7, 7, 1],
      [1, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[1], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

    expect(matchingGrids.length).toBe(0);
  });

  it('return matching grid winline 4', () => {
    const data = new Data();
    data.symbols = [
      [1, 7, 7, 7, 1],
      [6, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[4], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

    expect(matchingGrids.length).toBe(4);

    const expected = [
      new Grid(0, 1, 6),
      new Grid(1, 2, 6),
      new Grid(2, 2, 6),
      new Grid(3, 2, 6),
    ];

    for (let i = 0; i < matchingGrids.length; i++) {
      expect(matchingGrids[i]).toEqual(expected[i]);
    }
  });

  it('return no matching grid winline 4', () => {
    const data = new Data();
    data.symbols = [
      [1, 7, 7, 7, 1],
      [1, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[4], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

    expect(matchingGrids.length).toBe(0);
  });

  it('return no matching grid', () => {
    const data = new Data();
    data.symbols = [
      [7, 0, 7, 7, 1],
      [5, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const grids = symbolDetector.getGrids(Data.WINLINES[0], data);
    const matchingGrids = symbolDetector.getMatchingGrids(grids);

    expect(matchingGrids.length).toBe(0);
  });

  it('return wins', () => {
    const data = new Data();
    data.symbols = [
      [1, 7, 7, 7, 1],
      [5, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
    ];

    const expected = new Map([
      [1, [
        new Grid(0, 1, 5),
        new Grid(1, 1, 5),
        new Grid(2, 1, 5),
        new Grid(3, 1, 5),
        new Grid(4, 1, 5),
      ]],
      [2, [
        new Grid(0, 2, 6),
        new Grid(1, 2, 6),
        new Grid(2, 2, 6),
        new Grid(3, 2, 6),
        new Grid(4, 2, 6),
      ]],
    ]);


    const wins = symbolDetector.getWins(data);
    expect(wins.allMatching.size).toBe(expected.size);

    for (let [key, value] of expected) {
      let result = wins.allMatching.get(key);

      expect(result).toBeDefined();
      expect(result).toEqual(value);
    }
  });
}); 