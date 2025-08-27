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
	// CORS configuration for production
	const corsOptions = {
		origin: function (origin, callback) {
			// In production, only allow specific origins
			if (!origin) {
				// Allow requests with no origin (like mobile apps)
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
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Bitrix-Domain', 'X-Requested-With']
	};
	
	app.use(cors(corsOptions));
	app.use(express.json());
	app.use(rateLimit({ windowMs: 60_000, max: 300 }));

	// Health check endpoint (read-only)
	app.get('/api/health', async (req, res) => {
		try {
			// Simple health check - no data modification
			const dbStatus = await sequelize.authenticate();
			const redisStatus = await redis.ping();
			
			res.json({ 
				ok: true, 
				timestamp: new Date().toISOString(),
				services: {
					database: dbStatus ? 'healthy' : 'unhealthy',
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

	server.listen(PORT, () => {
		console.log(`Backend listening on :${PORT}`);
	});
}

start().catch((err) => {
	console.error('Failed to start server', err);
	process.exit(1);
});