const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const { models } = require('../lib/db');

const router = Router();

router.get('/', async (_req, res, next) => {
	try {
		const items = await models.Template.findAll({ order: [['name', 'ASC']] });
		res.json({ data: items });
	} catch (e) { next(e); }
});

router.post('/', [
	body('name').isString().notEmpty(),
	body('weekdays').isObject(),
	body('office_id').optional().isString(),
	body('isDefault').optional().isBoolean(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { name, weekdays, office_id, isDefault } = req.body;
		const tpl = await models.Template.create({ name, weekdays, office_id: office_id || null, isDefault: !!isDefault });
		res.status(201).json({ data: tpl });
	} catch (e) { next(e); }
});

router.put('/:id', [
	param('id').isString().notEmpty(),
	body('name').optional().isString().notEmpty(),
	body('weekdays').optional().isObject(),
	body('isDefault').optional().isBoolean(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const item = await models.Template.findByPk(req.params.id);
		if (!item) return res.status(404).json({ error: 'Not found' });
		const { name, weekdays, isDefault } = req.body;
		if (name) item.name = name;
		if (weekdays) item.weekdays = weekdays;
		if (typeof isDefault === 'boolean') item.isDefault = isDefault;
		await item.save();
		res.json({ data: item });
	} catch (e) { next(e); }
});

router.delete('/:id', [param('id').isString().notEmpty()], async (req, res, next) => {
	try {
		await models.Template.destroy({ where: { id: req.params.id } });
		res.json({ ok: true });
	} catch (e) { next(e); }
});

router.post('/:id/apply', [
	param('id').isString().notEmpty(),
	body('office_id').isString().notEmpty(),
	body('start_date').isISO8601(),
	body('end_date').isISO8601(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const tpl = await models.Template.findByPk(req.params.id);
		if (!tpl) return res.status(404).json({ error: 'Template not found' });
		const { office_id, start_date, end_date } = req.body;
		const start = new Date(String(start_date).slice(0,10));
		const end = new Date(String(end_date).slice(0,10));
		for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
			const iso = d.toISOString().slice(0,10);
			const weekday = d.getDay();
			const items = (tpl.weekdays && tpl.weekdays[String(weekday)]) || [];
			let schedule = await models.Schedule.findOne({ where: { office_id, date: iso } });
			if (!schedule) schedule = await models.Schedule.create({ office_id, date: iso, isWorkingDay: items.length>0 });
			await models.Slot.destroy({ where: { schedule_id: schedule.id } });
			for (const s of items) {
				await models.Slot.create({ schedule_id: schedule.id, start: s.start, end: s.end, available: true });
			}
		}
		res.json({ ok: true });
	} catch (e) { next(e); }
});

module.exports = router;