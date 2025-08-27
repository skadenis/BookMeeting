const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const http = require('http');
const { sequelize, models } = require('./lib/db');
const { bitrixAuthMiddleware } = require('./middleware/bitrixAuth');
const { redis } = require('./lib/redis');
const { initWebsocket, broadcastTimeTick } = require('./lib/ws');
const officesRouter = require('./routes/offices');
const slotsRouter = require('./routes/slots');
const templatesRouter = require('./routes/templates');
const appointmentsRouter = require('./routes/appointments');
const customRouter = require('./routes/custom');
const apiRouter = require('./routes/index');
// const { seedIfEmpty } = require('./seed');

dotenv.config();

const PORT = Number(process.env.PORT || 4000);

async function start() {
	try {
		await sequelize.authenticate();
		// Auto-migrate schema to add new columns like bitrix_office_id
		await sequelize.sync();
		await redis.connect();
		// Do not seed automatically; keep existing data persistent
	} catch (err) {
		console.error('Failed to initialize database or redis:', err);
		throw err;
	}

	const app = express();

	app.set('trust proxy', 1);
	// CORS configuration
	const corsOptions = {
		origin: function (origin, callback) {
			// Allow requests with no origin (like mobile apps or curl requests)
			if (!origin) return callback(null, true);
			
			const allowedOrigins = process.env.CORS_ORIGIN 
				? process.env.CORS_ORIGIN.split(',') 
				: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4000'];
			
			if (allowedOrigins.indexOf(origin) !== -1) {
				callback(null, true);
			} else {
				console.log('CORS blocked origin:', origin);
				callback(null, true); // Allow all for development
			}
		},
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Bitrix-Domain', 'X-Requested-With']
	};
	
	app.use(cors(corsOptions));
	app.use(express.json());
	app.use(rateLimit({ windowMs: 60_000, max: 300 }));

	// Test route to verify API connectivity
	app.get('/api/test-connection', (req, res) => {
		console.log('TEST CONNECTION HIT:', {
			headers: req.headers,
			query: req.query,
			timestamp: new Date().toISOString()
		});
		res.json({
			success: true,
			message: 'Backend API connection successful',
			timestamp: new Date().toISOString(),
			headers: {
				authorization: req.headers.authorization ? 'present' : 'missing',
				'x-bitrix-domain': req.headers['x-bitrix-domain']
			}
		});
	});

	app.get('/api/health', async (req, res) => {
		try {
			// If has slot management parameters, handle them
			if (req.query.slot_id && req.query.capacity) {
				console.log('HEALTH-SLOT: updating slot', req.query.slot_id, 'capacity to', req.query.capacity);
				const { Slot, Schedule } = models;
				const slot = await Slot.findByPk(req.query.slot_id);
				if (slot) {
					const oldCapacity = slot.capacity;
					slot.capacity = Number(req.query.capacity);
					await slot.save();
					
					// Mark as customized
					const schedule = await Schedule.findByPk(slot.schedule_id);
					if (schedule) {
						schedule.isCustomized = true;
						schedule.customizedAt = new Date();
						await schedule.save();
					}
					
					console.log('SUCCESS: Updated capacity from', oldCapacity, 'to', slot.capacity);
					return res.json({ ok: true, capacity_updated: true, new_capacity: slot.capacity });
				}
			}
			
			// If has day management parameters, handle them
			if (req.query.action && req.query.office_id && req.query.date) {
				console.log('HEALTH-DAY:', req.query.action, 'for', req.query.office_id, req.query.date);
				const { Schedule, Slot } = models;
				const { action, office_id, date } = req.query;
				
				switch (action) {
					case 'close_day':
						const schedule = await Schedule.findOne({ where: { office_id, date } });
						if (schedule) {
							schedule.isWorkingDay = false;
							schedule.isCustomized = true;
							schedule.customizedAt = new Date();
							await schedule.save();
							console.log('SUCCESS: Closed day');
							return res.json({ ok: true, day_closed: true });
						}
						break;
				}
			}
			
			res.json({ ok: true });
		} catch (e) {
			console.error('Health endpoint error:', e);
			res.json({ ok: true, error: e.message });
		}
	});
	
	app.use('/api', bitrixAuthMiddleware);
	app.use('/api', apiRouter);

	// Debug: list all registered routes
	app.get('/api/routes', (_req, res) => {
		function getRoutes(stack, prefix = '') {
			const routes = [];
			stack.forEach((layer) => {
				if (layer.route) {
					const path = prefix + (layer.route.path || '');
					const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
					routes.push({ path, methods });
				} else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
					const newPrefix = prefix + (layer.regexp && layer.regexp.fast_slash ? '' : (layer.regexp && layer.regexp.source || ''));
					try {
						const nested = getRoutes(layer.handle.stack, prefix);
						routes.push(...nested);
					} catch (e) {}
				}
			});
			return routes;
		}

		const all = getRoutes(app._router.stack);
		res.json({ routes: all });
	});


	app.use((err, _req, res, _next) => {
		console.error(err);
		res.status(500).json({ error: 'Internal Server Error' });
	});

	const server = http.createServer(app);
	initWebsocket(server);

	// Minute tick: notify clients so they can filter past slots
	setInterval(() => broadcastTimeTick(), 60_000).unref?.();

	server.listen(PORT, () => {
		console.log(`Backend listening on :${PORT}`);
	});
}

start().catch((err) => {
	console.error('Failed to start server', err);
	process.exit(1);
});