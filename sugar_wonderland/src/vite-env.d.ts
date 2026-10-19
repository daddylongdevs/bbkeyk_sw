/// <reference types="vite/client" />

/**
 * Local `.env` values are injected into `window.APP_CONFIG` by vite/injectAppConfig.mjs.
 * Runtime game code reads APP_CONFIG keys (game-url / websocket-url / api-key),
 * not import.meta.env directly.
 */
interface ImportMetaEnv {
	readonly VITE_SLOTS_API_URL?: string;
	readonly VITE_SCRATCH_WS_URL?: string;
	readonly VITE_SCRATCH_DEMO_API_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
