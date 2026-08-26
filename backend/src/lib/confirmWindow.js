// Правило «когда встречу можно подтвердить» — один источник правды.
//
// Фронтенд повторяет эту же логику в frontend/src/modules/confirmWindow.js.
// При изменении правила править нужно оба файла: раньше они расходились
// (фронт запрещал подтверждение после начала встречи, бэкенд разрешал его
// без ограничения снизу), из-за чего кнопка и сервер противоречили друг другу.

const { parseBusinessDateTime, slotStart, slotEnd } = require('./time');

const CONFIRM_WINDOW_HOURS = 24;

// Окно открыто с (начало − 24ч) и до конца встречи. Верхняя граница — само
// правило, нижняя совпадает с моментом, когда карточка встречи перестаёт
// показываться оператору, поэтому «видно карточку» и «работает кнопка»
// больше не противоречат друг другу.
function evaluateConfirmWindow(appointment, now = new Date()) {
	const start = parseBusinessDateTime(appointment?.date, slotStart(appointment?.timeSlot));
	const end = parseBusinessDateTime(appointment?.date, slotEnd(appointment?.timeSlot)) || start;

	if (!start) {
		return { allowed: false, reason: 'invalid_time', hoursUntil: null, opensAt: null };
	}

	const opensAt = new Date(start.getTime() - CONFIRM_WINDOW_HOURS * 3600 * 1000);
	const hoursUntil = (start.getTime() - now.getTime()) / 3600000;

	if (now.getTime() < opensAt.getTime()) {
		return { allowed: false, reason: 'too_early', hoursUntil, opensAt };
	}
	if (end && now.getTime() >= end.getTime()) {
		return { allowed: false, reason: 'finished', hoursUntil, opensAt };
	}
	return { allowed: true, reason: 'ok', hoursUntil, opensAt };
}

module.exports = { CONFIRM_WINDOW_HOURS, evaluateConfirmWindow };
