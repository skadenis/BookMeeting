// Что стадия лида Битрикса значит для встречи шахматки.
//
// Правила раньше жили копиями в трёх местах (синхронизация статусов, возврат
// неявок, заведение встреч из CRM) и расходились. Теперь их читают все пути,
// которые меняют встречу по данным Битрикса: пятиминутный опрос, события
// Битрикса и суточная сверка. Модуль чистый — без БД и сети, поэтому правила
// проверяются тестами напрямую.

const { parseBusinessDateTime, slotStart, slotEnd } = require('../lib/time');

// Статусы лида Битрикса → статусы встречи. Справочник: crm.status.list ENTITY_ID=STATUS.
// Раньше стояли '38' → completed, '39' → no_show, '40' → cancelled: стадий 38 и
// 39 на портале нет, а 40 — «Не наши услуги». Настоящие «Не пришел на встречу»
// (3) и «Находится в офисе» (4) превращались в «отменена».
const BITRIX_STATUS_MAPPING = {
	'2': 'pending',          // Встреча назначена
	'37': 'confirmed',       // Встреча подтверждена
	'3': 'no_show',          // Не пришел на встречу (агент Битрикса через 5 мин после начала)
	'4': 'completed',        // Находится в офисе
	'CONVERTED': 'completed', // Обработка лида завершена (сделка «Офис» заведена)
};

// Стадии встречи: лид в них — встреча ещё предстоит
const MEETING_STAGES = new Set(['2', '37']);

// Транзитные стадии, через которые лид проходит по вине самой шахматки
// (ensureLeadStage: 2 → IN_PROCESS → 2/37). Значат «ещё не доехало».
const BITRIX_TRANSIENT_STATUSES = new Set(['IN_PROCESS']);

const ACTIVE = new Set(['pending', 'confirmed', 'rescheduled']);
const PAST_DUE_MS = 2 * 3600 * 1000;

function mapLeadStatus(bitrixStatus) {
	return BITRIX_STATUS_MAPPING[String(bitrixStatus)] || null;
}

function appointmentEnd(appointment) {
	const slot = String(appointment.timeSlot || '');
	const end = slot.includes('-') ? slotEnd(slot) : '23:59';
	return parseBusinessDateTime(appointment.date, end);
}

/**
 * Решение по одной встрече при известной стадии лида.
 * Возвращает { status, action } или null — «ничего не менять».
 */
function decideFromLeadStatus(appointment, bitrixStatus, now = Date.now()) {
	if (bitrixStatus === undefined || bitrixStatus === null || bitrixStatus === '') return null;
	const stage = String(bitrixStatus);
	if (BITRIX_TRANSIENT_STATUSES.has(stage)) return null;

	const mapped = mapLeadStatus(stage);
	const end = appointmentEnd(appointment);
	const finished = end ? end.getTime() <= now : false;
	const pastDue = end ? end.getTime() < now - PAST_DUE_MS : false;

	if (ACTIVE.has(appointment.status)) {
		if (mapped) {
			if (mapped !== appointment.status) return { status: mapped, action: `sync_${mapped}` };
			if (pastDue) return { status: 'no_show', action: 'sync_no_show' };
			return null;
		}
		// Лид ушёл со стадий встречи. До конца встречи это отказ (брак,
		// перезвонить…) — встреча не состоится. После конца — лид уже уехал
		// дальше по роботам (неявка → прогрев), а визита не было: это неявка,
		// а не отмена. Раньше такие встречи становились «отменена».
		if (finished) return { status: 'no_show', action: 'sync_no_show' };
		return { status: 'cancelled', action: 'sync_cancelled' };
	}

	if (appointment.status === 'no_show') {
		// Опоздавший клиент: агент Битрикса поставил «не пришёл», потом клиента
		// всё-таки приняли — это приход.
		if (mapped === 'completed') return { status: 'completed', action: 'restored_completed' };
		// Встреча ещё не прошла, а её пометили неявкой — вернуть в активные.
		if ((mapped === 'pending' || mapped === 'confirmed') && !finished) {
			return { status: mapped, action: `restored_${mapped}` };
		}
		return null;
	}

	// cancelled и completed по стадии лида не трогаем: отмену оператора
	// отменяет только факт визита (сделка «Офис» в день встречи), см. reconcile.
	return null;
}

// Слот «15:00-15:30» покрывает время «15:05». Короткий формат — только точное совпадение.
function toMinutes(hhmm) {
	const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function slotCovers(timeSlot, hhmm) {
	const t = toMinutes(hhmm);
	const s = toMinutes(slotStart(timeSlot));
	if (t === null || s === null) return false;
	if (!String(timeSlot).includes('-')) return s === t;
	const e = toMinutes(slotEnd(timeSlot));
	return e !== null && s <= t && t < e;
}

// Дата и время встречи из полей лида. null — встречи в лиде нет.
function leadMeeting(lead) {
	if (!lead) return null;
	const raw = String(lead.UF_CRM_1655460588 || '');
	let date = null;
	const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
	const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
	if (iso) date = iso[1];
	else if (ru) date = `${ru[3]}-${ru[2]}-${ru[1]}`;
	const time = slotStart(String(lead.UF_CRM_1657019494 || '').replace(/\s+/g, ''));
	if (!date || !/^\d{1,2}:\d{2}$/.test(time)) return null;
	return { date, time: time.padStart(5, '0'), officeRef: lead.UF_CRM_1675255265 || null };
}

module.exports = {
	BITRIX_STATUS_MAPPING,
	BITRIX_TRANSIENT_STATUSES,
	MEETING_STAGES,
	mapLeadStatus,
	decideFromLeadStatus,
	slotCovers,
	leadMeeting,
	appointmentEnd,
};
