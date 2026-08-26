const dotenv = require('dotenv');
// .env читается до любых require, которые смотрят в process.env на этапе
// загрузки модуля. Раньше dotenv.config() стоял ниже импортов и работал
// только потому, что lib/db.js вызывает его сам.
dotenv.config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { sequelize, models, seedDefaultAdminIfEmpty } = require('./lib/db');
const { bitrixAuthMiddleware } = require('./middleware/bitrixAuth');
const { adminAuthMiddleware } = require('./middleware/adminAuth');
const { redis } = require('./lib/redis');
const { initWebsocket, closeWebsocket, broadcastTimeTick } = require('./lib/ws');
const officesRouter = require('./routes/offices');
const slotsRouter = require('./routes/slots');
const templatesRouter = require('./routes/templates');
const appointmentsRouter = require('./routes/appointments');
const adminAppointmentsRouter = require('./routes/adminAppointments');
const syncServiceRouter = require('./routes/syncService');
const apiRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const adminUsersRouter = require('./routes/adminUsers');
const adminSettingsRouter = require('./routes/adminSettings');
// const { seedIfEmpty } = require('./seed');

const PORT = Number(process.env.PORT || 4000);

// Значения по умолчанию из env.example работали как боевые: они подставлялись
// через ${VAR:-default} в docker-compose.prod.yml, если переменную не задали.
const INSECURE_DEFAULTS = [
	['ADMIN_JWT_SECRET', 'change-me-in-production'],
	['ADMIN_PASSWORD', 'admin123'],
	['PUBLIC_TOKEN_PAIRS', 'widget1:secretA,widget2:secretB'],
	['CRON_TOKEN', 'internal-cron-token'],
];

function assertProductionSecrets() {
	if (process.env.NODE_ENV !== 'production') return;
	const bad = INSECURE_DEFAULTS
		.filter(([name, def]) => !process.env[name] || process.env[name] === def)
		.map(([name]) => name);
	if (bad.length) {
		throw new Error(
			`Отказ запускаться в production: не заданы или оставлены значениями по умолчанию: ${bad.join(', ')}`
		);
	}
	if (process.env.BITRIX_DEV_MODE === 'true') {
		throw new Error('BITRIX_DEV_MODE=true недопустим при NODE_ENV=production');
	}
}

// sync() не добавляет колонки в существующие таблицы, поэтому расхождение
// модели и БД раньше проявлялось только как 500 при чтении. Теперь оно видно
// в логе при старте.
async function reportSchemaDrift() {
	try {
		const qi = sequelize.getQueryInterface();
		for (const [name, model] of Object.entries(models)) {
			const table = model.getTableName();
			let described;
			try {
				described = await qi.describeTable(table);
			} catch {
				console.warn(`Схема: таблица ${table} (${name}) не найдена`);
				continue;
			}
			const actual = new Set(Object.keys(described));
			const missing = Object.values(model.rawAttributes)
				.map((attr) => attr.field || attr.fieldName)
				.filter((field) => field && !actual.has(field));
			if (missing.length) {
				console.error(
					`СХЕМА РАСХОДИТСЯ: в таблице ${table} нет колонок [${missing.join(', ')}]. ` +
					'Запустите с DB_SYNC_ALTER=true или примените миграцию вручную.'
				);
			}
		}
	} catch (e) {
		console.error('Не удалось проверить схему:', e?.message || e);
	}
}

