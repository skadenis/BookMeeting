import { Router } from 'express';
import { AppDataSource } from '../index';
import { Office } from '../models/Office';

export const officesRouter = Router();

officesRouter.get('/', async (_req, res, next) => {
	try {
		const repo = AppDataSource.getRepository(Office);
		const offices = await repo.find();
		res.json({ data: offices });
	} catch (e) {
		next(e);
	}
});