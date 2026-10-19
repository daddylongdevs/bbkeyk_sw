import './bootstrap/MobileViewport';
import React from 'react';
import ReactDOM from 'react-dom/client';
// Disable all console output in production - runs before any other modules are loaded
if (import.meta.env.PROD) {
	const noop = () => {};
	const c = console as any;
	c.log = noop;
	c.info = noop;
	c.warn = noop;
	c.error = noop;
	c.debug = noop;
	c.trace = noop;
	c.group = noop;
	c.groupCollapsed = noop;
	c.groupEnd = noop;
	c.time = noop;
	c.timeEnd = noop;
	c.timeLog = noop;
	c.table = noop;
	c.dir = noop;
	c.dirxml = noop;
	c.count = noop;
	c.countReset = noop;
	c.assert = noop;
	c.profile = noop;
	c.profileEnd = noop;
	c.clear = noop;
}

const mount = async () => {
	const mod = await import('./App.tsx');
	const App = mod.default;
	ReactDOM.createRoot(document.getElementById('root')!).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
};

mount();
