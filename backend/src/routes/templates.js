const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { models, Op } = require('../lib/db');
const { invalidateSlotsCache } = require('../services/slotsService');
const { broadcastSlotsUpdated } = require('../lib/ws');
const {
	generateSlotsFromWeekday,
	resolveWeekdayItems,
	findOrphanedAppointments,
	weekdayOf,
} = require('../lib/scheduleRewrite');

const { requireRole } = require('../middleware/adminAuth');

const router = Router();

// Как и в offices.js: писать может только роль editor и выше,
// а публичный префикс пропускает лишь GET (см. routes/index.js).
const canEdit = requireRole('editor');

router.get('/', async (_req, res, next) => {
	try {
		const items = await models.Template.findAll({ order: [['name', 'ASC']] });
		res.json({ data: items });
	} catch (e) { next(e); }
});

router.get('/:id', [
	param('id').isString().notEmpty(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		
		const item = await models.Template.findByPk(req.params.id);
		if (!item) return res.status(404).json({ error: 'Template not found' });
		
		res.json({ data: item });
	} catch (e) { next(e); }
});

router.post('/', canEdit, [
	body('name').isString().notEmpty(),
	body('description').optional().isString(),
	body('baseStartTime').optional().isString(),
	body('baseEndTime').optional().isString(),
	body('slotDuration').optional().isInt({ min: 15, max: 120 }),
	body('defaultCapacity').optional().isInt({ min: 1, max: 100 }),
	body('weekdays').isObject(),
	body('office_id').optional().isString(),
	body('isDefault').optional().isBoolean(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { 
			name, 
			description, 
			baseStartTime, 
			baseEndTime, 
			slotDuration, 
			defaultCapacity, 
			weekdays, 
			office_id, 
			isDefault 
		} = req.body;
		
		// Проверяем формат weekdays и конвертируем если нужно
		let processedWeekdays = weekdays;
		if (weekdays && typeof weekdays === 'object') {
			const firstDay = Object.values(weekdays)[0];
			if (firstDay && Array.isArray(firstDay)) {
				// Это уже массив слотов (старый формат), оставляем как есть
				processedWeekdays = weekdays;
			} else {
				// Это новый формат, конвертируем в старый для совместимости
				processedWeekdays = {};
				for (const [dayKey, profile] of Object.entries(weekdays)) {
					if (profile && profile.start && profile.end) {
						// Генерируем слоты на основе профиля дня
						const slots = generateSlotsFromWeekday(profile, { slotDuration: slotDuration || 30, defaultCapacity: (defaultCapacity ?? 1) });
						processedWeekdays[dayKey] = slots;
					}
				}
			}
		}
		
		const tpl = await models.Template.create({ 
			name, 
			description: description || null,
			baseStartTime: baseStartTime || '09:00',
			baseEndTime: baseEndTime || '18:00',
			slotDuration: slotDuration || 30,
			defaultCapacity: defaultCapacity || 1,
			weekdays: processedWeekdays, 
			office_id: office_id || null, 
			isDefault: !!isDefault 
		});
		res.status(201).json({ data: tpl });
	} catch (e) { next(e); }
 });