// Сборка Express-приложения отделена от запуска процесса, чтобы порядок
// монтирования маршрутов и middleware можно было проверить в тестах.
function createApp() {
	const app = express();

	app.set('trust proxy', 1);

	// Раньше здесь стояли два самодельных обработчика: один отвечал на любой
	// OPTIONS заголовком Access-Control-Allow-Origin: <любой Origin> вместе с
	// credentials: true, второй безусловно разрешал localhost-порты в проде.
	// Оба удалены — CORS настраивает библиотека cors по списку CORS_ORIGIN.

	// Раньше режим включался переменной BITRIX_DEV_MODE независимо от NODE_ENV,
	// а в docker-compose.yml стоят одновременно NODE_ENV=production и
	// BITRIX_DEV_MODE=true — прод-сборка отражала любой Origin.
	const isDevCors = process.env.NODE_ENV !== 'production';
	const allowedOrigins = String(process.env.CORS_ORIGIN || '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);

	const corsOptions = {
		origin(origin, callback) {
			// Запросы без Origin (curl, серверные вызовы, same-origin) пропускаем
			if (!origin) return callback(null, true);
			if (isDevCors) return callback(null, true);
			if (allowedOrigins.includes(origin)) return callback(null, true);
			console.warn('CORS blocked origin:', origin);
			// Не бросаем Error: он уходил в общий обработчик и превращался в 500
			return callback(null, false);
		},
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Bitrix-Domain', 'X-Requested-With', 'X-App-Id', 'X-App-Token', 'X-Cron-Token'],
	};
	app.use(cors(corsOptions));
	app.options('*', cors(corsOptions));

	app.use(express.json());

	// Лимит считается на IP, а весь офис сидит за одним NAT-адресом: 12
	// операторов делят один бюджет. Оценка на минуту при 12 операторах:
	//   открытие виджета      ~10 запросов × 12 = 120
	//   бронирования          ~20/мин, каждое рассылается всем 12 операторам,
	//                          после точечной перезагрузки дня это 1 запрос
	//                          на оператора вместо 7:  20 × 12 = 240
	//   перезагрузка недели у самого автора брони:      20 × 7  = 140
	//   админка и служебные                            ~200
	// Итого ~700 в спокойном режиме и до ~1500 на пике, поэтому прежние 1200
	// упирались в потолок и резали живые запросы операторов.
	app.use(rateLimit({
		windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
		max: Number(process.env.RATE_LIMIT_MAX || 3000),
		standardHeaders: true,
		legacyHeaders: false,
		message: { error: 'Too many requests', message: 'Слишком много запросов, попробуйте через минуту' },
		// Health-check не должен расходовать бюджет операторов
		skip: (req) => req.path === '/api/health',
	}));

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
	// Admin settings (public + private endpoints inside router). Mount explicitly to bypass bitrixAuth
	app.use('/api/admin/settings', adminSettingsRouter);
	// Secure sync service under admin auth or X-Cron-Token (handled inside router)
	app.use('/api/admin/sync', syncServiceRouter);

	// Public routes (protected by bitrixAuthMiddleware)
	app.use('/api', bitrixAuthMiddleware);
	app.use('/api', apiRouter);


	// Ошибки исчерпания пула и конфликтов блокировок — это перегрузка, а не
	// внутренний сбой: отвечаем 503, чтобы клиент понял, что можно повторить.
	const OVERLOAD_ERRORS = new Set([
		'SequelizeConnectionAcquireTimeoutError',
		'SequelizeTimeoutError',
	]);

	// Global error handler
	app.use((err, _req, res, _next) => {
		if (OVERLOAD_ERRORS.has(err?.name) || err?.original?.code === '40P01' || err?.original?.code === '40001') {
			console.warn('Перегрузка БД:', err?.name || err?.original?.code);
			return res.status(503).json({
				error: 'Service busy',
				message: 'Сервис временно перегружен, повторите запрос',
				timestamp: new Date().toISOString(),
			});
		}
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

	return app;
}

async function start() {
	try {
		assertProductionSecrets();
		await sequelize.authenticate();
		// sync() без alter создаёт только отсутствующие таблицы и НЕ добавляет
		// новые колонки в уже существующие — прежний комментарий обещал
		// «auto-migrate», которого не происходило, и расхождение схемы
		// всплывало как 500 при чтении.
		await sequelize.sync(process.env.DB_SYNC_ALTER === 'true' ? { alter: true } : undefined);
		await reportSchemaDrift();
		await seedDefaultAdminIfEmpty();
		await redis.connect();
		// Do not seed automatically; keep existing data persistent
	} catch (err) {
		console.error('Failed to initialize database or redis:', err);
		throw err;
	}

	const app = createApp();

	const server = http.createServer(app);
	initWebsocket(server);

	// Тик времени: клиенты сами гасят прошедшие слоты, не перезапрашивая сетку
	const tickTimer = setInterval(() => broadcastTimeTick(), 60_000);
	tickTimer.unref?.();

	let cronService = null;
	if (process.env.ENABLE_CRON !== 'false') {
		cronService = require('./services/cronService');
		cronService.startAll();
	}

	// Раньше обработчики сигналов регистрировались только внутри ветки
	// ENABLE_CRON и останавливали лишь cron: HTTP-сервер, WebSocket-соединения,
	// пул Postgres и Redis не закрывались, активные запросы обрывались.
	let shuttingDown = false;
	async function shutdown(signal) {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`Received ${signal}, shutting down...`);

		clearInterval(tickTimer);
		if (cronService) {
			try { cronService.stopAll(); } catch (e) { console.error('cron stop failed:', e?.message || e); }
		}
		try { closeWebsocket(); } catch (e) { console.error('ws close failed:', e?.message || e); }

		// Перестаём принимать новые соединения и ждём завершения текущих
		await new Promise((resolve) => server.close(resolve));

		try { await sequelize.close(); } catch (e) { console.error('db close failed:', e?.message || e); }
		try { await redis.quit(); } catch (e) { console.error('redis close failed:', e?.message || e); }

		console.log('Shutdown complete');
		process.exit(0);
	}

	process.on('SIGTERM', () => { shutdown('SIGTERM'); });
	process.on('SIGINT', () => { shutdown('SIGINT'); });

	// Принудительный выход, если что-то повисло
	process.on('SIGTERM', () => setTimeout(() => process.exit(1), 15000).unref?.());

	server.listen(PORT, () => {
		console.log(`Backend listening on :${PORT}`);
	});
}

if (require.main === module) {
	start().catch((err) => {
		console.error('Failed to start server', err);
		process.exit(1);
	});
}

module.exports = { createApp, start };