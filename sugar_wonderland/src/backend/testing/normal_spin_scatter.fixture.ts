import type { SpinData } from "../SpinData";

/**
 * Raw spin payload captured from backend (used for local testing).
 * NOTE: This is intentionally `any` and adapted into `SpinData` shape below.
 */
const RAW_NORMAL_SPIN_SCATTER: any = {
  bet: "0.2",
  slot: {
    area: [
      [3, 6, 6, 8, 8],
      [6, 9, 9, 8, 8],
      [5, 8, 8, 9, 9],
      [8, 8, 9, 9, 4],
      [4, 9, 9, 0, 8],
      [7, 7, 6, 6, 8]
    ],
    totalWin: 4.49,
    tumbles: [
      {
        symbols: {
          in: [
            [9, 0],
            [6, 6, 9, 9],
            [4, 4, 0, 9],
            [7, 8, 8, 9],
            [8, 8, 0],
            [8]
          ],
          out: [
            { symbol: 8, count: 10, win: 0.18000000000000002 },
            { symbol: 9, count: 8, win: 0.05 }
          ]
        },
        win: 0.23000000000000004
      }
    ],
    freeSpin: {
      multiplierValue: 0.6000000000000001,
      items: [
        {
          spinsLeft: 10,
          area: [
            [5, 8, 8, 7, 7],
            [5, 7, 7, 4, 4],
            [4, 4, 7, 7, 9],
            [1, 1, 9, 9, 6],
            [9, 9, 7, 7, 5],
            [5, 8, 8, 7, 7]
          ],
          totalWin: 1.06,
          multipliers: [10],
          tumbles: [
            { symbols: { in: [[4, 4], [8, 5], [8, 8], [], [7, 7], [9, 8]], out: [{ symbol: 7, count: 10, win: 0.2 }] }, win: 0.2 },
            { symbols: { in: [[9, 6], [6], [9, 3], [], [], [5, 8, 8]], out: [{ symbol: 8, count: 8, win: 0.08000000000000002 }] }, win: 0.08000000000000002 },
            { symbols: { in: [[6], [], [8, 8], [4, 8], [8, 8], [4]], out: [{ symbol: 9, count: 8, win: 0.05 }] }, win: 0.05 },
            { symbols: { in: [[3, 10], [6, 9], [7, 7], [9], [], [9]], out: [{ symbol: 4, count: 8, win: 0.2 }] }, win: 0.2 }
          ]
        },
        {
          spinsLeft: 9,
          area: [
            [6, 8, 8, 4, 4],
            [4, 4, 9, 9, 6],
            [8, 7, 7, 9, 9],
            [5, 8, 8, 6, 6],
            [8, 8, 5, 5, 9],
            [7, 7, 8, 8, 1]
          ],
          totalWin: 0.5900000000000001,
          multipliers: [],
          tumbles: [
            { symbols: { in: [[3, 3], [], [9], [3, 7], [9, 9], [6, 6]], out: [{ symbol: 8, count: 9, win: 0.08000000000000002 }] }, win: 0.08000000000000002 },
            { symbols: { in: [[], [7, 7], [7, 4, 4], [], [4, 9, 9], []], out: [{ symbol: 9, count: 8, win: 0.05 }] }, win: 0.05 },
            { symbols: { in: [[], [9, 9], [6, 6, 8], [4], [], [6, 8]], out: [{ symbol: 7, count: 8, win: 0.1 }] }, win: 0.1 },
            { symbols: { in: [[7, 2, 2], [1, 1, 6], [5, 1, 1, 0], [5, 5, 8], [9], [9, 9, 6]], out: [{ symbol: 6, count: 9, win: 0.16000000000000003 }, { symbol: 4, count: 8, win: 0.2 }] }, win: 0.36000000000000004 }
          ]
        },
        {
          spinsLeft: 8,
          area: [
            [3, 3, 6, 6, 8],
            [6, 1, 1, 8, 8],
            [9, 7, 7, 5, 5],
            [5, 2, 2, 9, 9],
            [7, 3, 3, 9, 9],
            [9, 7, 7, 5, 5]
          ],
          totalWin: 0,
          multipliers: [],
          tumbles: []
        },
        {
          spinsLeft: 7,
          area: [
            [8, 8, 7, 7, 4],
            [9, 0, 3, 3, 7],
            [9, 5, 5, 8, 8],
            [7, 0, 9, 9, 3],
            [2, 2, 9, 9, 7],
            [7, 7, 6, 6, 8]
          ],
          totalWin: 0,
          multipliers: [],
          tumbles: []
        },
        {
          spinsLeft: 6,
          area: [
            [7, 5, 5, 20, 3],
            [14, 3, 3, 7, 7],
            [5, 5, 9, 9, 4],
            [8, 8, 6, 6, 9],
            [9, 9, 8, 8, 5],
            [7, 7, 5, 5, 9]
          ],
          totalWin: 0,
          multipliers: [20, 14],
          tumbles: []
        },
        {
          spinsLeft: 5,
          area: [
            [5, 5, 8, 8, 7],
            [8, 6, 6, 9, 9],
            [5, 8, 8, 9, 9],
            [5, 8, 8, 6, 6],
            [9, 9, 4, 4, 8],
            [4, 4, 8, 8, 9]
          ],
          totalWin: 0.33000000000000007,
          multipliers: [],
          tumbles: [
            { symbols: { in: [[6, 4], [2], [9, 9], [9, 9], [8], [7, 7]], out: [{ symbol: 8, count: 10, win: 0.18000000000000002 }] }, win: 0.18000000000000002 },
            { symbols: { in: [[], [8, 8], [2, 4, 4, 9], [6, 9], [2, 2], [6]], out: [{ symbol: 9, count: 11, win: 0.15000000000000002 }] }, win: 0.15000000000000002 }
          ]
        },
        {
          spinsLeft: 4,
          area: [
            [8, 8, 9, 9, 7],
            [9, 6, 6, 1, 1],
            [1, 5, 5, 9, 9],
            [9, 8, 8, 7, 7],
            [6, 4, 4, 8, 8],
            [4, 9, 9, 8, 8]
          ],
          totalWin: 0.13,
          multipliers: [],
          tumbles: [
            { symbols: { in: [[8, 8, 6, 6], [1], [7, 8], [5, 5, 8], [2, 2], [5, 5, 9, 9]], out: [{ symbol: 8, count: 8, win: 0.08000000000000002 }, { symbol: 9, count: 8, win: 0.05 }] }, win: 0.13 }
          ]
        },
        {
          spinsLeft: 3,
          area: [
            [9, 9, 2, 2, 7],
            [6, 9, 9, 8, 8],
            [8, 7, 7, 3, 3],
            [9, 9, 6, 6, 8],
            [6, 9, 9, 8, 8],
            [8, 5, 5, 9, 9]
          ],
          totalWin: 0.23000000000000004,
          multipliers: [],
          tumbles: [
            { symbols: { in: [[7, 7], [8, 9], [], [4, 9], [7, 8], [3, 3]], out: [{ symbol: 9, count: 10, win: 0.15000000000000002 }] }, win: 0.15000000000000002 },
            { symbols: { in: [[], [8, 8, 5], [6], [9], [8, 1, 1], [9]], out: [{ symbol: 8, count: 9, win: 0.08000000000000002 }] }, win: 0.08000000000000002 }
          ]
        },
        {
          spinsLeft: 2,
          area: [
            [4, 4, 6, 6, 9],
            [6, 6, 1, 1, 8],
            [6, 4, 4, 7, 7],
            [8, 5, 5, 2, 2],
            [9, 9, 6, 6, 1],
            [7, 7, 8, 8, 1]
          ],
          totalWin: 0,
          multipliers: [],
          tumbles: []
        },
        {
          spinsLeft: 1,
          area: [
            [8, 9, 9, 7, 7],
            [9, 9, 8, 8, 10],
            [6, 6, 8, 8, 5],
            [4, 7, 7, 0, 9],
            [7, 7, 5, 5, 8],
            [7, 7, 5, 5, 9]
          ],
          totalWin: 1.3200000000000003,
          multipliers: [10],
          tumbles: [
            { symbols: { in: [[9, 7], [], [], [9, 8], [7, 9], [6, 3]], out: [{ symbol: 7, count: 8, win: 0.1 }] }, win: 0.1 },
            { symbols: { in: [[5, 5, 7], [9, 8], [], [9, 9], [7], [7]], out: [{ symbol: 9, count: 9, win: 0.05 }] }, win: 0.05 },
            { symbols: { in: [[5], [9, 9, 8], [9, 9], [5], [9], []], out: [{ symbol: 8, count: 8, win: 0.08000000000000002 }] }, win: 0.08000000000000002 },
            { symbols: { in: [[4, 7, 7], [8, 1, 1], [4, 4, 9], [8, 8, 8], [8, 8, 9], [7, 7]], out: [{ symbol: 5, count: 9, win: 0.2 }, { symbol: 9, count: 8, win: 0.05 }] }, win: 0.25 },
            { symbols: { in: [[8, 5, 5, 6], [], [], [], [4, 6], [9, 9, 8]], out: [{ symbol: 7, count: 9, win: 0.1 }] }, win: 0.1 },
            { symbols: { in: [[9], [7, 7], [], [9, 6, 6], [7, 9], [8]], out: [{ symbol: 8, count: 9, win: 0.08000000000000002 }] }, win: 0.08000000000000002 }
          ]
        }
      ]
    }
  }
};

