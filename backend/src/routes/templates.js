const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { models, Op } = require('../lib/db');
const { invalidateSlotsCache } = require('../services/slotsService');

const router = Router();

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

router.post('/', [
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

router.put('/:id', [
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

router.delete('/:id', [param('id').isString().notEmpty()], async (req, res, next) => {
	try {
		await models.Template.destroy({ where: { id: req.params.id } });
		res.json({ ok: true });
	} catch (e) { next(e); }
});

// Функция для генерации слотов из профиля дня
function generateSlotsFromWeekday(weekday, template) {
	if (!weekday || !weekday.start || !weekday.end) return [];
	
	const slots = [];
	const startMin = parseInt(weekday.start.split(':')[0]) * 60 + parseInt(weekday.start.split(':')[1]);
	const endMin = parseInt(weekday.end.split(':')[0]) * 60 + parseInt(weekday.end.split(':')[1]);
	const duration = template.slotDuration || 30;
	
	for (let time = startMin; time < endMin; time += duration) {
		const startTime = `${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;
		const endTime = `${String(Math.floor((time+duration)/60)).padStart(2,'0')}:${String((time+duration)%60).padStart(2,'0')}`;
		
		slots.push({
			start: startTime,
			end: endTime,
			capacity: (weekday.capacity ?? template.defaultCapacity ?? 1)
		});
	}
	
	// Применяем специальные слоты
	if (weekday.specialSlots && Array.isArray(weekday.specialSlots)) {
		weekday.specialSlots.forEach(special => {
			const specialStartMin = parseInt(special.start.split(':')[0]) * 60 + parseInt(special.start.split(':')[1]);
			const specialEndMin = parseInt(special.end.split(':')[0]) * 60 + parseInt(special.end.split(':')[1]);
			
			slots.forEach(slot => {
				const slotStartMin = parseInt(slot.start.split(':')[0]) * 60 + parseInt(slot.start.split(':')[1]);
				const slotEndMin = parseInt(slot.end.split(':')[0]) * 60 + parseInt(slot.end.split(':')[1]);
				
				if (slotStartMin >= specialStartMin && slotEndMin <= specialEndMin) {
					slot.capacity = special.capacity;
					slot.type = special.type;
				}
			});
		});
	}
	
	return slots;
}

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
		const parseLocalDate = (s) => { const [y,m,d] = String(s).slice(0,10).split('-').map(Number); return new Date(y, (m||1)-1, d||1) };
		const start = parseLocalDate(start_date);
		const end = parseLocalDate(end_date);
		const isoLocal = (d) => {
			const y = d.getFullYear();
			const m = String(d.getMonth()+1).padStart(2,'0');
			const day = String(d.getDate()).padStart(2,'0');
			return `${y}-${m}-${day}`;
		};
		
		for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate()+1)) {
			const iso = isoLocal(d);
			// Compute weekday from ISO at UTC midnight to avoid TZ skew
			const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
			const getWeekdayProfile = (weekdays, wd) => {
				const map = weekdays || {};
				const direct = map[String(wd)] || map[wd];
				if (direct && typeof direct === 'object') return direct;
				// Support templates that store Sunday under key "7"
				if (wd === 0) {
					const alt = map['7'] || map[7];
					if (alt && typeof alt === 'object') return alt;
				}
				return null;
			};
			
			const weekdayProfile = getWeekdayProfile(tpl.weekdays, weekday);
			if (!weekdayProfile) continue;

			// Normalize profile to array of items (old format) or generate from new format
			const items = Array.isArray(weekdayProfile) ? weekdayProfile : generateSlotsFromWeekday(weekdayProfile, tpl);
			
			// Remove any existing schedules for this office/date
			const existingList = await models.Schedule.findAll({ where: { office_id, date: iso } });
			for (const sch of existingList) {
				await models.Slot.destroy({ where: { schedule_id: sch.id } });
			}
			await models.Schedule.destroy({ where: { office_id, date: iso } });
			
			// Create schedule and slots
			if ((items||[]).length > 0) {
				const schedule = await models.Schedule.create({ 
					office_id, 
					date: iso, 
					isWorkingDay: true,
					isCustomized: true,
					customizedAt: new Date()
				});
				
				for (const slot of items) {
					await models.Slot.create({ 
						schedule_id: schedule.id, 
						start: slot.start, 
						end: slot.end, 
						available: true, 
						capacity: slot.capacity || 1 
					});
				}
			}
		}
		
		// Invalidate cache for the date range
		for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate()+1)) {
			const iso = isoLocal(d);
			await invalidateSlotsCache(office_id, iso);
		}
		
		res.json({ ok: true });
	} catch (e) { next(e); }
});

// Preview how a template would map to dates without applying
router.get('/:id/preview', [
	param('id').isString().notEmpty(),
	body('office_id').optional(),
	body('start_date').optional().isISO8601(),
	body('end_date').optional().isISO8601(),
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
		const getItemsForWeekday = (weekdays, wd) => {
			const map = weekdays || {};
			const direct = map[String(wd)] || map[wd];
			if (Array.isArray(direct) && direct.length) return direct;
			if (wd === 0) {
				const alt = map['7'] || map[7];
				if (Array.isArray(alt)) return alt;
			}
			return [];
		};
		const days = [];
		for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate()+1)) {
			const iso = isoLocal(d);
			const weekday = d.getDay();
			const items = getItemsForWeekday(tpl.weekdays, weekday);
			days.push({ date: iso, weekday, itemsCount: (items||[]).length });
		}
		res.json({ data: days });
	} catch (e) { next(e); }
});

// GET route for applying template to specific date (for frontend compatibility)
router.get('/:id/apply', [
	param('id').isString().notEmpty(),
	query('office_id').isString().notEmpty(),
	query('date').isISO8601(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

		const template_id = req.params.id;
		const { office_id, date } = req.query;

		const template = await models.Template.findByPk(template_id);
		if (!template) return res.status(404).json({ error: 'Template not found' });

		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });

		// Apply template to specific date
		const dateObj = new Date(`${date}T00:00:00Z`);
		const weekday = dateObj.getUTCDay();

		const getItemsForWeekday = (weekdays, wd) => {
			const map = weekdays || {};
			const direct = map[String(wd)] || map[wd];
			if (Array.isArray(direct) && direct.length) return direct;
			if (wd === 0) {
				const alt = map['7'] || map[7];
				if (Array.isArray(alt)) return alt;
			}
			return [];
		};

		const items = getItemsForWeekday(template.weekdays, weekday);

		// Remove existing schedule/slots for this date
		const existingList = await models.Schedule.findAll({ where: { office_id, date } });
		for (const sch of existingList) {
			await models.Slot.destroy({ where: { schedule_id: sch.id } });
		}
		await models.Schedule.destroy({ where: { office_id, date } });

		// Create new schedule with template slots
		if (items.length > 0) {
			const schedule = await models.Schedule.create({
				office_id,
				date,
				isWorkingDay: true,
				isCustomized: true,
				customizedAt: new Date()
			});

			for (const s of items) {
				await models.Slot.create({
					schedule_id: schedule.id,
					start: s.start,
					end: s.end,
					available: true,
					capacity: s.capacity || 1
				});
			}

			// Invalidate cache
			await invalidateSlotsCache(office_id, date);
		}

		res.json({ success: true, message: 'Template applied to date' });
	} catch (e) { next(e); }
});

// Apply template to a specific date
router.post('/apply-to-date', [
	body('template_id').isString().notEmpty(),
	body('office_id').isString().notEmpty(),
	body('date').isISO8601(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

		const { template_id, office_id, date } = req.body;

		const template = await models.Template.findByPk(template_id);
		if (!template) return res.status(404).json({ error: 'Template not found' });

		const office = await models.Office.findByPk(office_id);
		if (!office) return res.status(404).json({ error: 'Office not found' });

		// Apply template to specific date
		const dateObj = new Date(`${date}T00:00:00Z`);
		const weekday = dateObj.getUTCDay();

		const getItemsForWeekday = (weekdays, wd) => {
			const map = weekdays || {};
			const direct = map[String(wd)] || map[wd];
			if (Array.isArray(direct) && direct.length) return direct;
			if (wd === 0) {
				const alt = map['7'] || map[7];
				if (Array.isArray(alt)) return alt;
			}
			return [];
		};

		const items = getItemsForWeekday(template.weekdays, weekday);

		// Remove existing schedule/slots for this date
		const existingList = await models.Schedule.findAll({ where: { office_id, date } });
		for (const sch of existingList) {
			await models.Slot.destroy({ where: { schedule_id: sch.id } });
		}
		await models.Schedule.destroy({ where: { office_id, date } });

		// Create new schedule with template slots
		if (items.length > 0) {
			const schedule = await models.Schedule.create({
				office_id,
				date,
				isWorkingDay: true,
				isCustomized: true,
				customizedAt: new Date()
			});

			for (const s of items) {
				await models.Slot.create({
					schedule_id: schedule.id,
					start: s.start,
					end: s.end,
					available: true,
					capacity: s.capacity || 1
				});
			}

			// Invalidate cache
			await invalidateSlotsCache(office_id, date);
		}

		res.json({ success: true, message: 'Template applied to date' });
	} catch (e) { next(e); }
});

module.exports = router;