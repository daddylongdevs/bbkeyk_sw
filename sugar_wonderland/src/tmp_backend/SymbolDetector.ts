import { Data } from './Data';
import { GridPosition } from './GridPosition';

export class SymbolDetector {

  public getWins(data: Data): Wins {
    const allMatching: Map<number, Grid[]> = new Map();

    for (let i = 0; i < Data.WINLINES.length; i++) {
      const winline = Data.WINLINES[i];
      const grids = this.getGrids(winline, data);
      const matchingGrids = this.getMatchingGrids(grids);

      if (matchingGrids.length > 0) {
        allMatching.set(i, matchingGrids);
      }
    }

    return new Wins(allMatching);
  }

  public getGrids(winline: number[][], data: Data): Grid[] {
    // From left to right, top to bottom
    const grids: Grid[] = [];
    for (let x = 0; x < winline[0].length; x++) {
      for (let y = 0; y < winline.length; y++) {
        if (winline[y][x] !== 1) {
          continue;
        }

        grids.push(new Grid(x, y, data.symbols[y][x]));
      }
    }

    return grids;
  }

  public getMatchingGrids(grids: Grid[]) {
    let consecutiveSameGrids: Grid[] = [];

    let symbol = this.getFirstNormalSymbol(grids);
    for (const current of grids) {
      if (current.symbol === Data.SCATTER[0]) {
        if (consecutiveSameGrids.length >= 3) {
          return consecutiveSameGrids;
        }
        return [];
      }

      if (consecutiveSameGrids.length === 0) {
        consecutiveSameGrids.push(current);
        continue;
      } 
      
      if (consecutiveSameGrids.length > 0) {
        if (symbol === current.symbol) {
          consecutiveSameGrids.push(current);
        }

        if (Data.WILDCARDS.includes(current.symbol)) {
          consecutiveSameGrids.push(current);
          continue;
        }
        
        if (symbol !== current.symbol) {
          if (consecutiveSameGrids.length >= 3) {
            return consecutiveSameGrids;
          }

          break;
        }
      }
    }

    if (consecutiveSameGrids.length < 3) {
      consecutiveSameGrids = [];
    }

    return consecutiveSameGrids;
  }

  private getFirstNormalSymbol(grids: Grid[]): number {
    for (const grid of grids) {
      if (!Data.WILDCARDS.includes(grid.symbol)) {
        return grid.symbol;
      }
    } 

    return -1;
  }

  public getScatterGrids(data: Data): Grid[] {
    const scatterGrids: Grid[] = [];
    for (let y = 0; y < data.symbols.length; y++) {
      for (let x = 0; x < data.symbols[y].length; x++) {
        if (data.symbols[y][x] === Data.SCATTER[0]) {
          scatterGrids.push(new Grid(x, y, data.symbols[y][x]));
        }
      }
    }

    return scatterGrids;
  }

}

export class Wins {
  public allMatching: Map<number, Grid[]>;

  constructor(allMatching: Map<number, Grid[]>) {
    this.allMatching = allMatching;
  }
}

export class Grid {
  public x: number;
  public y: number;
  public symbol: number;

  constructor(x: number, y: number, symbol: number) {
    this.x = x;
    this.y = y;
    this.symbol = symbol;
  }
}