/**
 * Build a `SpinData`-compatible object from the raw payload.
 * This adapter fills any fields that our runtime expects but the fixture may omit.
 */
export function buildNormalSpinScatterFixtureSpinData(): SpinData {
  const raw = RAW_NORMAL_SPIN_SCATTER;

  const rawItems: any[] = raw?.slot?.freeSpin?.items ?? [];
  const inferredCount =
    typeof rawItems?.[0]?.spinsLeft === "number"
      ? rawItems[0].spinsLeft
      : Array.isArray(rawItems)
        ? rawItems.length
        : 0;

  const adaptedItems = (Array.isArray(rawItems) ? rawItems : []).map((item) => ({
    spinsLeft: item?.spinsLeft ?? 0,
    totalWin: item?.totalWin ?? 0,
    subTotalWin: item?.subTotalWin ?? item?.totalWin ?? 0,
    area: item?.area ?? [],
    payline: item?.payline ?? [],
    // Preserve tumble steps if present (used by simulation + UI effects).
    tumbles: item?.tumbles ?? []
  }));

  const freespin = {
    count: inferredCount,
    totalWin: 0,
    items: adaptedItems
  };

  // Also provide camelCase `freeSpin` because parts of the code accept either.
  const freeSpin = {
    ...freespin,
    multiplierValue: raw?.slot?.freeSpin?.multiplierValue ?? 0
  };

  return {
    playerId: "fixture",
    bet: String(raw?.bet ?? "0"),
    slot: {
      area: raw?.slot?.area ?? [],
      totalWin: Number(raw?.slot?.totalWin ?? 0),
      paylines: raw?.slot?.paylines ?? [],
      tumbles: raw?.slot?.tumbles ?? [],
      freespin,
      freeSpin
    } as any
  };
}

