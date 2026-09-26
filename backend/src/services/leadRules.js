// Что стадия лида Битрикса значит для встречи шахматки.
//
// Правила раньше жили копиями в трёх местах (синхронизация статусов, возврат
// неявок, заведение встреч из CRM) и расходились. Теперь их читают все пути,
// которые меняют встречу по данным Битрикса: пятиминутный опрос, события
// Битрикса и суточная сверка. Модуль чистый — без БД и сети, поэтому правила
// проверяются тестами напрямую.

const { parseBusinessDateTime, slotStart, slotEnd, businessToday } = require('../lib/time');

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

function appointmentStart(appointment) {
	const start = slotStart(String(appointment.timeSlot || ''));
	return /^\d{1,2}:\d{2}$/.test(start) ? parseBusinessDateTime(appointment.date, start) : null;
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
	const start = appointmentStart(appointment);
	const end = appointmentEnd(appointment);
	const started = start ? start.getTime() <= now : false;
	const finished = end ? end.getTime() <= now : false;
	const pastDue = end ? end.getTime() < now - PAST_DUE_MS : false;

	if (ACTIVE.has(appointment.status)) {
		if (mapped) {
			// «Не пришёл» у лида при встрече, которая ещё не началась, —
			// хвост прошлой встречи, а не эта неявка.
			if (mapped === 'no_show' && !started) return null;
			if (mapped !== appointment.status) return { status: mapped, action: `sync_${mapped}` };
			if (pastDue) return { status: 'no_show', action: 'sync_no_show' };
			return null;
		}
		// Лид ушёл со стадий встречи. До начала встречи это отказ или перенос
		// (перезвонить, не актуально…) — встреча не состоится. После начала —
		// неявка: агент Битрикса ставит «Не пришел» через 5 минут после начала,
		// а роботы в ту же секунду уводят лид дальше (НДЗ 1, Перезвонить), и
		// опрос раз в 5 минут стадию 3 почти не застаёт. Раньше граница стояла
		// на конце встречи, и за 26.08–25.09 так «отменёнными» оказались бы
		// 744 из 1 740 неявок.
		if (started) return { status: 'no_show', action: 'sync_no_show' };
		return { status: 'cancelled', action: 'sync_cancelled' };
	}

	if (appointment.status === 'no_show') {
		// Опоздавший клиент: агент Битрикса поставил «не пришёл», потом клиента
		// всё-таки приняли в тот же день — это приход. Только для сегодняшней
		// встречи: стадия лида говорит о «сейчас», а не о дне прошлой встречи.
		// Клиент, не пришедший вчера и принятый сегодня по новой записи, делал
		// вчерашнюю неявку «пришёл» (70 неявок за месяц в окне 3 дней). Приход в
		// прошлые дни решает сверка по сделке «Офис» в день встречи.
		if (mapped === 'completed') {
			return appointment.date === businessToday(new Date(now)) ? { status: 'completed', action: 'restored_completed' } : null;
		}
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
	appointmentStart,
	appointmentEnd,
};
