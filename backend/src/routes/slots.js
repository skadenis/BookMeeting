const { Router } = require('express');
const { query, body, param, validationResult } = require('express-validator');
const { getAvailableSlots, invalidateSlotsCache } = require('../services/slotsService');
const { models, Op } = require('../lib/db');

// Helper function to apply template to a specific date
async function applyTemplateToDate(officeId, date, weekdaysTemplate, markAsCustomized = false) {
	const dateObj = new Date(`${date}T00:00:00Z`);
	const weekday = dateObj.getUTCDay(); // 0..6
	
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
	
	const items = getItemsForWeekday(weekdaysTemplate, weekday);
	
	// Remove existing schedule/slots
	const existingList = await models.Schedule.findAll({ where: { office_id: officeId, date } });
	for (const sch of existingList) {
		await models.Slot.destroy({ where: { schedule_id: sch.id } });
	}
	await models.Schedule.destroy({ where: { office_id: officeId, date } });
	
	// Create new schedule
	if (items.length > 0) {
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
				capacity: s.capacity || 1 
			});
		}
	}
}


const router = Router();

// SIMPLE TEST ROUTE
router.get('/test-simple', (req, res) => {
  console.log('GET /test-simple works!');
  res.json({ test: 'simple route works' });
});

// WORKING CAPACITY UPDATE - FIXED VERSION
router.get('/fix-slot', async (req, res) => {
  console.log('FIX-SLOT called with:', req.query);
  try {
    if (req.query.slot_id && req.query.capacity) {
      const slot = await models.Slot.findByPk(req.query.slot_id);
      if (slot) {
        const oldCapacity = slot.capacity;
        slot.capacity = Number(req.query.capacity);
        await slot.save();
        
        // Mark schedule as customized
        const schedule = await models.Schedule.findByPk(slot.schedule_id);
        if (schedule) {
          schedule.isCustomized = true;
          schedule.customizedAt = new Date();
          await schedule.save();
          await invalidateSlotsCache(schedule.office_id, schedule.date);
        }
        
        console.log('SUCCESS: Updated slot capacity from', oldCapacity, 'to', slot.capacity);
        return res.json({ success: true, capacity: slot.capacity, message: 'Capacity updated' });
      }
    }
    
    // Handle day operations
    if (req.query.action && req.query.office_id && req.query.date) {
      const { action, office_id, date } = req.query;
      console.log('DAY ACTION:', action, 'for office', office_id, 'date', date);
      
      switch (action) {
        case 'close_day':
          const schedule = await models.Schedule.findOne({ where: { office_id, date } });
          if (schedule) {
            schedule.isWorkingDay = false;
            schedule.isCustomized = true;
            schedule.customizedAt = new Date();
            await schedule.save();
            await invalidateSlotsCache(office_id, date);
            console.log('SUCCESS: Closed day');
            return res.json({ success: true, message: 'Day closed' });
          }
          break;
          
        case 'close_early':
          if (req.query.close_after) {
            const schedule = await models.Schedule.findOne({ where: { office_id, date } });
            if (schedule) {
              await models.Slot.destroy({ 
                where: { 
                  schedule_id: schedule.id,
                  start: { [Op.gte]: req.query.close_after }
                }
              });
              schedule.isCustomized = true;
              schedule.customizedAt = new Date();
              await schedule.save();
              await invalidateSlotsCache(office_id, date);
              console.log('SUCCESS: Closed early after', req.query.close_after);
              return res.json({ success: true, message: `Closed early after ${req.query.close_after}` });
            }
          }
          break;
          
        case 'open_late':
          if (req.query.open_from) {
            const schedule = await models.Schedule.findOne({ where: { office_id, date } });
            if (schedule) {
              await models.Slot.destroy({ 
                where: { 
                  schedule_id: schedule.id,
                  end: { [Op.lte]: req.query.open_from }
                }
              });
              schedule.isCustomized = true;
              schedule.customizedAt = new Date();
              await schedule.save();
              await invalidateSlotsCache(office_id, date);
              console.log('SUCCESS: Opened late from', req.query.open_from);
              return res.json({ success: true, message: `Opened late from ${req.query.open_from}` });
            }
          }
          break;
      }
    }
    
    res.json({ error: 'Missing required parameters' });
  } catch (e) {
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// CLOSE DAY ROUTE - отдельный endpoint для закрытия дня
router.post('/close-day', async (req, res) => {
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
		await invalidateSlotsCache(office_id, date);

		console.log('SUCCESS: Closed day', date, 'for office', office_id);
		res.json({ success: true, message: 'Day closed successfully' });
	} catch (e) {
		console.error('Close day error:', e);
		res.status(500).json({ error: e.message });
	}
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
		
		// Handle capacity update via query params (working solution)
		if (req.query.update_slot_id && req.query.new_capacity) {
			console.log('CAPACITY UPDATE REQUEST:', {
				slot_id: req.query.update_slot_id,
				new_capacity: req.query.new_capacity,
				office_id: officeId,
				date: date
			});
			const slot = await models.Slot.findByPk(req.query.update_slot_id);
			if (slot) {
				const oldCapacity = slot.capacity;
				slot.capacity = Number(req.query.new_capacity);
				await slot.save();
				
				// Mark schedule as customized
				const schedule = await models.Schedule.findByPk(slot.schedule_id);
				if (schedule) {
					schedule.isCustomized = true;
					schedule.customizedAt = new Date();
					// TODO: set customizedBy from auth context
					await schedule.save();
					await invalidateSlotsCache(officeId, date);
				}
				
				console.log('SUCCESS: Updated slot capacity from', oldCapacity, 'to', slot.capacity);
			} else {
				console.log('ERROR: Slot not found');
			}
		}
		
		// Handle day-level operations via query params
		if (req.query.action) {
			console.log('DAY ACTION:', req.query.action, 'for office', officeId, 'date', date);
			
			switch (req.query.action) {
				case 'close_day':
					// Close entire day
					const scheduleToClose = await models.Schedule.findOne({ where: { office_id: officeId, date } });
					if (scheduleToClose) {
						scheduleToClose.isWorkingDay = false;
						scheduleToClose.isCustomized = true;
						scheduleToClose.customizedAt = new Date();
						await scheduleToClose.save();
						await invalidateSlotsCache(officeId, date);
						console.log('SUCCESS: Closed day');
					}
					break;
					
				case 'open_day':
					// Open day (needs template to generate slots)
					if (req.query.template_id) {
						const template = await models.Template.findByPk(req.query.template_id);
						if (template) {
							// Apply template for this specific date
							await applyTemplateToDate(officeId, date, template.weekdays, true);
							console.log('SUCCESS: Opened day with template');
						}
					}
					break;
					
				case 'close_early':
					// Close day early - remove slots after specific time
					if (req.query.close_after) {
						const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
						if (schedule) {
							await models.Slot.destroy({ 
								where: { 
									schedule_id: schedule.id,
									start: { [Op.gte]: req.query.close_after }
								}
							});
							schedule.isCustomized = true;
							schedule.customizedAt = new Date();
							await schedule.save();
							await invalidateSlotsCache(officeId, date);
							console.log('SUCCESS: Closed early after', req.query.close_after);
						}
					}
					break;
					
				case 'open_late':
					// Open day late - remove slots before specific time
					if (req.query.open_from) {
						const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
						if (schedule) {
							await models.Slot.destroy({ 
								where: { 
									schedule_id: schedule.id,
									end: { [Op.lte]: req.query.open_from }
								}
							});
							schedule.isCustomized = true;
							schedule.customizedAt = new Date();
							await schedule.save();
							await invalidateSlotsCache(officeId, date);
							console.log('SUCCESS: Opened late from', req.query.open_from);
						}
					}
					break;
			}
		}
		
		const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
		if (!schedule) return res.json({ data: [], meta: { isWorkingDay: false, isCustomized: false } });
		
		const allSlots = await models.Slot.findAll({ where: { schedule_id: schedule.id }, order: [['start','ASC']] });
		const appointments = await models.Appointment.findAll({ where: { office_id: officeId, date, status: ['pending','confirmed'] } });
		const pendingByTime = appointments.filter(a=>a.status==='pending').reduce((acc,a)=>{ acc[a.timeSlot]=(acc[a.timeSlot]||0)+1; return acc },{});
		const confirmedByTime = appointments.filter(a=>a.status==='confirmed').reduce((acc,a)=>{ acc[a.timeSlot]=(acc[a.timeSlot]||0)+1; return acc },{});
		const data = allSlots.map(s => {
			const key = `${s.start}-${s.end}`;
			const pending = pendingByTime[key] || 0;
			const confirmed = confirmedByTime[key] || 0;
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
		
		res.json({ data, meta });
	} catch (e) { next(e); }
});

// manual bulk day editor removed

// Simple capacity update endpoint 
router.post('/update-capacity', [
	body('slot_id').isString().notEmpty(),
	body('capacity').isInt({ min: 1 }),
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
		}
		
		res.json({ success: true, data: { id: slot.id, capacity: slot.capacity } });
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
					await models.Slot.create({ schedule_id: schedule.id, start: s.start, end: s.end, available: true, capacity: s.capacity || 1 });
				}
			}
		}
		res.status(201).json({ ok: true });
	} catch (e) { next(e); }
});

