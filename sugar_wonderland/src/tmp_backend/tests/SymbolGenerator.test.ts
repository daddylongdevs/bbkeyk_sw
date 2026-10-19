import { beforeEach, describe, it, expect } from 'vitest';
import { SymbolGenerator } from '../SymbolGenerator';
import { Data } from '../Data';

describe('SymbolGenerator', () => {
	let symbolGenerator: SymbolGenerator;
	let scatterRows: number[] = [0, 2, 4];

  beforeEach(() => {
    symbolGenerator = new SymbolGenerator();
  });

  it('scatter spawn only at 0, 2, 4 indices', () => {
		for (let i = 0; i < 1000; i++) {
			let newSymbols = symbolGenerator.generate();
			
			for (let col = 0; col < Data.SLOT_COLUMNS; col++) {
				expect(newSymbols[col][1] !== Data.SCATTER[0]).toBeTruthy();
				expect(newSymbols[col][3] !== Data.SCATTER[0]).toBeTruthy();
			}

			
		}
  });

	it('scatter only spawn once in each row', () => {
		for (let i = 0; i < 1000; i++) {
			let newSymbols = symbolGenerator.generate();
			
			for (let row of scatterRows) {
				let spawnCount = 0;

				for (let col = 0; col < Data.SLOT_COLUMNS; col++) {
					if (newSymbols[col][row] === Data.SCATTER[0]) {
						spawnCount++;
						// console.log(`scatter spawn at ${col}, ${row} ${spawnCount}`);
					}
				}

				expect(spawnCount).toBeLessThanOrEqual(1);
			}
		}
	});

	it('wildcard spawn only at 1, 2, 3 indices', () => {
		for (let i = 0; i < 1000; i++) {
			let newSymbols = symbolGenerator.generate();

			for (let col = 0; col < Data.SLOT_COLUMNS; col++) {
				expect(newSymbols[col][0] < Data.WILDCARDS[0]).toBeTruthy();
				expect(newSymbols[col][1] <= Data.WILDCARDS[2]).toBeTruthy();
				expect(newSymbols[col][2] <= Data.WILDCARDS[2]).toBeTruthy();
				expect(newSymbols[col][3] <= Data.WILDCARDS[2]).toBeTruthy();
				expect(newSymbols[col][4] < Data.WILDCARDS[0]).toBeTruthy();
			}
		}
	});

	



})