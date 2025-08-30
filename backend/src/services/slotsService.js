const { models } = require('../lib/db');
const { redis } = require('../lib/redis');

async function getAvailableSlots(officeId, date) {
	const cacheKey = `slots:${officeId}:${date}`;
	const cached = await redis.get(cacheKey);
	if (cached) return JSON.parse(cached);

	const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
	if (!schedule || !schedule.get('isWorkingDay')) return [];

	const slots = await models.Slot.findAll({ where: { schedule_id: schedule.id, available: true }, order: [[ 'start', 'ASC' ]] });
	const appointments = await models.Appointment.findAll({ where: { office_id: officeId, date, status: ['pending','confirmed'] } });
	// Support both "HH:MM-HH:MM" and "HH:MM" formats in timeSlot
	const countByFull = {};
	const countByStart = {};
	for (const a of appointments) {
		const ts = String(a.timeSlot || '').trim();
		if (!ts) continue;
		if (ts.includes('-')) {
			const key = ts.replace(/\s+/g, '');
			countByFull[key] = (countByFull[key] || 0) + 1;
		} else {
			countByStart[ts] = (countByStart[ts] || 0) + 1;
		}
	}
	// Filter out past slots for the current day
	const now = new Date();
	const isToday = String(date) === new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0,10);
	const available = slots
		.map((s) => {
			const key = `${s.start}-${s.end}`.replace(/\s+/g, '');
			const used = (countByFull[key] || 0) + (countByStart[s.start] || 0);
			return { id: s.id, start: s.start, end: s.end, capacity: s.capacity, used, free: Math.max(0, s.capacity - used) };
		})
		.filter((x) => {
			if (x.free <= 0) return false;
			if (!isToday) return true;
			try {
				const [hh, mm] = String(x.start).split(':').map(Number);
				const startDt = new Date();
				startDt.setHours(Number.isFinite(hh)?hh:0, Number.isFinite(mm)?mm:0, 0, 0);
				return startDt.getTime() > now.getTime();
			} catch { return true }
		});


	await redis.set(cacheKey, JSON.stringify(available), 'EX', 30);
	return available;
}

async function invalidateSlotsCache(officeId, date) {
	const cacheKey = `slots:${officeId}:${date}`;
	await redis.del(cacheKey);
}

module.exports = { getAvailableSlots, invalidateSlotsCache };