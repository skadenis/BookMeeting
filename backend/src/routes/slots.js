const { Router } = require('express');
const { query, body, param, validationResult } = require('express-validator');
const { getAvailableSlots, invalidateSlotsCache, slotsCacheKeys } = require('../services/slotsService');
const { redis } = require('../lib/redis');
const { broadcastSlotsUpdated } = require('../lib/ws');
const { models, Op } = require('../lib/db');
const { resolveWeekdayItems, weekdayOf } = require('../lib/scheduleRewrite');

// Helper function to apply template to a specific date
//
// Разбор weekdays раньше был локальной копией, понимавшей только старый
// формат-массив: для шаблона в новом формате (профиль дня) она возвращала [],
// и open-day/close-early/open-late удаляли расписание, ничего не создав.
async function applyTemplateToDate(officeId, date, weekdaysTemplate, markAsCustomized = false, template = {}) {
	const items = resolveWeekdayItems(weekdaysTemplate, weekdayOf(date), template);
	
	// Remove existing schedule/slots
	const existingList = await models.Schedule.findAll({ where: { office_id: officeId, date } });
	for (const sch of existingList) {
		await models.Slot.destroy({ where: { schedule_id: sch.id } });
	}
	await models.Schedule.destroy({ where: { office_id: officeId, date } });
	
	// Create new schedule only if there are any working slots (>0 capacity)
	const hasWorking = (items||[]).some(it => Number(it?.capacity ?? 1) > 0);
	if (hasWorking) {
		const schedule = await models.Schedule.create({ 
			office_id: officeId, 
			date, 
			isWorkingDay: true,
			isCustomized: markAsCustomized,
			customizedAt: markAsCustomized ? new Date() : null
		});
		
		for (const s of items) {
			await models.Slot.create({ 
				schedule_id: schedule.id, 
				start: s.start, 
				end: s.end, 
				available: true, 
				capacity: (s.capacity ?? 1) 
			});
		}
	}
}


const { requireRole } = require('../middleware/adminAuth');

const router = Router();

// Пишущие маршруты слотов — только для роли editor и выше.
// На публичном префиксе они отсекаются раньше (routes/index.js: readOnly).
const canEdit = requireRole('editor');

// CLOSE DAY ROUTE - отдельный endpoint для закрытия дня
router.post('/close-day', canEdit, async (req, res) => {
	try {
		console.log('CLOSE-DAY ROUTE CALLED:', JSON.stringify(req.body));
		const { office_id, date } = req.body;

		if (!office_id || !date) {
			return res.status(400).json({ error: 'Missing office_id or date' });
		}

		const schedule = await models.Schedule.findOne({ where: { office_id, date } });
		if (!schedule) {
			return res.status(404).json({ error: 'Schedule not found' });
		}

		schedule.isWorkingDay = false;
		schedule.isCustomized = true;
		schedule.customizedAt = new Date();
		await schedule.save();
		// Remove all slots for this schedule to ensure the day is effectively closed
		await models.Slot.destroy({ where: { schedule_id: schedule.id } });
		await invalidateSlotsCache(office_id, date);
		broadcastSlotsUpdated(office_id, date);

		console.log('SUCCESS: Closed day', date, 'for office', office_id);
		res.json({ success: true, message: 'Day closed successfully' });
	} catch (e) {
		console.error('Close day error:', e);
		res.status(500).json({ error: e.message });
	}
});

