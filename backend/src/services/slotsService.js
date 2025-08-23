const { models } = require('../lib/db');
const { redis } = require('../lib/redis');

async function getAvailableSlots(officeId, date) {
	const cacheKey = `slots:${officeId}:${date}`;
	const cached = await redis.get(cacheKey);
	if (cached) return JSON.parse(cached);

	const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
	if (!schedule || !schedule.get('isWorkingDay')) return [];

	const slots = await models.Slot.findAll({ where: { schedule_id: schedule.id, available: true }, order: [[ 'start', 'ASC' ]] });
	const appointments = await models.Appointment.findAll({ where: { office_id: officeId, date, status: 'confirmed' } });
	const countByTime = appointments.reduce((acc, a) => { acc[a.timeSlot] = (acc[a.timeSlot]||0)+1; return acc }, {});
	const available = slots
		.map((s) => {
			const key = `${s.start}-${s.end}`;
			const used = countByTime[key] || 0;
			return { id: s.id, start: s.start, end: s.end, capacity: s.capacity, used, free: Math.max(0, s.capacity - used) };
		})
		.filter((x) => x.free > 0);

	await redis.set(cacheKey, JSON.stringify(available), 'EX', 30);
	return available;
}

async function invalidateSlotsCache(officeId, date) {
	const cacheKey = `slots:${officeId}:${date}`;
	await redis.del(cacheKey);
}

module.exports = { getAvailableSlots, invalidateSlotsCache };