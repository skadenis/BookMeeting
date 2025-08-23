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
	const busy = new Set(appointments.map(a => a.timeSlot));
	const available = slots.filter(s => !busy.has(`${s.start}-${s.end}`)).map(s => ({ id: s.id, start: s.start, end: s.end }));
	await redis.set(cacheKey, JSON.stringify(available), 'EX', 30);
	return available;
}

async function invalidateSlotsCache(officeId, date) {
	const cacheKey = `slots:${officeId}:${date}`;
	await redis.del(cacheKey);
}

module.exports = { getAvailableSlots, invalidateSlotsCache };