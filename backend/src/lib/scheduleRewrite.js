// Разбор шаблона расписания и защита от осиротевших записей.
//
// Шаблон хранит weekdays в двух форматах:
//   старый — массив слотов:        {"1": [{start,end,capacity}, ...]}
//   новый  — профиль дня:          {"1": {start,end,capacity,specialSlots:[...]}}
//
// Раньше разбор был скопирован в пяти местах, и три копии (getItemsForWeekday в
// templates.js и slots.js) умели только массив: для нового формата они молча
// возвращали [], успевая перед этим удалить расписание дня. «Применить шаблон»
// стирало рабочий день и отвечало {success: true}.
//
// Здесь один разбор, понимающий оба формата, и проверка на записи, которые
// после перезаписи расписания остались бы без слота.

const { models, Op } = require('./db');

const ACTIVE_STATUSES = ['pending', 'confirmed', 'rescheduled'];

function parseMinutes(value) {
	const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
	return h * 60 + min;
}

function toTime(totalMinutes) {
	return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

// Разворачивает профиль дня в список слотов с шагом slotDuration
function generateSlotsFromWeekday(profile, template = {}) {
	if (!profile || !profile.start || !profile.end) return [];
	const startMin = parseMinutes(profile.start);
	const endMin = parseMinutes(profile.end);
	if (startMin === null || endMin === null || startMin >= endMin) return [];

	const duration = Number(template.slotDuration) > 0 ? Number(template.slotDuration) : 30;
	const defaultCapacity = Number.isFinite(Number(template.defaultCapacity)) ? Number(template.defaultCapacity) : 1;
	const baseCapacity = Number.isFinite(Number(profile.capacity)) ? Number(profile.capacity) : defaultCapacity;

	const slots = [];
	for (let time = startMin; time + duration <= endMin; time += duration) {
		slots.push({ start: toTime(time), end: toTime(time + duration), capacity: baseCapacity });
	}

	// Специальные интервалы переопределяют вместимость внутри своих границ
	if (Array.isArray(profile.specialSlots)) {
		for (const special of profile.specialSlots) {
			const sStart = parseMinutes(special?.start);
			const sEnd = parseMinutes(special?.end);
			if (sStart === null || sEnd === null) continue;
			for (const slot of slots) {
				const slotStartMin = parseMinutes(slot.start);
				const slotEndMin = parseMinutes(slot.end);
				if (slotStartMin >= sStart && slotEndMin <= sEnd) {
					// ?? вместо ||: вместимость 0 означает «слот закрыт»,
					// а не «значение не задано»
					slot.capacity = Number.isFinite(Number(special.capacity)) ? Number(special.capacity) : slot.capacity;
					if (special.type) slot.type = special.type;
				}
			}
		}
	}

	return slots;
}

/**
 * Возвращает слоты шаблона для дня недели (0=вс ... 6=сб).
 * Понимает оба формата weekdays и поддерживает воскресенье под ключом "7".
 */
function resolveWeekdayItems(weekdays, weekday, template = {}) {
	const map = weekdays || {};
	let entry = map[String(weekday)] ?? map[weekday];
	if (entry === undefined && Number(weekday) === 0) {
		entry = map['7'] ?? map[7];
	}
	if (!entry) return [];
	if (Array.isArray(entry)) return entry;
	if (typeof entry === 'object') return generateSlotsFromWeekday(entry, template);
	return [];
}

function weekdayOf(isoDate) {
	return new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`).getUTCDay();
}

function normalizeSlotKey(value) {
	return String(value || '').replace(/\s+/g, '');
}

/**
 * Ищет активные записи, для которых после перезаписи расписания не останется
 * слота. Раньше шаблон удалял Slot и Schedule, не глядя на записи: встреча
 * оставалась висеть на времени, которого больше нет в расписании.
 */
async function findOrphanedAppointments({ officeId, date, items, transaction = null }) {
	const isoDate = String(date).slice(0, 10);
	const appointments = await models.Appointment.findAll({
		where: {
			office_id: officeId,
			date: isoDate,
			status: { [Op.in]: ACTIVE_STATUSES },
		},
		transaction,
	});
	if (appointments.length === 0) return [];

	const survivingKeys = new Set();
	for (const item of items || []) {
		if (Number(item?.capacity ?? 1) <= 0) continue;
		survivingKeys.add(normalizeSlotKey(`${item.start}-${item.end}`));
		survivingKeys.add(normalizeSlotKey(item.start));
	}

	return appointments
		.filter((a) => !survivingKeys.has(normalizeSlotKey(a.timeSlot)))
		.map((a) => ({
			id: a.id,
			date: a.date,
			timeSlot: a.timeSlot,
			status: a.status,
			bitrix_lead_id: a.bitrix_lead_id ? String(a.bitrix_lead_id) : null,
		}));
}

module.exports = {
	ACTIVE_STATUSES,
	generateSlotsFromWeekday,
	resolveWeekdayItems,
	findOrphanedAppointments,
	weekdayOf,
	parseMinutes,
	toTime,
};
