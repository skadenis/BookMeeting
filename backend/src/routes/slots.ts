import { Router } from 'express';
import { query, validationResult } from 'express-validator';
import { getAvailableSlots } from '../services/slotsService';

export const slotsRouter = Router();

slotsRouter.get(
	'/',
	[
		query('office_id').isString().notEmpty(),
		query('date').isISO8601().toDate(),
	],
	async (req, res, next) => {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}
			const officeId = req.query.office_id as string;
			const date = (req.query.date as string).slice(0, 10);
			const slots = await getAvailableSlots(officeId, date);
			res.json({ data: slots });
		} catch (e) {
			next(e);
		}
	}
);