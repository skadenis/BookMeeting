// Защита свежих локальных решений оператора от перезаписи фоновой синхронизацией.
//
// Подтверждение встречи отвечает оператору 200 сразу, а лид в Bitrix обновляется
// отложенно и в два шага (сначала IN_PROCESS, потом стадия 37). Синхронизация
// статусов бегает раз в 5 минут и раньше могла попасть ровно в это окно: она
// видела в Bitrix ещё старую стадию и откатывала локальный confirmed обратно в
// pending, а промежуточный IN_PROCESS вообще превращала в cancelled — встреча
// пропадала из виджета. Пока стоит эта метка, синхронизация встречу не трогает.

const { redis } = require('../lib/redis');

const GRACE_SECONDS = Number(process.env.LOCAL_STATUS_GRACE_SECONDS || 900);
const keyFor = (id) => `appt:local-status:${id}`;

async function markLocalStatusChange(appointmentId, status) {
	if (!appointmentId) return;
	try {
		await redis.set(keyFor(appointmentId), String(status || ''), 'EX', GRACE_SECONDS);
	} catch (e) {
		// Redis недоступен — подтверждение всё равно должно пройти
		console.error('localStatusGuard: не удалось поставить метку', appointmentId, e?.message || e);
	}
}

// Снимается, когда Bitrix подтвердил приём статуса: дальше расхождения нет и
// синхронизация снова может считаться источником правды.
async function clearLocalStatusChange(appointmentId) {
	if (!appointmentId) return;
	try {
		await redis.del(keyFor(appointmentId));
	} catch (e) {
		console.error('localStatusGuard: не удалось снять метку', appointmentId, e?.message || e);
	}
}

async function hasRecentLocalStatusChange(appointmentId) {
	if (!appointmentId) return false;
	try {
		return (await redis.get(keyFor(appointmentId))) !== null;
	} catch (e) {
		// При недоступном Redis не блокируем синхронизацию целиком
		console.error('localStatusGuard: не удалось прочитать метку', appointmentId, e?.message || e);
		return false;
	}
}

module.exports = { markLocalStatusChange, clearLocalStatusChange, hasRecentLocalStatusChange, GRACE_SECONDS };
