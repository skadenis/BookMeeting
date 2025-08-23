import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { createClient } from 'redis';
import { bitrixAuthMiddleware } from './middleware/bitrixAuth';
import { Appointment } from './models/Appointment';
import { Office } from './models/Office';
import { Schedule } from './models/Schedule';
import { Slot } from './models/Slot';
import { appointmentsRouter } from './routes/appointments';
import { officesRouter } from './routes/offices';
import { slotsRouter } from './routes/slots';

dotenv.config();

const PORT = Number(process.env.PORT || 4000);

export const AppDataSource = new DataSource({
	type: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT || 5432),
	username: process.env.DB_USERNAME || 'meetings',
	password: process.env.DB_PASSWORD || 'meetings',
	database: process.env.DB_NAME || 'meetings',
	entities: [Appointment, Office, Schedule, Slot],
	synchronize: true,
	logging: false,
});

export const redisClient = createClient({
	socket: {
		host: process.env.REDIS_HOST || 'localhost',
		port: Number(process.env.REDIS_PORT || 6379),
	},
});

async function start() {
	await AppDataSource.initialize();
	await redisClient.connect();

	const app = express();
	app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
	app.use(express.json());
	app.use(rateLimit({ windowMs: 60_000, max: 300 }));

	// Health
	app.get('/api/health', (_req, res) => res.json({ ok: true }));

	// Bitrix auth for all API routes
	app.use('/api', bitrixAuthMiddleware);

	app.use('/api/offices', officesRouter);
	app.use('/api/slots', slotsRouter);
	app.use('/api/appointments', appointmentsRouter);

	app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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