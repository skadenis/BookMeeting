const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { models, Op } = require('../lib/db');
const { invalidateSlotsCache } = require('../services/slotsService');

const router = Router();

router.get('/', [query('lead_id').optional().isInt()], async (req, res, next) => {
	try {
		const where = {};
		if (req.query.lead_id) where.bitrix_lead_id = Number(req.query.lead_id);
		// Показываем только будущие/активные по умолчанию
		const today = new Date().toISOString().slice(0,10);
		where.date = { [Op.gte]: today };
		const items = await models.Appointment.findAll({
			where,
			include: [{ model: models.Office }],
			order: [['createdAt', 'DESC']],
		});
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

		const newDate = String(date).slice(0, 10);

		// Один лид — одна активная запись: переносим, если уже есть предстоящая confirmed
		if (lead_id) {
			const today = new Date().toISOString().slice(0,10);
			const existing = await models.Appointment.findOne({
				where: { bitrix_lead_id: lead_id, status: 'confirmed', date: { [Op.gte]: today } },
				include: [{ model: models.Office }],
				order: [['createdAt', 'DESC']],
			});
			if (existing) {
				const oldOfficeId = existing.office_id || (existing.Office && existing.Office.id);
				const oldDate = existing.date;
				existing.office_id = office_id;
				existing.date = newDate;
				existing.timeSlot = time_slot;
				await existing.save();
				await invalidateSlotsCache(oldOfficeId, oldDate);
				await invalidateSlotsCache(office_id, newDate);
				return res.status(200).json({ data: existing, rescheduled: true });
			}
		}

		const appointment = await models.Appointment.create({
			office_id,
			bitrix_lead_id: lead_id ?? null,
			bitrix_deal_id: deal_id ?? null,
			bitrix_contact_id: contact_id ?? null,
			date: newDate,
			timeSlot: time_slot,
			status: 'confirmed',
			createdBy: (req.bitrix && req.bitrix.userId) || 0,
		});
		await invalidateSlotsCache(office_id, newDate);
		res.status(201).json({ data: await models.Appointment.findByPk(appointment.id, { include: [{ model: models.Office }] }) });
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

		const { status, date, time_slot, office_id } = req.body;
		const oldDate = appointment.date;
		const oldOfficeId = appointment.office_id || (appointment.Office && appointment.Office.id);

		if (status) appointment.status = status;
		if (date) appointment.date = String(date).slice(0, 10);
		if (time_slot) appointment.timeSlot = time_slot;
		if (office_id) appointment.office_id = office_id;
		await appointment.save();

		await invalidateSlotsCache(oldOfficeId, oldDate);
		await invalidateSlotsCache(appointment.office_id, appointment.date);

		res.json({ data: await models.Appointment.findByPk(id, { include: [{ model: models.Office }] }) });
	} catch (e) { next(e); }
});

module.exports = router;