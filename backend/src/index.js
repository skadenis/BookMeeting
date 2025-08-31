const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const http = require('http');
const { sequelize, models, seedDefaultAdminIfEmpty } = require('./lib/db');
const { bitrixAuthMiddleware } = require('./middleware/bitrixAuth');
const { adminAuthMiddleware } = require('./middleware/adminAuth');
const { redis } = require('./lib/redis');
const { initWebsocket, broadcastTimeTick } = require('./lib/ws');
const officesRouter = require('./routes/offices');
const slotsRouter = require('./routes/slots');
const templatesRouter = require('./routes/templates');
const appointmentsRouter = require('./routes/appointments');
const adminAppointmentsRouter = require('./routes/adminAppointments');
const customRouter = require('./routes/custom');
const apiRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const adminUsersRouter = require('./routes/adminUsers');
// const { seedIfEmpty } = require('./seed');

dotenv.config();

const PORT = Number(process.env.PORT || 4000);

async function start() {
	try {
		await sequelize.authenticate();
		// Auto-migrate schema to add new columns like bitrix_office_id
		await sequelize.sync();
		await seedDefaultAdminIfEmpty();
		await redis.connect();
		// Do not seed automatically; keep existing data persistent
	} catch (err) {
		console.error('Failed to initialize database or redis:', err);
		throw err;
	}

	const app = express();

	app.set('trust proxy', 1);
	// Universal fast preflight handler (before any other middleware)
	app.use((req, res, next) => {
		if (req.method === 'OPTIONS') {
			const origin = req.headers.origin || '*';
			res.header('Access-Control-Allow-Origin', origin);
			res.header('Vary', 'Origin');
			res.header('Access-Control-Allow-Credentials', 'true');
			res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
			res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Bitrix-Domain, X-App-Id, X-App-Token');
			return res.sendStatus(204);
		}
		return next();
	});

	// Force-allow local dev origins (8088/5173/5174) on all responses
	app.use((req, res, next) => {
		const origin = req.headers.origin || '';
		if (origin === 'http://localhost:8088' || origin === 'http://localhost:5173' || origin === 'http://localhost:5174') {
			res.header('Access-Control-Allow-Origin', origin);
			res.header('Vary', 'Origin');
			res.header('Access-Control-Allow-Credentials', 'true');
		}
		next();
	});
	// CORS configuration
	const isDevCors = process.env.BITRIX_DEV_MODE === 'true' || process.env.NODE_ENV !== 'production';
	if (isDevCors) {
		const devCorsOptions = {
			origin: true,
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization', 'X-Bitrix-Domain', 'X-Requested-With', 'X-App-Id', 'X-App-Token'],
		};
		app.use(cors(devCorsOptions));
		app.options('*', cors(devCorsOptions)); // handle preflight
	} else {
		const corsOptions = {
			origin: function (origin, callback) {
				if (!origin) {
					return callback(null, true);
				}
				const allowedOrigins = process.env.CORS_ORIGIN
					? process.env.CORS_ORIGIN.split(',')
					: [];
				if (allowedOrigins.indexOf(origin) !== -1) {
					callback(null, true);
				} else {
					console.log('CORS blocked origin:', origin);
					callback(new Error('Not allowed by CORS'));
				}
			},
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization', 'X-Bitrix-Domain', 'X-Requested-With', 'X-App-Id', 'X-App-Token']
		};
		app.use(cors(corsOptions));
		app.options('*', cors(corsOptions)); // handle preflight
	}
	app.use(express.json());
	app.use(rateLimit({ windowMs: 60_000, max: 300 }));

	// Health check endpoint (read-only)
	app.get('/api/health', async (req, res) => {
		try {
			// Simple health check - no data modification
			await sequelize.authenticate(); // This throws error if connection fails
			const redisStatus = await redis.ping();
			
			res.json({ 
				ok: true, 
				timestamp: new Date().toISOString(),
				services: {
					database: 'healthy',
					redis: redisStatus === 'PONG' ? 'healthy' : 'unhealthy'
				}
			});
		} catch (e) {
			console.error('Health check failed:', e.message);
			res.status(503).json({ 
				ok: false, 
				error: 'Service unavailable',
				timestamp: new Date().toISOString()
			});
		}
	});

	
	// Public admin auth routes
	app.use('/api/auth', authRouter);
	
	// Admin routes (protected by adminAuthMiddleware)
	app.use('/api/admin/users', adminUsersRouter);
	
	// Admin-specific routes that need admin auth
	app.use('/api/admin/offices', adminAuthMiddleware, officesRouter);
	app.use('/api/admin/slots', adminAuthMiddleware, slotsRouter);
	app.use('/api/admin/templates', adminAuthMiddleware, templatesRouter);
	app.use('/api/admin/appointments', adminAuthMiddleware, adminAppointmentsRouter);

	// Public routes (protected by bitrixAuthMiddleware)
	app.use('/api', bitrixAuthMiddleware);
	app.use('/api', apiRouter);


	// Global error handler
	app.use((err, _req, res, _next) => {
		// Log error with proper formatting
		console.error('Error occurred:', {
			message: err.message,
			stack: err.stack,
			timestamp: new Date().toISOString()
		});
		
		// Don't expose internal errors to client
		const statusCode = err.status || 500;
		const message = statusCode === 500 ? 'Internal Server Error' : err.message;
		
		res.status(statusCode).json({ 
			error: message,
			timestamp: new Date().toISOString()
		});
	});

	const server = http.createServer(app);
	initWebsocket(server);

	// Minute tick: notify clients so they can filter past slots
	setInterval(() => broadcastTimeTick(), 60_000).unref?.();

	// Запускаем cron сервис для автоматической синхронизации
	if (process.env.ENABLE_CRON !== 'false') {
		const cronService = require('./services/cronService');
		cronService.startAll();
		
		// Graceful shutdown для cron задач
		process.on('SIGTERM', () => {
			console.log('Received SIGTERM, stopping cron jobs...');
			cronService.stopAll();
		});
		
		process.on('SIGINT', () => {
			console.log('Received SIGINT, stopping cron jobs...');
			cronService.stopAll();
		});
	}

	server.listen(PORT, () => {
		console.log(`Backend listening on :${PORT}`);
	});
}

start().catch((err) => {
	console.error('Failed to start server', err);
	process.exit(1);
});