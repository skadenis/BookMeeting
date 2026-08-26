const { models } = require('../lib/db');
const { redis } = require('../lib/redis');
const { businessToday, parseBusinessDateTime } = require('../lib/time');

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
	// Отсечение прошедших слотов текущего дня.
	//
	// Раньше «сегодня» вычислялось как
	//   new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0,10)
	// — это полночь по локальной зоне, переведённая в UTC. При TZ=Europe/Minsk
	// (UTC+3) выражение давало ВЧЕРАШНЮЮ дату, isToday всегда был false, и
	// фильтр не срабатывал ни разу: через API можно было записаться на уже
	// прошедшее время сегодняшнего дня.
	//
	// Сравнение времени тоже шло через setHours() в зоне процесса. Теперь и
	// дата, и время берутся из lib/time.js в бизнес-зоне.
	const now = new Date();
	const isToday = String(date).slice(0, 10) === businessToday(now);
	const available = slots
		.map((s) => {
			const key = `${s.start}-${s.end}`.replace(/\s+/g, '');
			const used = (countByFull[key] || 0) + (countByStart[s.start] || 0);
			const capacity = Number.isFinite(Number(s.capacity)) ? Number(s.capacity) : 0;
			return { id: s.id, start: s.start, end: s.end, capacity, used, free: Math.max(0, capacity - used) };
		})
		.filter((x) => {
			if (x.free <= 0) return false;
			if (!isToday) return true;
			const startsAt = parseBusinessDateTime(date, x.start);
			// Не смогли разобрать время — не прячем слот молча
			if (!startsAt) return true;
			return startsAt.getTime() > now.getTime();
		});


	await redis.set(cacheKey, JSON.stringify(available), 'EX', 30);
	return available;
}

// Ключи кеша сетки слотов на офис+дату. Их два: доступные слоты для виджета
// и полная сетка с занятостью для админки.
function slotsCacheKeys(officeId, date) {
	const d = String(date).slice(0, 10);
	return [`slots:${officeId}:${d}`, `slots:all:${officeId}:${d}`];
}

async function invalidateSlotsCache(officeId, date) {
	if (!officeId || !date) return;
	for (const key of slotsCacheKeys(officeId, date)) {
		try { await redis.del(key); } catch (e) {
			console.error('slotsService: не удалось сбросить кеш', key, e?.message || e);
		}
	}
}

module.exports = { getAvailableSlots, invalidateSlotsCache, slotsCacheKeys };