router.put('/:id', canEdit, [
	param('id').isString().notEmpty(),
	body('name').optional().isString().notEmpty(),
	body('description').optional().isString(),
	body('baseStartTime').optional().isString(),
	body('baseEndTime').optional().isString(),
	body('slotDuration').optional().isInt({ min: 15, max: 120 }),
	body('defaultCapacity').optional().isInt({ min: 1, max: 100 }),
	body('weekdays').optional().isObject(),
	body('isDefault').optional().isBoolean(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const item = await models.Template.findByPk(req.params.id);
		if (!item) return res.status(404).json({ error: 'Not found' });
		const { 
			name, 
			description, 
			baseStartTime, 
			baseEndTime, 
			slotDuration, 
			defaultCapacity, 
			weekdays, 
			isDefault 
		} = req.body;
		
		if (name) item.name = name;
		if (description !== undefined) item.description = description;
		if (baseStartTime) item.baseStartTime = baseStartTime;
		if (baseEndTime) item.baseEndTime = baseEndTime;
		if (slotDuration) item.slotDuration = slotDuration;
		if (defaultCapacity) item.defaultCapacity = defaultCapacity;
		if (weekdays) {
			// Проверяем формат weekdays и конвертируем если нужно
			let processedWeekdays = weekdays;
			if (weekdays && typeof weekdays === 'object') {
				const firstDay = Object.values(weekdays)[0];
				if (firstDay && Array.isArray(firstDay)) {
					// Это уже массив слотов (старый формат), оставляем как есть
					processedWeekdays = weekdays;
				} else {
					// Это новый формат, конвертируем в старый для совместимости
					processedWeekdays = {};
					for (const [dayKey, profile] of Object.entries(weekdays)) {
						if (profile && profile.start && profile.end) {
							// Генерируем слоты на основе профиля дня
							const slots = generateSlotsFromWeekday(profile, { slotDuration: item.slotDuration || 30, defaultCapacity: (item.defaultCapacity ?? 1) });
							processedWeekdays[dayKey] = slots;
						}
					}
				}
			}
			item.weekdays = processedWeekdays;
		}
		if (typeof isDefault === 'boolean') item.isDefault = isDefault;
		
		await item.save();
		res.json({ data: item });
	} catch (e) { next(e); }
});

router.delete('/:id', canEdit, [param('id').isUUID()], async (req, res, next) => {
	try {
		await models.Template.destroy({ where: { id: req.params.id } });
		res.json({ ok: true });
	} catch (e) { next(e); }
});

// Общая перезапись расписания на одну дату.
//
// Раньше логика была скопирована в четырёх местах (здесь, в GET /:id/apply,
// в POST /apply-to-date и в slots.js), и копии успели разойтись по поведению.
async function rewriteScheduleForDate({ officeId, isoDate, template, force }) {
	const items = resolveWeekdayItems(template.weekdays, weekdayOf(isoDate), template);

	// Проверяем ДО удаления: какие активные записи останутся без слота.
	// Раньше слоты и расписание удалялись безусловно, и встреча повисала
	// на времени, которого больше нет в расписании.
	const orphans = await findOrphanedAppointments({ officeId, date: isoDate, items });
	if (orphans.length > 0 && !force) {
		return { skipped: true, orphans };
	}

	const existingList = await models.Schedule.findAll({ where: { office_id: officeId, date: isoDate } });
	for (const sch of existingList) {
		await models.Slot.destroy({ where: { schedule_id: sch.id } });
	}
	await models.Schedule.destroy({ where: { office_id: officeId, date: isoDate } });

	const working = items.filter((it) => Number(it?.capacity ?? 1) > 0);
	if (working.length > 0) {
		const schedule = await models.Schedule.create({
			office_id: officeId,
			date: isoDate,
			isWorkingDay: true,
			isCustomized: true,
			customizedAt: new Date(),
		});
		for (const slot of items) {
			await models.Slot.create({
				schedule_id: schedule.id,
				start: slot.start,
				end: slot.end,
				available: true,
				capacity: (slot.capacity ?? 1),
			});
		}
	}

	await invalidateSlotsCache(officeId, isoDate);
	broadcastSlotsUpdated(officeId, isoDate);
	return { skipped: false, created: items.length, orphans: [] };
}

function eachIsoDate(startDate, endDate) {
	const parse = (v) => {
		const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
		return Date.UTC(y, (m || 1) - 1, d || 1);
	};
	const out = [];
	// Итерация в UTC: локальная арифметика дат зависела от зоны процесса
	for (let t = parse(startDate); t <= parse(endDate); t += 86400000) {
		out.push(new Date(t).toISOString().slice(0, 10));
	}
	return out;
}

