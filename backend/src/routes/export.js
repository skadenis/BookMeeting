// Выгрузка встреч для платформы (api.centr-cred.by, модуль booking).
//
// Только чтение и только идентификаторы: ни ФИО, ни телефонов в базе шахматки
// нет, наружу уходит номер лида, офис (по ID Битрикса), дата, слот, статус,
// кто записал и чем закончилась встреча. Доступ — по отдельному ключу
// EXPORT_TOKEN (Authorization: Bearer …); без ключа выгрузка выключена.

const crypto = require('crypto');
const { Router } = require('express');
const { models, Op } = require('../lib/db');

const router = Router();
const MAX_DAYS = 93;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function tokenMatches(header) {
	const expected = String(process.env.EXPORT_TOKEN || '');
	const got = String(header || '').startsWith('Bearer ') ? String(header).slice(7).trim() : '';
	if (!expected || !got) return false;
	const a = crypto.createHash('sha256').update(expected).digest();
	const b = crypto.createHash('sha256').update(got).digest();
	return crypto.timingSafeEqual(a, b);
}

// Кто закрыл встречу: оператор в виджете, перезапись другим слотом или фоновая
// синхронизация по стадии лида. Записи до 25.09.2026 фоновых событий в журнале
// не имеют — для них закрывающее событие неизвестно (null).
const CLOSING = {
	status_cancelled: 'operator',
	cancelled_by_rebooking: 'rebooking',
	sync_cancelled: 'bitrix_status',
	sync_no_show: 'bitrix_status',
	sync_completed: 'bitrix_status',
	expired_no_show: 'auto_expire',
	restored_completed: 'bitrix_status',
};

function summarizeHistory(events) {
	const sorted = [...(events || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
	const created = sorted.find((e) => e.action === 'created' || String(e.action).startsWith('created_from_crm'));
	let closedBy = null;
	let closedAt = null;
	let bitrixStatus = null;
	for (const e of sorted) {
		if (CLOSING[e.action]) {
			closedBy = CLOSING[e.action];
			closedAt = new Date(e.createdAt).toISOString();
			bitrixStatus = e.newValue?.bitrixStatus ?? null;
		}
	}
	return {
		source: created ? (created.action === 'created' ? 'widget' : 'crm') : null,
		overbooked: Boolean(created && created.action === 'created_from_crm_overbooked'),
		closedBy,
		closedAt,
		closingBitrixStatus: bitrixStatus,
	};
}

function daysBetween(from, to) {
	return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
}

router.get('/appointments', async (req, res, next) => {
	try {
		if (!process.env.EXPORT_TOKEN) return res.status(404).json({ error: 'Not found' });
		if (!tokenMatches(req.header('Authorization'))) return res.status(401).json({ error: 'Unauthorized' });

		const from = String(req.query.from || '');
		const to = String(req.query.to || '');
		if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
			return res.status(400).json({ error: 'from и to — даты YYYY-MM-DD, from ≤ to' });
		}
		if (daysBetween(from, to) > MAX_DAYS) {
			return res.status(400).json({ error: `Окно не больше ${MAX_DAYS} дней` });
		}

		const offices = await models.Office.findAll({ attributes: ['id', 'city', 'bitrixOfficeId'] });
		const officeById = new Map(offices.map((o) => [String(o.id), o]));

		const appointments = await models.Appointment.findAll({
			where: { date: { [Op.between]: [from, to] }, bitrix_lead_id: { [Op.not]: null } },
			order: [['date', 'ASC'], ['timeSlot', 'ASC']],
		});
		const ids = appointments.map((a) => a.id);
		const history = ids.length
			? await models.AppointmentHistory.findAll({
				where: { appointment_id: { [Op.in]: ids } },
				attributes: ['appointment_id', 'action', 'newValue', 'createdAt'],
			})
			: [];
		const historyById = new Map();
		for (const h of history) {
			const key = String(h.appointment_id);
			if (!historyById.has(key)) historyById.set(key, []);
			historyById.get(key).push(h);
		}

		const schedules = await models.Schedule.findAll({
			where: { date: { [Op.between]: [from, to] } },
			include: [{ model: models.Slot, attributes: ['capacity', 'available'] }],
		});

		res.json({
			data: {
				appointments: appointments.map((a) => {
					const office = officeById.get(String(a.office_id));
					return {
						id: a.id,
						leadId: Number(a.bitrix_lead_id),
						officeBitrixId: office?.bitrixOfficeId ? Number(office.bitrixOfficeId) : null,
						officeCity: office?.city || null,
						date: a.date,
						timeSlot: a.timeSlot,
						status: a.status,
						bookedBy: Number(a.createdBy) || null,
						createdAt: new Date(a.createdAt).toISOString(),
						...summarizeHistory(historyById.get(String(a.id))),
					};
				}),
				capacity: schedules.map((s) => {
					const office = officeById.get(String(s.office_id));
					const open = (s.Slots || []).filter((x) => x.available !== false);
					return {
						officeBitrixId: office?.bitrixOfficeId ? Number(office.bitrixOfficeId) : null,
						date: s.date,
						workingDay: s.isWorkingDay !== false,
						slots: open.length,
						capacity: s.isWorkingDay === false ? 0 : open.reduce((n, x) => n + Math.max(0, Number(x.capacity) || 0), 0),
					};
				}),
			},
		});
	} catch (e) { next(e); }
});

module.exports = router;
module.exports.summarizeHistory = summarizeHistory;
module.exports.tokenMatches = tokenMatches;