// Debug: inspect schedule and slots for a specific date
router.get('/debug', [
  query('office_id').isString().notEmpty(),
  query('date').isISO8601(),
], async (req, res, next) => {
  try {
    const officeId = String(req.query.office_id);
    const date = String(req.query.date).slice(0,10);
    const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
    if (!schedule) return res.json({ data: { hasSchedule: false } });
    const slots = await models.Slot.findAll({ where: { schedule_id: schedule.id }, order: [['start','ASC']] });
    res.json({ data: {
      hasSchedule: true,
      isWorkingDay: schedule.get('isWorkingDay'),
      scheduleId: schedule.id,
      slotCount: slots.length,
      sample: slots.slice(0,3).map(s=>({start:s.start,end:s.end,capacity:s.capacity}))
    }});
  } catch (e) { next(e); }
});

// Update slot capacity (simplified for debugging)
router.put('/slot/:id', async (req, res, next) => {
  console.log('PUT /slot/:id hit with params:', req.params);
  try {
    const id = req.params.id;
    const slot = await models.Slot.findByPk(id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    slot.capacity = Number(req.body.capacity || 1);
    await slot.save();
    // Invalidate caches
    const schedule = await models.Schedule.findByPk(slot.schedule_id);
    if (schedule) await invalidateSlotsCache(schedule.office_id, schedule.date);
    res.json({ data: { id: slot.id, capacity: slot.capacity } });
  } catch (e) { next(e); }
});

// Debug: test POST route for comparison
router.post('/slot/:id/test', async (req, res) => {
  console.log('POST /slot/:id/test hit with params:', req.params);
  res.json({ test: 'POST works', id: req.params.id });
});

// Debug: list all routes
console.log('Registering PUT /slot/:id route');
console.log('Registering POST /slot/:id/test route');

// Fallback endpoint to update capacity by body slot_id (avoids param issues)
router.post('/capacity', async (req, res, next) => {
  console.log('POST /capacity hit with body:', req.body);
  try {
    const id = req.body.slot_id;
    const slot = await models.Slot.findByPk(id);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    slot.capacity = Number(req.body.capacity);
    await slot.save();
    const schedule = await models.Schedule.findByPk(slot.schedule_id);
    if (schedule) await invalidateSlotsCache(schedule.office_id, schedule.date);
    res.json({ data: { id: slot.id, capacity: slot.capacity } });
  } catch (e) { next(e); }
});

module.exports = router;
