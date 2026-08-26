// Единственное место, где проверяется «можно ли записать в этот слот».
//
// Раньше проверки не было нигде на сервере: POST /appointments сразу делал
// Appointment.create(), а ограничения (рабочий день, существование слота,
// свободные места, горизонт записи, дата не в прошлом) жили только в React.
// Прямой запрос мимо интерфейса создавал запись на любое время в любом объёме.
//
// Все три канала записи — публичный POST/PUT, админский PUT и синхронизация
// из Bitrix — обязаны ходить сюда.

const { models, Op } = require('../lib/db');
const { businessNowParts, parseBusinessDateTime, slotStart, slotEnd } = require('../lib/time');

const ACTIVE_STATUSES = ['pending', 'confirmed', 'rescheduled'];
const DEFAULT_MAX_BOOKING_DAYS = 7;

class BookingError extends Error {
	constructor(reason, message, status = 400) {
		super(message);
		this.name = 'BookingError';
		this.reason = reason;
		this.status = status;
	}
}

async function getMaxBookingDays() {
	try {
		const setting = await models.Setting.findOne({ where: { key: 'max_booking_days' } });
		const raw = setting ? setting.value : null;
		const n = Number(raw);
		// Значение хранится в JSON-колонке и может прийти числом или строкой
		return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BOOKING_DAYS;
	} catch {
		return DEFAULT_MAX_BOOKING_DAYS;
	}
}

function normalizeTimeSlot(value) {
	return String(value || '').replace(/\s+/g, '');
}

// Сколько активных записей уже занимает этот слот. Учитываются оба формата
// timeSlot — полный "HH:MM-HH:MM" и исторический короткий "HH:MM".
async function countActiveAppointments({ officeId, date, timeSlot, excludeAppointmentId, transaction }) {
	const full = normalizeTimeSlot(timeSlot);
	const start = slotStart(full);
	const where = {
		office_id: officeId,
		date,
		status: { [Op.in]: ACTIVE_STATUSES },
		timeSlot: { [Op.in]: [full, start] },
	};
	if (excludeAppointmentId) where.id = { [Op.ne]: excludeAppointmentId };
	return models.Appointment.count({ where, transaction });
}

/**
 * Проверяет, что в слот можно записаться, и возвращает найденный слот.
 * Бросает BookingError с понятным reason, если нельзя.
 *
 * Вызывается внутри транзакции: строка слота блокируется (lock: UPDATE),
 * поэтому два одновременных бронирования не прочитают одну и ту же занятость.
 */
async function assertSlotBookable({
	officeId,
	date,
	timeSlot,
	excludeAppointmentId = null,
	transaction = null,
	allowPast = false,
	enforceHorizon = true,
}) {
	const isoDate = String(date || '').slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
		throw new BookingError('invalid_date', 'Некорректная дата встречи');
	}

	const full = normalizeTimeSlot(timeSlot);
	const start = slotStart(full);
	const end = slotEnd(full);
	if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
		throw new BookingError('invalid_time_slot', 'Некорректный интервал встречи');
	}

	// Дата и время сравниваются в бизнес-зоне, а не в зоне процесса.
	if (!allowPast) {
		const startsAt = parseBusinessDateTime(isoDate, start);
		if (!startsAt) throw new BookingError('invalid_time_slot', 'Не удалось разобрать время встречи');
		if (startsAt.getTime() <= Date.now()) {
			throw new BookingError('slot_in_past', 'Нельзя записать на прошедшее время');
		}
	}

	if (enforceHorizon) {
		const maxDays = await getMaxBookingDays();
		const today = businessNowParts().date;
		const horizon = new Date(`${today}T00:00:00Z`);
		horizon.setUTCDate(horizon.getUTCDate() + maxDays);
		const horizonIso = horizon.toISOString().slice(0, 10);
		if (isoDate > horizonIso) {
			throw new BookingError('beyond_horizon', `Запись доступна не более чем на ${maxDays} дней вперёд`);
		}
	}

	const schedule = await models.Schedule.findOne({
		where: { office_id: officeId, date: isoDate },
		transaction,
	});
	if (!schedule) {
		throw new BookingError('no_schedule', 'На эту дату расписание не задано');
	}
	if (schedule.isWorkingDay === false) {
		throw new BookingError('day_closed', 'Этот день в офисе нерабочий');
	}

	const slot = await models.Slot.findOne({
		where: { schedule_id: schedule.id, start, end },
		transaction,
		...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
	});
	if (!slot) {
		throw new BookingError('no_slot', 'Такого слота нет в расписании');
	}
	if (slot.available === false) {
		throw new BookingError('slot_unavailable', 'Слот закрыт для записи');
	}

	const capacity = Number.isFinite(Number(slot.capacity)) ? Number(slot.capacity) : 0;
	if (capacity <= 0) {
		throw new BookingError('slot_unavailable', 'Слот закрыт для записи');
	}

	const used = await countActiveAppointments({
		officeId,
		date: isoDate,
		timeSlot: full,
		excludeAppointmentId,
		transaction,
	});
	if (used >= capacity) {
		throw new BookingError('slot_full', 'В этом слоте нет свободных мест');
	}

	return { schedule, slot, capacity, used, free: capacity - used };
}

module.exports = {
	BookingError,
	assertSlotBookable,
	countActiveAppointments,
	getMaxBookingDays,
	ACTIVE_STATUSES,
};
