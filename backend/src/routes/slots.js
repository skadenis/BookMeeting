const { Router } = require('express');
const { query, body, validationResult } = require('express-validator');
const { getAvailableSlots } = require('../services/slotsService');
const { models } = require('../lib/db');

const router = Router();

router.get('/', [
	query('office_id').isString().notEmpty(),
	query('date').isISO8601(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const officeId = String(req.query.office_id);
		const date = String(req.query.date).slice(0, 10);
		const slots = await getAvailableSlots(officeId, date);
		res.json({ data: slots });
	} catch (e) { next(e); }
});

router.get('/all', [
	query('office_id').isString().notEmpty(),
	query('date').isISO8601(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const officeId = String(req.query.office_id);
		const date = String(req.query.date).slice(0,10);
		const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
		if (!schedule || !schedule.get('isWorkingDay')) return res.json({ data: [] });
		const allSlots = await models.Slot.findAll({ where: { schedule_id: schedule.id }, order: [['start','ASC']] });
		res.json({ data: allSlots.map(s => ({ id: s.id, start: s.start, end: s.end })) });
	} catch (e) { next(e); }
});

router.post('/bulk', [
	body('office_id').isString().notEmpty(),
	body('date').isISO8601(),
	body('slots').isArray({ min: 1 }),
	body('slots.*.start').isString().notEmpty(),
	body('slots.*.end').isString().notEmpty(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { office_id, date, slots } = req.body;
		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });
		const iso = String(date).slice(0, 10);
		let schedule = await models.Schedule.findOne({ where: { office_id, date: iso } });
		if (!schedule) schedule = await models.Schedule.create({ office_id, date: iso, isWorkingDay: true });
		await models.Slot.destroy({ where: { schedule_id: schedule.id } });
		for (const s of slots) {
			await models.Slot.create({ schedule_id: schedule.id, start: s.start, end: s.end, available: true });
		}
		res.status(201).json({ ok: true });
	} catch (e) { next(e); }
});

router.post('/generate-week', [
	body('office_id').isString().notEmpty(),
	body('start_date').isISO8601(),
	body('end_date').isISO8601(),
	body('template').isObject(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { office_id, start_date, end_date, template } = req.body;
		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });
		const start = new Date(String(start_date).slice(0,10));
		const end = new Date(String(end_date).slice(0,10));
		for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
			const iso = d.toISOString().slice(0,10);
			const weekday = d.getDay(); // 0..6
			const items = template[String(weekday)] || [];
			let schedule = await models.Schedule.findOne({ where: { office_id, date: iso } });
			if (!schedule) schedule = await models.Schedule.create({ office_id, date: iso, isWorkingDay: items.length>0 });
			await models.Slot.destroy({ where: { schedule_id: schedule.id } });
			for (const s of items) {
				await models.Slot.create({ schedule_id: schedule.id, start: s.start, end: s.end, available: true });
			}
		}
		res.status(201).json({ ok: true });
	} catch (e) { next(e); }
});

module.exports = router;