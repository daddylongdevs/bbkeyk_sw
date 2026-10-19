import { Data } from "./Data";
import { Grid } from "./SymbolDetector";

export class Payout {

  public static calc(data: Data): number {
    let totalWin = 0;
    for (const [winline, win] of data.wins.allMatching) {
      const multiplier = getMultiplier(win);
      totalWin += multiplier * data.bet;
    }

    return totalWin;
  }

  public static getMultiplierMatrix(data: Data): Map<number, Multiplier> {
    let multiplierMatrix = new Map<number, Multiplier>();

    for (const [winline, win] of data.wins.allMatching) {
      const multiplier_list = PAYOUT_MATRIX.get(win[0].symbol);

      let multiplier = 0;

      if (multiplier_list) {
        const multiplierIndex = win.length - 3;
        multiplier = multiplier_list[multiplierIndex]
      }

      for (const grid of win) {
        if (Data.WILDCARDS.includes(grid.symbol)) {
          multiplier *= PAYOUT_MATRIX.get(grid.symbol)![0];
        }
      }

      if (multiplier > 0) {
        multiplierMatrix.set(winline, new Multiplier(win[0].symbol, multiplier));
      }
    }

    return multiplierMatrix;
  }
}

function getMultiplier(win: Grid[]) {
  const multiplier_list = PAYOUT_MATRIX.get(win[0].symbol);

  let multiplier = 0;
  if (multiplier_list) {
    const multiplierIndex = win.length - 3;
    multiplier = multiplier_list[multiplierIndex]
  }

  for (const grid of win) {
    if (Data.WILDCARDS.includes(grid.symbol)) {
      multiplier *= PAYOUT_MATRIX.get(grid.symbol)![0];
    }
  }
  return multiplier;
}

const PAYOUT_MATRIX = new Map<number, number[]>([
  [1, [2.5, 7.5, 37.5]],
  [2, [1.75, 5, 25]],
  [3, [1, 2, 10]],
  [4, [1, 2, 10]],
  [5, [0.6, 1.25, 7.5]],
  [6, [0.4, 1, 5]],
  [7, [0.25, 0.5, 2.5]],
  [8, [0.25, 0.5, 2.5]],
  [9, [0.1, 0.25, 1.25]],
  [10, [0.1, 0.25, 1.25]],
  [11, [0.1, 0.25, 1.25]],
  [12, [2]],
  [13, [3]],
  [14, [4]],
]);



export enum PayoutEvents {
  CALC_REQUEST = 'CALC_REQUEST',
  CALC_RESPONSE = 'CALC_RESPONSE',
}

export class Multiplier {
  public symbol: number;
  public value: number;

  constructor(symbol: number, value: number) {
    this.symbol = symbol;
    this.value = value;
  }
}