router.post('/:id/apply', canEdit, [
	param('id').isUUID(),
	body('office_id').isUUID(),
	body('start_date').isISO8601(),
	body('end_date').isISO8601(),
	body('force').optional().isBoolean(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const tpl = await models.Template.findByPk(req.params.id);
		if (!tpl) return res.status(404).json({ error: 'Template not found' });

		const { office_id, start_date, end_date } = req.body;
		const force = req.body.force === true;
		const dates = eachIsoDate(start_date, end_date);
		if (dates.length === 0) return res.status(400).json({ error: 'Пустой диапазон дат' });
		if (dates.length > 366) return res.status(400).json({ error: 'Диапазон больше года' });

		const blocked = [];
		let applied = 0;
		for (const iso of dates) {
			const result = await rewriteScheduleForDate({ officeId: office_id, isoDate: iso, template: tpl, force });
			if (result.skipped) blocked.push({ date: iso, appointments: result.orphans });
			else applied++;
		}

		if (blocked.length > 0) {
			return res.status(409).json({
				error: 'Schedule rewrite would orphan appointments',
				message: 'На эти даты есть активные записи, которые не попадают в новое расписание. Повторите с force: true, если это ожидаемо.',
				applied,
				blocked,
			});
		}

		res.json({ ok: true, applied });
	} catch (e) { next(e); }
});

// Preview how a template would map to dates without applying
// Валидаторы здесь раньше стояли на body(), хотя это GET и данные читаются
// из query — то есть не проверяли ничего.
router.get('/:id/preview', [
	param('id').isUUID(),
	query('office_id').optional().isUUID(),
	query('start_date').optional().isISO8601(),
	query('end_date').optional().isISO8601(),
], async (req, res, next) => {
	try {
		const tpl = await models.Template.findByPk(req.params.id);
		if (!tpl) return res.status(404).json({ error: 'Template not found' });
		const q = req.query || {};
		const parseLocalDate = (s) => { const [y,m,d] = String(s).slice(0,10).split('-').map(Number); return new Date(y, (m||1)-1, d||1) };
		const start = q.start_date ? parseLocalDate(q.start_date) : new Date();
		const end = q.end_date ? parseLocalDate(q.end_date) : new Date(start.getFullYear(), start.getMonth(), start.getDate()+6);
		const isoLocal = (d) => {
			const y = d.getFullYear();
			const m = String(d.getMonth()+1).padStart(2,'0');
			const day = String(d.getDate()).padStart(2,'0');
			return `${y}-${m}-${day}`;
		};
		const days = [];
		for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate()+1)) {
			const iso = isoLocal(d);
			// weekdayOf считает день недели в UTC — так же, как при применении
			const weekday = weekdayOf(iso);
			const items = resolveWeekdayItems(tpl.weekdays, weekday, tpl);
			days.push({ date: iso, weekday, itemsCount: (items||[]).length });
		}
		res.json({ data: days });
	} catch (e) { next(e); }
});

// Применение шаблона к одной дате
router.post('/apply-to-date', canEdit, [
	body('template_id').isUUID(),
	body('office_id').isUUID(),
	body('date').isISO8601(),
	body('force').optional().isBoolean(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

		const { template_id, office_id, date } = req.body;
		const template = await models.Template.findByPk(template_id);
		if (!template) return res.status(404).json({ error: 'Template not found' });
		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });

		const isoDate = String(date).slice(0, 10);
		const result = await rewriteScheduleForDate({
			officeId: office_id,
			isoDate,
			template,
			force: req.body.force === true,
		});
		if (result.skipped) {
			return res.status(409).json({
				error: 'Schedule rewrite would orphan appointments',
				message: 'На эту дату есть активные записи, которые не попадают в новое расписание.',
				appointments: result.orphans,
			});
		}

		res.json({ success: true, message: 'Template applied to date' });
	} catch (e) { next(e); }
});

module.exports = router;