import { Data } from "./Data";


export class SymbolGenerator {
	public static WILDCARD_ROWS: number[] = [1, 2, 3];

  public generate(exclude: number[] = []): number[][] {
		const newValues = [];

		for (let col = 0; col < Data.SLOT_COLUMNS; col++) {
			let rowValues: number[] = [];
			for (let row = 0; row < Data.SLOT_ROWS; row++) {
				let value = this.getValue(row, exclude)
				rowValues.push(value);
			}

			//@ts-ignore
			newValues.push(rowValues);
		}

		return newValues;
  }


	private getValue(row: number, exclude: number[]): number {
		const selection = [];
		// Allow scatter to spawn on any row unless explicitly excluded
		if (!this.hasMatched(Data.SCATTER, exclude)) {
			//@ts-ignore
			selection.push(...Data.SCATTER);
		}

			//@ts-ignore
		selection.push(...Data.NORMAL_SYMBOLS);

		// Wildcard only spawn at 1, 2, 3 indices
		if (SymbolGenerator.WILDCARD_ROWS.includes(row)) {
			//@ts-ignore
			selection.push(...Data.WILDCARDS);
		}

		return getRandomFromValues(selection);
	
	}

	private hasMatched(values: number[], exclude: number[]): boolean {
		for (let i = 0; i < exclude.length; i++) {
			if (values.includes(exclude[i])) {
				return true;
			}
		}
		return false;
	}

}

function getRandomFromValues(values: number[]): number {
	const index = Math.floor(Math.random() * values.length);
	return values[index];
}



// TODO: Need mathematician to distribute the chances of scatter and wildcard spawns