// Open day by applying a template's weekday items for the specific date
router.post('/open-day', canEdit, async (req, res) => {
    try {
        const { office_id, date, template_id } = req.body;
        if (!office_id || !date) {
            return res.status(400).json({ error: 'Missing office_id or date' });
        }
        let template;
        if (template_id) {
            template = await models.Template.findByPk(template_id);
            if (!template) return res.status(404).json({ error: 'Template not found' });
        } else {
            // Find default template for office or any default
            template = await models.Template.findOne({ where: { office_id: office_id } })
                || await models.Template.findOne({ where: { isDefault: true } });
            if (!template) return res.status(400).json({ error: 'Template is required to open day' });
        }

        await applyTemplateToDate(office_id, date, template.weekdays, true, template);
        await invalidateSlotsCache(office_id, date);
        broadcastSlotsUpdated(office_id, date);
        res.json({ success: true, message: 'Day opened by template' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Close early: remove all slots with start >= close_after (e.g., '16:00')
router.post('/close-early', canEdit, async (req, res) => {
    try {
        const { office_id, date, close_after, template_id } = req.body;
        if (!office_id || !date || !close_after) return res.status(400).json({ error: 'Missing params' });
        let schedule = await models.Schedule.findOne({ where: { office_id, date } });

        // If no schedule or no slots exist, attempt to open by template first
        if (!schedule) {
            let template;
            if (template_id) {
                template = await models.Template.findByPk(template_id);
            } else {
                template = await models.Template.findOne({ where: { office_id } }) || await models.Template.findOne({ where: { isDefault: true } });
            }
            if (!template) return res.status(400).json({ error: 'Template required to modify empty day' });
            await applyTemplateToDate(office_id, date, template.weekdays, true, template);
            schedule = await models.Schedule.findOne({ where: { office_id, date } });
            // applyTemplateToDate создаёт расписание только если в шаблоне есть
            // рабочие слоты. Для выходного дня schedule останется null, и
            // обращение к schedule.id ниже падало с TypeError -> 500.
            if (!schedule) {
                return res.status(400).json({ error: 'В шаблоне нет рабочих слотов на этот день недели' });
            }
        }

        await models.Slot.destroy({ where: { schedule_id: schedule.id, start: { [Op.gte]: close_after } } });
        schedule.isCustomized = true;
        schedule.customizedAt = new Date();
        await schedule.save();
        await invalidateSlotsCache(office_id, date);
        broadcastSlotsUpdated(office_id, date);
        res.json({ success: true, message: `Closed early after ${close_after}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Open late: remove all slots with end <= open_from (e.g., '12:00')
router.post('/open-late', canEdit, async (req, res) => {
    try {
        const { office_id, date, open_from, template_id } = req.body;
        if (!office_id || !date || !open_from) return res.status(400).json({ error: 'Missing params' });
        let schedule = await models.Schedule.findOne({ where: { office_id, date } });

        // If no schedule or no slots exist, attempt to open by template first
        if (!schedule) {
            let template;
            if (template_id) {
                template = await models.Template.findByPk(template_id);
            } else {
                template = await models.Template.findOne({ where: { office_id } }) || await models.Template.findOne({ where: { isDefault: true } });
            }
            if (!template) return res.status(400).json({ error: 'Template required to modify empty day' });
            await applyTemplateToDate(office_id, date, template.weekdays, true, template);
            schedule = await models.Schedule.findOne({ where: { office_id, date } });
            // applyTemplateToDate создаёт расписание только если в шаблоне есть
            // рабочие слоты. Для выходного дня schedule останется null, и
            // обращение к schedule.id ниже падало с TypeError -> 500.
            if (!schedule) {
                return res.status(400).json({ error: 'В шаблоне нет рабочих слотов на этот день недели' });
            }
        }

        await models.Slot.destroy({ where: { schedule_id: schedule.id, end: { [Op.lte]: open_from } } });
        schedule.isCustomized = true;
        schedule.customizedAt = new Date();
        await schedule.save();
        await invalidateSlotsCache(office_id, date);
        broadcastSlotsUpdated(office_id, date);
        res.json({ success: true, message: `Opened late from ${open_from}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Clear slots in a specific time interval within the day
router.post('/clear-interval', canEdit, async (req, res) => {
    try {
        const { office_id, date, from, to } = req.body;
        if (!office_id || !date || !from || !to) return res.status(400).json({ error: 'Missing params' });

        // Basic HH:mm validation
        const isTime = (t) => /^\d{2}:\d{2}$/.test(String(t));
        if (!isTime(from) || !isTime(to)) return res.status(400).json({ error: 'Invalid time format, expected HH:mm' });
        if (from >= to) return res.status(400).json({ error: 'from must be earlier than to' });

        const schedule = await models.Schedule.findOne({ where: { office_id, date } });
        if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

        // Remove all slots fully inside the interval [from, to]
        const deleted = await models.Slot.destroy({ 
            where: { 
                schedule_id: schedule.id,
                start: { [Op.gte]: from },
                end:   { [Op.lte]: to }
            }
        });

        schedule.isCustomized = true;
        schedule.customizedAt = new Date();
        await schedule.save();
        await invalidateSlotsCache(office_id, date);
        broadcastSlotsUpdated(office_id, date);

        res.json({ success: true, message: 'Interval cleared', deleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set working window for a day: regenerate from template, then trim by bounds
router.post('/set-window', canEdit, async (req, res) => {
    try {
        const { office_id, date, template_id, open_from, close_after } = req.body;
        if (!office_id || !date) return res.status(400).json({ error: 'Missing office_id or date' });
        const parseMin = (t) => { const [h,m] = String(t).slice(0,5).split(':').map(Number); return h*60 + m };
        const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

        let schedule = await models.Schedule.findOne({ where: { office_id, date } });

        // If no schedule exists, try to regenerate from template
        if (!schedule) {
            let template;
            if (template_id) {
                template = await models.Template.findByPk(template_id);
            } else {
                template = await models.Template.findOne({ where: { office_id } }) || await models.Template.findOne({ where: { isDefault: true } });
            }
            if (template) {
                await applyTemplateToDate(office_id, date, template.weekdays, true, template);
                schedule = await models.Schedule.findOne({ where: { office_id, date } });
            }
            // If still no schedule and no template available, create empty schedule to allow extension purely by window
            if (!schedule) {
                schedule = await models.Schedule.create({ office_id, date, isWorkingDay: true, isCustomized: true, customizedAt: new Date() });
            }
        }

        // Trim existing slots per bounds
        if (open_from) {
            await models.Slot.destroy({ where: { schedule_id: schedule.id, end: { [Op.lte]: open_from } } });
        }
        if (close_after) {
            await models.Slot.destroy({ where: { schedule_id: schedule.id, start: { [Op.gte]: close_after } } });
        }

        // Reload current slots ordered
        let slots = await models.Slot.findAll({ where: { schedule_id: schedule.id }, order: [['start','ASC']] });

        // Determine capacity baseline
        const baseCapacity = slots.length > 0 ? (slots[slots.length-1].capacity ?? 1) : 1;

        // Extend start side (optional): if open_from is earlier than first slot start, fill gaps forward until first slot
        if (open_from && slots.length > 0) {
            const firstStartMin = parseMin(slots[0].start);
            const openFromMin = parseMin(open_from);
            // Usually open_from >= firstStart means trim only; if open_from < firstStart, we could add earlier slots - skipping unless needed
        }

        // Extend end side: if close_after provided and the last end is before it, fill in 30-min slots until close_after
        if (close_after) {
            const closeAfterMin = parseMin(close_after);
            let lastEndMin = 0;
            if (slots.length > 0) {
                lastEndMin = parseMin(slots[slots.length-1].end);
            } else if (open_from) {
                lastEndMin = parseMin(open_from);
            }
            let cursor = lastEndMin;
            while (cursor < closeAfterMin) {
                const start = toTime(cursor);
                const end = toTime(cursor + 30);
                if (parseMin(end) > closeAfterMin) break;
                // Avoid duplicates if any
                const exists = await models.Slot.findOne({ where: { schedule_id: schedule.id, start, end } });
                if (!exists) {
                    await models.Slot.create({ schedule_id: schedule.id, start, end, available: true, capacity: baseCapacity });
                }
                cursor += 30;
            }
        }

        schedule.isWorkingDay = true;
        schedule.isCustomized = true;
        schedule.customizedAt = new Date();
        await schedule.save();
        await invalidateSlotsCache(office_id, date);
        broadcastSlotsUpdated(office_id, date);

        res.json({ success: true, message: 'Window applied' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// List schedules (exceptions/days) in a period
// exceptions endpoints removed

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

router.get('/all', async (req, res, next) => {
	try {
		console.log('GET /all called with query:', JSON.stringify(req.query));
		console.log('Request headers:', {
			authorization: req.headers.authorization ? 'present' : 'missing',
			'x-bitrix-domain': req.headers['x-bitrix-domain']
		});
		const officeId = String(req.query.office_id);
		const date = String(req.query.date).slice(0,10);
		
		// Basic validation
		if (!officeId || !date) {
			return res.status(400).json({ error: 'office_id and date are required' });
		}
		
		// В офисе одновременно работают 12 операторов, и при открытии недели
		// каждый шлёт 7 таких запросов — данные у всех одинаковые. Короткий кеш
		// снимает основную часть повторяющейся нагрузки на Postgres.
		// Сбрасывается вместе с кешем доступных слотов в invalidateSlotsCache.
		const [, allCacheKey] = slotsCacheKeys(officeId, date);
		try {
			const cached = await redis.get(allCacheKey);
			if (cached) return res.json(JSON.parse(cached));
		} catch (e) {
			console.error('slots/all: чтение кеша не удалось', e?.message || e);
		}

		const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
		if (!schedule) return res.json({ data: [], meta: { isWorkingDay: false, isCustomized: false } });
		// If the day is marked as non-working, do not return any slots
		if (schedule.isWorkingDay === false) {
			const meta = {
				isWorkingDay: schedule.isWorkingDay,
				isCustomized: schedule.isCustomized,
				customizedAt: schedule.customizedAt,
				scheduleId: schedule.id
			};
			return res.json({ data: [], meta });
		}
		
		const allSlots = await models.Slot.findAll({ where: { schedule_id: schedule.id }, order: [['start','ASC']] });
		const appointments = await models.Appointment.findAll({ where: { office_id: officeId, date, status: ['pending','confirmed'] } });
		const pendingByTime = { };
		const confirmedByTime = { };
		for (const a of appointments) {
			const ts = String(a.timeSlot||'').trim();
			if (!ts) continue;
			const bucket = a.status==='pending' ? pendingByTime : confirmedByTime;
			if (ts.includes('-')) {
				const key = ts.replace(/\s+/g,'');
				bucket[key] = (bucket[key]||0)+1;
			} else {
				bucket[ts] = (bucket[ts]||0)+1; // по старту
			}
		}
		const data = allSlots.map(s => {
			const key = `${s.start}-${s.end}`.replace(/\s+/g,'');
			const pending = (pendingByTime[key] || 0) + (pendingByTime[s.start] || 0);
			const confirmed = (confirmedByTime[key] || 0) + (confirmedByTime[s.start] || 0);
			const used = pending + confirmed;
			const capacity = Number.isFinite(s.capacity) ? s.capacity : 1;
			const free = Math.max(0, capacity - used);
			return { id: s.id, start: s.start, end: s.end, capacity, pendingCount: pending, confirmedCount: confirmed, free };
		});
		
		const meta = {
			isWorkingDay: schedule.isWorkingDay,
			isCustomized: schedule.isCustomized,
			customizedAt: schedule.customizedAt,
			scheduleId: schedule.id
		};
		
		const payload = { data, meta };
		try {
			await redis.set(allCacheKey, JSON.stringify(payload), 'EX', Number(process.env.SLOTS_CACHE_TTL || 10));
		} catch (e) {
			console.error('slots/all: запись кеша не удалась', e?.message || e);
		}

		res.json(payload);
	} catch (e) { next(e); }
});

// manual bulk day editor removed

// Единственный эндпоинт правки вместимости слота.
//
// Раньше то же самое делали шесть разных обработчиков: GET /fix-slot,
// GET /all?update_slot_id=, POST /capacity, PUT /slot/:id, POST /update-capacity
// и GET /custom/manage. Часть из них были мутирующими GET без валидации:
// ?capacity=abc записывал NaN. Остальные удалены, остался этот.
router.post('/update-capacity', canEdit, [
	body('slot_id').isUUID(),
	body('capacity').isInt({ min: 0, max: 1000 }),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		
		const slot = await models.Slot.findByPk(req.body.slot_id);
		if (!slot) return res.status(404).json({ error: 'Slot not found' });
		
		slot.capacity = Number(req.body.capacity);
		await slot.save();
		
		// Get schedule to invalidate cache
		const schedule = await models.Schedule.findByPk(slot.schedule_id);
		if (schedule) {
			await invalidateSlotsCache(schedule.office_id, schedule.date);
			broadcastSlotsUpdated(schedule.office_id, schedule.date);
		}
		
		res.json({ success: true, data: { id: slot.id, capacity: slot.capacity } });
	} catch (e) { next(e); }
});

router.post('/generate-week', canEdit, [
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
		const parseLocalDate = (s) => { const [y,m,d] = String(s).slice(0,10).split('-').map(Number); return new Date(y, (m||1)-1, d||1) };
		const start = parseLocalDate(start_date);
		const end = parseLocalDate(end_date);
		const isoLocal = (dateObj) => {
			const y = dateObj.getFullYear();
			const m = String(dateObj.getMonth()+1).padStart(2,'0');
			const day = String(dateObj.getDate()).padStart(2,'0');
			return `${y}-${m}-${day}`;
		};
		for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate()+1)) {
			const iso = isoLocal(d);
			// Compute weekday from ISO at UTC midnight to avoid TZ skew
			const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0..6
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
			const items = getItemsForWeekday(template, weekday);
			// Remove any existing schedules for this office/date (avoid duplicates)
			const existingList = await models.Schedule.findAll({ where: { office_id, date: iso } });
			for (const sch of existingList) {
				await models.Slot.destroy({ where: { schedule_id: sch.id } });
			}
			await models.Schedule.destroy({ where: { office_id, date: iso } });
			if (items.length > 0) {
				const schedule = await models.Schedule.create({ office_id, date: iso, isWorkingDay: true });
				for (const s of items) {
					await models.Slot.create({ schedule_id: schedule.id, start: s.start, end: s.end, available: true, capacity: (s.capacity ?? 1) });
				}
			}
		}
		res.status(201).json({ ok: true });
	} catch (e) { next(e); }
});

// Удалить слот
router.delete('/:id', canEdit, [
  param('id').isUUID()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;

    // Находим слот
    const slot = await models.Slot.findByPk(id, {
      include: [{ model: models.Schedule, attributes: ['id', 'office_id', 'date'] }]
    });

    if (!slot) {
      return res.status(404).json({ error: 'Слот не найден' });
    }

    let schedule = slot && slot.Schedule ? slot.Schedule : null;
    if (!schedule) {
      const scheduleId = slot && slot.get ? slot.get('schedule_id') : slot?.schedule_id;
      if (scheduleId) {
        schedule = await models.Schedule.findByPk(scheduleId);
      }
    }
    if (!schedule) {
      return res.status(404).json({ error: 'Расписание для слота не найдено' });
    }

    // Отменяем все записи в этом слоте
    await models.Appointment.update(
      { status: 'cancelled' },
      {
        where: {
          office_id: schedule.office_id,
          date: schedule.date,
          timeSlot: `${slot.start}-${slot.end}`
        }
      }
    );

    // Удаляем слот
    await slot.destroy();

    // Проверяем, остались ли еще слоты в этом расписании
    const remainingSlots = await models.Slot.count({ where: { schedule_id: schedule.id } });

    // Если слотов больше нет, удаляем и расписание
    if (remainingSlots === 0) {
      await schedule.destroy();
    }

    // Инвалидируем кеш и уведомляем клиентов
    await invalidateSlotsCache(schedule.office_id, schedule.date);
    broadcastSlotsUpdated(schedule.office_id, schedule.date);

    console.log(`Deleted slot ${id}, cancelled appointments, remaining slots: ${remainingSlots}`);

    res.json({ 
      data: { 
        id, 
        cancelled_appointments: true,
        schedule_removed: remainingSlots === 0
      } 
    });

  } catch (e) { 
    console.error('Delete slot error:', e);
    next(e); 
  }
});

module.exports = router;
