export type PlayIdentity = {
	operatorId: string;
	playerId: string;
};

type PlayClaim = PlayIdentity & {
	instanceId: string;
	claimedAt: number;
};

const CHANNEL_NAME = 'minium-play-instance';
const STORAGE_PREFIX = 'play-instance:';

/** When this page opened. A later page with the same operator and player replaces this one. */
const claimedAt = Date.now();

const listeners = new Set<() => void>();
let replaced = false;
let listening = false;
let pollTimer: number | null = null;
let ownedKey = '';
let ownedInstanceId = '';

export function getPlayInstanceClaimedAt(): number {
	return claimedAt;
}

function storageKey(identity: PlayIdentity): string {
	const operatorId = identity.operatorId.trim();
	const playerId = identity.playerId.trim();
	if (!operatorId || !playerId) {
		return '';
	}
	return `${STORAGE_PREFIX}${operatorId}:${playerId}`;
}

function notifyReplaced(): void {
	if (replaced) {
		return;
	}
	replaced = true;
	if (pollTimer != null) {
		window.clearInterval(pollTimer);
		pollTimer = null;
	}
	listeners.forEach((listener) => {
		try {
			listener();
		} catch {
			/* noop */
		}
	});
}

function considerClaim(claim: PlayClaim | null | undefined): void {
	if (!claim || replaced || !ownedKey || !ownedInstanceId) {
		return;
	}
	const key = storageKey(claim);
	if (!key || key !== ownedKey || claim.instanceId === ownedInstanceId) {
		return;
	}
	const otherClaimedAt = Number(claim.claimedAt);
	if (!Number.isFinite(otherClaimedAt) || otherClaimedAt < claimedAt) {
		return;
	}
	notifyReplaced();
}

function readStoredClaim(key: string): PlayClaim | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as PlayClaim;
		if (!parsed?.instanceId || !parsed.operatorId || !parsed.playerId) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function ensureListening(): void {
	if (listening || typeof window === 'undefined') {
		return;
	}
	listening = true;
	window.addEventListener('storage', (event) => {
		if (!ownedKey || event.key !== ownedKey || !event.newValue) {
			return;
		}
		try {
			considerClaim(JSON.parse(event.newValue) as PlayClaim);
		} catch {
			/* noop */
		}
	});
	try {
		const channel = new BroadcastChannel(CHANNEL_NAME);
		channel.onmessage = (event) => {
			considerClaim(event.data as PlayClaim);
		};
	} catch {
		/* BroadcastChannel is optional; storage polling still covers other tabs. */
	}
	pollTimer = window.setInterval(() => {
		if (!ownedKey || replaced) {
			return;
		}
		considerClaim(readStoredClaim(ownedKey));
	}, 400);
}

/** This page is the live one for the operator and player. Older pages must stop. */
export function claimPlayInstance(identity: PlayIdentity, instanceId: string): void {
	const key = storageKey(identity);
	const id = instanceId.trim();
	if (!key || !id || replaced) {
		return;
	}
	ownedKey = key;
	ownedInstanceId = id;
	ensureListening();
	const claim: PlayClaim = {
		operatorId: identity.operatorId.trim(),
		playerId: identity.playerId.trim(),
		instanceId: id,
		claimedAt,
	};
	const existing = readStoredClaim(key);
	if (existing && existing.instanceId !== id && Number(existing.claimedAt) > claimedAt) {
		notifyReplaced();
		return;
	}
	try {
		localStorage.setItem(key, JSON.stringify(claim));
	} catch {
		/* ignore quota / private mode */
	}
	try {
		const channel = new BroadcastChannel(CHANNEL_NAME);
		channel.postMessage(claim);
		channel.close();
	} catch {
		/* noop */
	}
	const latest = readStoredClaim(key);
	if (latest && latest.instanceId !== id && Number(latest.claimedAt) >= claimedAt) {
		notifyReplaced();
	}
}

export function markPlayInstanceReplaced(): void {
	notifyReplaced();
}

export function onPlayInstanceReplaced(listener: () => void): () => void {
	listeners.add(listener);
	if (replaced) {
		listener();
	}
	return () => {
		listeners.delete(listener);
	};
}

export function isPlayInstanceReplaced(): boolean {
	return replaced;
}
