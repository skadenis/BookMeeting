const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { models } = require('../lib/db');
const { invalidateSlotsCache } = require('../services/slotsService');

const router = Router();

router.get('/', [query('lead_id').optional().isInt()], async (req, res, next) => {
	try {
		const where = {};
		if (req.query.lead_id) where.bitrix_lead_id = Number(req.query.lead_id);
		const items = await models.Appointment.findAll({
			where,
			include: [{ model: models.Office }],
			order: [['created_at', 'DESC']],
		});
		res.json({ data: items });
	} catch (e) { next(e); }
});

router.get('/:id/history', [param('id').isString().notEmpty()], async (req, res, next) => {
	try {
		const items = await models.AppointmentHistory.findAll({ where: { appointment_id: req.params.id }, order: [['created_at', 'ASC']] });
		res.json({ data: items });
	} catch (e) { next(e); }
});

router.post('/', [
	body('office_id').isString().notEmpty(),
	body('date').isISO8601(),
	body('time_slot').isString().notEmpty(),
	body('lead_id').optional().isInt(),
	body('deal_id').optional().isInt(),
	body('contact_id').optional().isInt(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { office_id, date, time_slot, lead_id, deal_id, contact_id } = req.body;
		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });

		const appointment = await models.Appointment.create({
			office_id,
			bitrix_lead_id: lead_id ?? null,
			bitrix_deal_id: deal_id ?? null,
			bitrix_contact_id: contact_id ?? null,
			date: String(date).slice(0, 10),
			timeSlot: time_slot,
			status: 'confirmed',
			createdBy: req.bitrix?.userId || 0,
		});
		await models.AppointmentHistory.create({ appointment_id: appointment.id, action: 'created', newValue: { date: appointment.date, timeSlot: appointment.timeSlot, status: appointment.status }, changedBy: req.bitrix?.userId || 0 });
		await invalidateSlotsCache(office_id, String(date).slice(0, 10));
		const withOffice = await models.Appointment.findByPk(appointment.id, { include: [{ model: models.Office }] });
		res.status(201).json({ data: withOffice });
	} catch (e) { next(e); }
});

router.put('/:id', [
	param('id').isString().notEmpty(),
	body('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
	body('date').optional().isISO8601(),
	body('time_slot').optional().isString().notEmpty(),
	body('office_id').optional().isString().notEmpty(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const id = req.params.id;
		const appointment = await models.Appointment.findByPk(id, { include: [{ model: models.Office }] });
		if (!appointment) return res.status(404).json({ error: 'Not found' });

		const oldSnapshot = { date: appointment.date, timeSlot: appointment.timeSlot, status: appointment.status, office_id: appointment.office_id };
		const { status, date, time_slot, office_id } = req.body;

		if (status) appointment.status = status;
		if (date) appointment.date = String(date).slice(0, 10);
		if (time_slot) appointment.timeSlot = time_slot;
		if (office_id) appointment.office_id = office_id;
		await appointment.save();

		await models.AppointmentHistory.create({
			appointment_id: appointment.id,
			action: 'updated',
			oldValue: oldSnapshot,
			newValue: { date: appointment.date, timeSlot: appointment.timeSlot, status: appointment.status, office_id: appointment.office_id },
			changedBy: req.bitrix?.userId || 0,
		});

		await invalidateSlotsCache(oldSnapshot.office_id, oldSnapshot.date);
		await invalidateSlotsCache(appointment.office_id, appointment.date);

		const withOffice = await models.Appointment.findByPk(id, { include: [{ model: models.Office }] });
		res.json({ data: withOffice });
	} catch (e) { next(e); }
});

module.exports = router;