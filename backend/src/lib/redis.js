const Redis = require('ioredis');

if (String(process.env.DISABLE_REDIS) === 'true') {
	const store = new Map();
	const redis = {
		async connect() { /* no-op */ },
		async get(key) { return store.has(key) ? store.get(key) : null; },
		async set(key, value, mode, ttl) {
			store.set(key, value);
			if (mode === 'EX' && typeof ttl === 'number') {
				setTimeout(() => store.delete(key), ttl * 1000).unref?.();
			}
			return 'OK';
		},
		async del(key) { store.delete(key); return 1; },
	};
	module.exports = { redis };
} else {
	const redis = new Redis({
		host: process.env.REDIS_HOST || 'localhost',
		port: Number(process.env.REDIS_PORT || 6379),
		lazyConnect: true,
	});
	module.exports = { redis };
}