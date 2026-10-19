import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { injectAppConfigPlugin } from './injectAppConfig.mjs';
import { cacheBusterVitePlugin, syncCacheVersions } from '../../scripts/cacheVersions.mjs';
import { fileURLToPath as miniumCacheFileURLToPath } from 'node:url';
const miniumCacheVersions = syncCacheVersions(miniumCacheFileURLToPath(new URL('..', import.meta.url)));



export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
	return {
		base: './',
		plugins: [cacheBusterVitePlugin(miniumCacheVersions), injectAppConfigPlugin(env)],
		resolve: {
			dedupe: ['phaser'],
			alias: {
				'@core': fileURLToPath(new URL('../../core', import.meta.url)),
			},
		},
		build: {
			rolldownOptions: {
				output: {
					codeSplitting: {
						groups: [
							{
								test: /node_modules[\\/]phaser/,
								name: 'phaser',
							},
						],
					},
				},
			},
		},
		server: {
			port: 8080,
			host: true,
			fs: {
				allow: [
					fileURLToPath(new URL('..', import.meta.url)),
					fileURLToPath(new URL('../../core', import.meta.url)),
				],
			},
			allowedHosts: [
				'minium.dev.fybtech.xyz',
				'dev-games.dijoker.com',
				'.trycloudflare.com',
				'kajfly.com',
				'casinof16.com',
				'f16casino.com',
				'casinojet.com',
			],
		},
	};
});
