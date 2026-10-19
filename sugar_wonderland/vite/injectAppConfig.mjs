/**
 * Injects APP_CONFIG fallbacks after `/app-config.js` (ConfigMap / nginx / public/).
 * Only fills keys that are missing so runtime app-config.js wins when present.
 */
export function injectAppConfigPlugin(env = {}) {
	const gameUrl =
		(typeof env.VITE_SLOTS_API_URL === 'string' && env.VITE_SLOTS_API_URL.trim()) ||
		'https://stg-game-launcher.dijoker.com';
	const scratchWsUrl =
		(typeof env.VITE_SCRATCH_WS_URL === 'string' && env.VITE_SCRATCH_WS_URL.trim()) ||
		'https://stg-crashgame-api.dijoker.com/';
	const scratchDemoApiKey =
		(typeof env.VITE_SCRATCH_DEMO_API_KEY === 'string' && env.VITE_SCRATCH_DEMO_API_KEY.trim()) ||
		'Y2hhaW50YWJsZWV4YWN0anVtcGV4YW1wbGV5b3VuZ2U=';

	const fallbackScript = `<script>
window.APP_CONFIG = window.APP_CONFIG || {};
if (!window.APP_CONFIG['game-url']) window.APP_CONFIG['game-url'] = ${JSON.stringify(gameUrl.replace(/\/+$/, ''))};
if (!window.APP_CONFIG['websocket-url']) window.APP_CONFIG['websocket-url'] = ${JSON.stringify(scratchWsUrl.replace(/\/?$/, '/'))};
if (!window.APP_CONFIG['api-key']) window.APP_CONFIG['api-key'] = ${JSON.stringify(scratchDemoApiKey)};
</script>`;

	return {
		name: 'inject-app-config',
		transformIndexHtml(html) {
			if (html.includes("if (!window.APP_CONFIG['api-key'])")) {
				return html;
			}
			const withLoader = html.includes('/app-config.js')
				? html
				: html.replace('</head>', `  <script src="/app-config.js"></script>\n</head>`);
			return withLoader.replace('</head>', `  ${fallbackScript}\n</head>`);
		},
	};
}
