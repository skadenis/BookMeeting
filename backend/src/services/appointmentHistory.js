// Журнал изменений встреч.
//
// Модель AppointmentHistory была объявлена в lib/db.js и связана с Appointment,
// но во всём бэкенде не было ни одного вызова create() — таблица создавалась
// пустой. Восстановить, кто отменил встречу или перенёс её, было невозможно.
//
// Колонка changed_by объявлена как BIGINT, а идентификатор администратора —
// UUID, поэтому в неё пишется числовой Bitrix user_id (или 0), а полная
// личность автора кладётся в new_value.actor. Это позволяет вести журнал без
// изменения схемы уже работающей базы.

const { models } = require('../lib/db');

function actorFromRequest(req) {
	if (req && req.admin) {
		return { type: 'admin', id: req.admin.id || null, email: req.admin.email || null, role: req.admin.role || null };
	}
	if (req && req.bitrix) {
		return { type: 'operator', id: req.bitrix.userId || 0, domain: req.bitrix.domain || null, auth: req.bitrix.authMethod || null };
	}
	return { type: 'system', id: null };
}

function numericActorId(actor) {
	const n = Number(actor && actor.id);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Пишет запись в журнал. Никогда не бросает исключение: сбой журналирования
 * не должен отменять уже выполненную бизнес-операцию — он только логируется.
 */
async function recordAppointmentChange({ appointmentId, action, oldValue = null, newValue = null, req = null, actor = null, transaction = null }) {
	if (!appointmentId || !action) return null;
	const who = actor || actorFromRequest(req);
	try {
		return await models.AppointmentHistory.create({
			appointment_id: appointmentId,
			action: String(action).slice(0, 40),
			oldValue,
			newValue: newValue === null ? { actor: who } : { ...newValue, actor: who },
			changedBy: numericActorId(who),
		}, { transaction });
	} catch (e) {
		console.error('appointmentHistory: не удалось записать событие', action, appointmentId, e?.message || e);
		return null;
	}
}

// Снимок полей, за которыми имеет смысл следить
function snapshot(appointment) {
	if (!appointment) return null;
	return {
		status: appointment.status,
		date: appointment.date,
		timeSlot: appointment.timeSlot,
		office_id: appointment.office_id,
	};
}

module.exports = { recordAppointmentChange, snapshot, actorFromRequest };
