const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { sequelize, models } = require('./lib/db');
const { bitrixAuthMiddleware } = require('./middleware/bitrixAuth');
const { redis } = require('./lib/redis');
const officesRouter = require('./routes/offices');
const slotsRouter = require('./routes/slots');
const templatesRouter = require('./routes/templates');
const appointmentsRouter = require('./routes/appointments');
const { seedIfEmpty } = require('./seed');

dotenv.config();

const PORT = Number(process.env.PORT || 4000);

async function start() {
	await sequelize.authenticate();
	await sequelize.sync();
	await redis.connect();
	await seedIfEmpty();

	const app = express();
	app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
	app.use(express.json());
	app.use(rateLimit({ windowMs: 60_000, max: 300 }));

	app.get('/api/health', (_req, res) => res.json({ ok: true }));

	app.use('/api', bitrixAuthMiddleware);
	app.use('/api/offices', officesRouter);
	app.use('/api/slots', slotsRouter);
	app.use('/api/templates', templatesRouter);
	app.use('/api/appointments', appointmentsRouter);

	app.use((err, _req, res, _next) => {
		console.error(err);
		res.status(500).json({ error: 'Internal Server Error' });
	});

	app.listen(PORT, () => {
		console.log(`Backend listening on :${PORT}`);
	});
}

start().catch((err) => {
	console.error('Failed to start server', err);
	process.exit(1);
});