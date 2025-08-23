import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { AppDataSource } from '../index';
import { Appointment } from '../models/Appointment';
import { Office } from '../models/Office';
import { invalidateSlotsCache } from '../services/slotsService';

export const appointmentsRouter = Router();

appointmentsRouter.get('/', [query('lead_id').optional().isInt()], async (req, res, next) => {
	try {
		const repo = AppDataSource.getRepository(Appointment);
		const qb = repo
			.createQueryBuilder('a')
			.leftJoinAndSelect('a.office', 'office')
			.orderBy('a.created_at', 'DESC');
		const leadId = req.query.lead_id ? Number(req.query.lead_id) : undefined;
		if (leadId) qb.where('a.bitrix_lead_id = :leadId', { leadId });
		const items = await qb.getMany();
		res.json({ data: items });
	} catch (e) {
		next(e);
	}
});

appointmentsRouter.post(
	'/',
	[
		body('office_id').isString().notEmpty(),
		body('date').isISO8601(),
		body('time_slot').isString().notEmpty(),
		body('lead_id').optional().isInt(),
		body('deal_id').optional().isInt(),
		body('contact_id').optional().isInt(),
	],
	async (req, res, next) => {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

			const { office_id, date, time_slot, lead_id, deal_id, contact_id } = req.body as {
				office_id: string;
				date: string;
				time_slot: string;
				lead_id?: number;
				deal_id?: number;
				contact_id?: number;
			};

			const officeRepo = AppDataSource.getRepository(Office);
			const apptRepo = AppDataSource.getRepository(Appointment);
			const office = await officeRepo.findOne({ where: { id: office_id } });
			if (!office) return res.status(404).json({ error: 'Office not found' });

			const newDate = date.slice(0, 10);

			// Enforce one active (upcoming, confirmed) appointment per lead
			if (lead_id) {
				const today = new Date().toISOString().slice(0, 10);
				const existing = await apptRepo.findOne({ where: { bitrix_lead_id: lead_id, status: 'confirmed', date: today <= newDate ? newDate : today }, relations: ['office'] });
				if (existing) {
					const oldOfficeId = existing.office.id;
					const oldDate = existing.date;
					existing.office = office;
					existing.date = newDate;
					existing.timeSlot = time_slot;
					await apptRepo.save(existing);
					await invalidateSlotsCache(oldOfficeId, oldDate);
					await invalidateSlotsCache(office_id, newDate);
					return res.status(200).json({ data: existing, rescheduled: true });
				}
			}

			const appointment = apptRepo.create({
				office,
				bitrix_lead_id: lead_id ?? null,
				bitrix_deal_id: deal_id ?? null,
				bitrix_contact_id: contact_id ?? null,
				date: newDate,
				timeSlot: time_slot,
				status: 'confirmed',
				createdBy: req.bitrix?.userId || 0,
			});
			await apptRepo.save(appointment);

			await invalidateSlotsCache(office_id, newDate);
			res.status(201).json({ data: appointment });
		} catch (e) {
			next(e);
		}
	}
);

appointmentsRouter.put(
	'/:id',
	[
		param('id').isString().notEmpty(),
		body('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
		body('date').optional().isISO8601(),
		body('time_slot').optional().isString().notEmpty(),
		body('office_id').optional().isString().notEmpty(),
	],
	async (req, res, next) => {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
			const id = req.params.id;
			const repo = AppDataSource.getRepository(Appointment);
			const appointment = await repo.findOne({ where: { id }, relations: ['office'] });
			if (!appointment) return res.status(404).json({ error: 'Not found' });

			const { status, date, time_slot, office_id } = req.body as {
				status?: Appointment['status'];
				date?: string;
				time_slot?: string;
				office_id?: string;
			};

			const oldDate = appointment.date;
			const oldOfficeId = appointment.office.id;

			if (status) appointment.status = status;
			if (date) appointment.date = date.slice(0, 10);
			if (time_slot) appointment.timeSlot = time_slot;
			if (office_id && office_id !== appointment.office.id) {
				const officeRepo = AppDataSource.getRepository('Office');
				// @ts-expect-error dynamic repo string ok
				appointment.office = await officeRepo.findOne({ where: { id: office_id } });
			}
			await repo.save(appointment);

			await invalidateSlotsCache(oldOfficeId, oldDate);
			await invalidateSlotsCache(appointment.office.id, appointment.date);

			res.json({ data: appointment });
		} catch (e) {
			next(e);
		}
	}
);