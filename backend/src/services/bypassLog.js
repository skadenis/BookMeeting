// Учёт назначений встречи мимо сетки.
//
// За 26.08–24.09 так назначено 668 встреч из ~3 900 (17 %): лид ставится в
// «Встреча назначена» прямо в карточке Битрикса. Шахматка узнавала об этом
// через пять минут и только писала строку в лог (33 815 строк «пропускаю лид»
// за три недели — по одной на каждый прогон). Теперь каждое такое назначение
// записывается один раз: кто поставил, на когда, чем кончилось в сетке.
// По этой таблице видно, где сетка не устраивает операторов.

const { models } = require('../lib/db');
const { callBitrix } = require('../lib/bitrix');

const FLAG_TEXT = {
	overbooked: 'слот уже заполнен',
	no_slot: 'такого времени нет в сетке',
	no_schedule: 'на эту дату в сетке нет расписания',
	day_closed: 'в этот день офис закрыт в сетке',
	slot_unavailable: 'слот закрыт для записи',
	no_office: 'офис лида не найден в шахматке',
};

/**
 * Записать назначение мимо сетки. Один раз на лид + дату + время + исход.
 * Никогда не бросает: учёт не должен ломать синхронизацию.
 */
async function recordBypass({ leadId, officeRef = null, date = null, time = null, outcome, bitrixStatus = null, bitrixUserId = null, source, appointmentId = null }) {
	if (!leadId || !outcome || !models.CrmBypass) return null;
	try {
		const where = { leadId: Number(leadId), meetingDate: date, meetingTime: time, outcome };
		const [row, created] = await models.CrmBypass.findOrCreate({
			where,
			defaults: {
				...where,
				officeRef: officeRef === null ? null : String(officeRef),
				bitrixStatus: bitrixStatus === null ? null : String(bitrixStatus),
				bitrixUserId: Number(bitrixUserId) > 0 ? Number(bitrixUserId) : null,
				source,
				appointmentId,
			},
		});
		if (created && FLAG_TEXT[outcome]) await maybeFlagInCrm(row);
		return row;
	} catch (e) {
		console.error('bypassLog: не удалось записать назначение мимо сетки', leadId, outcome, e?.message || e);
		return null;
	}
}

// Сообщить оператору в карточке лида, что встреча не легла в сетку.
// Выключено по умолчанию (BYPASS_FLAG_MODE=comment включает): это запись в
// CRM, и включать её — решение владельца вместе со стороной Битрикса.
async function maybeFlagInCrm(row) {
	if (process.env.BYPASS_FLAG_MODE !== 'comment') return;
	const when = [row.meetingDate, row.meetingTime].filter(Boolean).join(' ');
	const comment = `Шахматка: встреча ${when} назначена мимо сетки — ${FLAG_TEXT[row.outcome]}. `
		+ 'Проверьте время во вкладке «Слоты - Офис» и при необходимости выберите свободный слот.';
	try {
		await callBitrix('crm.timeline.comment.add', {
			fields: { ENTITY_ID: Number(row.leadId), ENTITY_TYPE: 'lead', COMMENT: comment },
		}, { attempts: 2 });
		await row.update({ flaggedAt: new Date() });
	} catch (e) {
		console.error('bypassLog: не удалось оставить комментарий в лиде', row.leadId, e?.message || e);
	}
}

module.exports = { recordBypass, FLAG_TEXT };
