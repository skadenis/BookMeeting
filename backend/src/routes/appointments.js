const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');

const { models, Op, Sequelize } = require('../lib/db');
const { invalidateSlotsCache } = require('../services/slotsService');

const router = Router();

router.get('/', [query('lead_id').optional().isInt()], async (req, res, next) => {
	try {
		const where = {};
		if (req.query.lead_id) where.bitrix_lead_id = Number(req.query.lead_id);
		// Показываем встречи начиная с понедельника текущей недели (PostgreSQL)
		where.date = { [Op.gte]: Sequelize.literal("DATE_TRUNC('week', CURRENT_DATE)") };
		where.status = ['pending','confirmed'];
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

		// Один лид — одна активная запись: отменяем все активные (pending/confirmed) и создаем новую
		if (lead_id) {
			const activeAppointments = await models.Appointment.findAll({
				where: {
					bitrix_lead_id: lead_id,
					status: ['pending','confirmed'],
					date: { [Op.gte]: Sequelize.literal("DATE_TRUNC('week', CURRENT_DATE)") },
				},
				include: [{ model: models.Office }],
				order: [['createdAt', 'DESC']],
			});
			for (const appt of activeAppointments) {
				const oldOfficeId = appt.office_id || (appt.Office && appt.Office.id);
				const oldDate = appt.date;
				appt.status = 'cancelled';
				await appt.save();
				await invalidateSlotsCache(oldOfficeId, oldDate);
			}
		}

		const appointment = await models.Appointment.create({
			office_id,
			bitrix_lead_id: lead_id ?? null,
			bitrix_deal_id: deal_id ?? null,
			bitrix_contact_id: contact_id ?? null,
			date: newDate,
			timeSlot: time_slot,
			status: 'pending',
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