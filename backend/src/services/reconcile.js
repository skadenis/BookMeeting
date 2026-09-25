// Шахматка по событиям Битрикса и суточная сверка.
//
// Владелец 25.09: «Если Битрикс шлёт в шахматку данные, шахматка должна ВСЕГДА
// знать, когда клиент пришёл и когда не пришёл». Раньше она только опрашивала
// Битрикс раз в 5–30 минут и только по сегодняшним встречам; то, что случилось
// между прогонами или за прошлые дни, терялось навсегда (1 351 неявка и 141
// пришедший за месяц остались «отменёнными»).
//
// Теперь три пути ведут к одним правилам (leadRules):
//   1. applyLeadState / applyOfficeDeal — по событиям Битрикса (пачками, bitrixEvents.js);
//   2. прежний опрос (syncTasks) — страховка, если событие потерялось;
//   3. reconcileRecentAppointments — раз в сутки сверяет последние 7 дней и
//      отчитывается о каждом расхождении.
// Все пути читают текущее состояние Битрикса, а не содержимое события, поэтому
// повтор события или его дубль ничего не ломают.

const { models, Op } = require('../lib/db');
const { callBitrix } = require('../lib/bitrix');
const { redis } = require('../lib/redis');
const { businessToday } = require('../lib/time');
const { hasRecentLocalStatusChange } = require('./localStatusGuard');
const { MEETING_STAGES, mapLeadStatus, decideFromLeadStatus, leadMeeting, appointmentEnd } = require('./leadRules');
const {
	applyDecision,
	createAppointmentFromLead,
	updateAppointmentFromLead,
	fetchLeadStatuses,
} = require('./syncTasks');

const ACTIVE = ['pending', 'confirmed', 'rescheduled'];
const OFFICE_DEAL_CATEGORY = String(process.env.BITRIX_OFFICE_DEAL_CATEGORY || '0');
const LAST_REPORT_KEY = 'reconcile:last';
const RETRY_DELAY_MS = () => Number(process.env.BITRIX_RETRY_DELAY_MS ?? 1000);

function addDays(iso, n) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

// Дата сделки по Минску: DATE_CREATE приходит с зоной («2026-09-24T18:30:00+03:00»)
function businessDateOf(value) {
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : businessToday(d);
}

/**
 * Лид изменился в Битриксе: привести его встречи к текущему состоянию лида.
 * lead — строка crm.lead.get / crm.lead.list (STATUS_ID, поля встречи, MODIFY_BY_ID).
 */
async function applyLeadState(lead, { source = 'bitrix_event', event = null } = {}) {
	const id = Number(lead?.ID);
	if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: 'bad_id' };
	const stage = String(lead.STATUS_ID || '');
	const bitrixUserId = Number(lead.MODIFY_BY_ID) || null;
	const trace = { source, bitrixStatus: stage, bitrixUserId, ...(event ? { event } : {}) };
	const result = { ok: true, leadId: id, stage, created: 0, updated: 0, statusChanged: 0 };
	const today = businessToday();

	// 1. Лид на стадии встречи — встреча должна быть в сетке (в том числе
	// назначенная или перенесённая в карточке мимо шахматки).
	if (MEETING_STAGES.has(stage)) {
		const meeting = leadMeeting(lead);
		if (meeting && meeting.date >= today) {
			const row = {
				bitrix_lead_id: String(lead.ID),
				office_id: meeting.officeRef,
				date: meeting.date,
				timeSlot: meeting.time,
				status: mapLeadStatus(stage),
				STATUS_ID: stage,
			};
			const active = await models.Appointment.findAll({
				where: { bitrix_lead_id: id, status: { [Op.in]: ACTIVE }, date: { [Op.gte]: today } },
				order: [['date', 'ASC'], ['createdAt', 'ASC']],
			});
			if (active.length === 0) {
				const r = await createAppointmentFromLead(row, trace);
				if (r.created) result.created++;
				result.createResult = r.created ? (r.overbooked ? 'overbooked' : 'created') : (r.skipped || (r.invalidOffice ? 'no_office' : 'exists'));
			} else if (await updateAppointmentFromLead(active[active.length - 1], row, trace)) {
				result.updated++;
			}
		}
	}

	// 2. Статус встреч лида по стадии: сегодняшние и будущие активные, а также
	// неявки последней недели (опоздавший клиент).
	const appointments = await models.Appointment.findAll({
		where: {
			bitrix_lead_id: id,
			date: { [Op.gte]: addDays(today, -7) },
			status: { [Op.in]: [...ACTIVE, 'no_show'] },
		},
	});
	for (const appointment of appointments) {
		// Прошлые дни с активным статусом решает сверка по факту визита,
		// а не текущая стадия лида, которая могла уйти далеко вперёд.
		if (ACTIVE.includes(appointment.status) && appointment.date < today) continue;
		if (await hasRecentLocalStatusChange(appointment.id)) continue;
		const decision = decideFromLeadStatus(appointment, stage);
		if (decision && await applyDecision(appointment, decision, trace)) result.statusChanged++;
	}
	return result;
}

/**
 * Клиент пришёл: специалист завёл сделку «Офис» по лиду. Встреча лида в этот
 * день — «пришёл», даже если её до того отменили или пометили неявкой.
 */
async function markVisit(leadId, visitDate, trace, { dryRun = false } = {}) {
	const candidates = await models.Appointment.findAll({
		where: { bitrix_lead_id: Number(leadId), date: visitDate },
		order: [['createdAt', 'DESC']],
	});
	if (candidates.length === 0) return { visitWithoutBooking: true };
	if (candidates.some((a) => a.status === 'completed')) return { alreadyCompleted: true };
	// Из нескольких записей дня (перезапись, дубль из CRM) закрываем одну:
	// сначала живую или неявку, затем отменённую; внутри — последнюю созданную.
	const rank = (a) => (ACTIVE.includes(a.status) ? 0 : a.status === 'no_show' ? 1 : 2);
	const pick = candidates.slice().sort((a, b) => rank(a) - rank(b))[0];
	const change = { appointmentId: pick.id, leadId: Number(leadId), date: visitDate, from: pick.status, to: 'completed' };
	if (!dryRun) {
		const action = pick.status === 'cancelled' ? 'visit_after_cancel' : 'visit_completed';
		await applyDecision(pick, { status: 'completed', action }, trace);
	}
	return { changed: true, change };
}

/**
 * Заведена сделка «Офис» — клиент пришёл. deal — строка crm.deal.list
 * (ID, LEAD_ID, CONTACT_ID, DATE_CREATE, CATEGORY_ID). Без LEAD_ID встреча
 * ищется по контакту, если он записан во встрече.
 */
async function applyOfficeDeal(deal, { source = 'bitrix_event', event = null } = {}) {
	const id = Number(deal?.ID);
	if (deal?.CATEGORY_ID !== undefined && String(deal.CATEGORY_ID) !== OFFICE_DEAL_CATEGORY) return { ok: true, ignored: true };
	const visitDate = businessDateOf(deal?.DATE_CREATE);
	if (!visitDate) return { ok: false, reason: 'bad_date' };
	let leadId = Number(deal.LEAD_ID) || null;
	if (!leadId && Number(deal.CONTACT_ID)) {
		const byContact = await models.Appointment.findOne({ where: { bitrix_contact_id: Number(deal.CONTACT_ID), date: visitDate, bitrix_lead_id: { [Op.not]: null } } });
		leadId = byContact ? Number(byContact.bitrix_lead_id) : null;
	}
	if (!leadId) return { ok: true, ignored: true, reason: 'no_lead' };
	const trace = { source, bitrixDealId: id, ...(event ? { event } : {}) };
	const r = await markVisit(leadId, visitDate, trace);
	if (r.visitWithoutBooking) {
		console.log(`VISIT_WITHOUT_BOOKING lead=${leadId} deal=${id} date=${visitDate}: клиент пришёл без записи в шахматке`);
	}
	return { ok: true, leadId, date: visitDate, ...r };
}

// Сделки «Офис» с даты from (по Минску) постранично: Map(leadId → Set(дата визита))
async function fetchOfficeVisits(fromIso) {
	const visits = new Map();
	let start = 0;
	for (let page = 0; page < 200; page++) {
		const data = await callBitrix('crm.deal.list', {
			filter: { CATEGORY_ID: Number(OFFICE_DEAL_CATEGORY), '>=DATE_CREATE': `${fromIso}T00:00:00+03:00` },
			select: ['ID', 'LEAD_ID', 'DATE_CREATE'],
			order: { ID: 'ASC' },
			start,
		}, { attempts: 3, retryDelayMs: RETRY_DELAY_MS() });
		for (const deal of data?.result || []) {
			const leadId = Number(deal.LEAD_ID);
			const date = businessDateOf(deal.DATE_CREATE);
			if (!leadId || !date) continue;
			if (!visits.has(leadId)) visits.set(leadId, new Set());
			visits.get(leadId).add(date);
		}
		if (data?.next === undefined || data?.next === null) break;
		start = data.next;
	}
	return visits;
}

/**
 * Сверка последних daysBack дней: находит и исправляет расхождения шахматки с
 * Битриксом, возвращает отчёт. dryRun — только отчёт, без записи.
 */
async function reconcileRecentAppointments({ daysBack = 7, dryRun = false, now = Date.now() } = {}) {
	const startedAt = new Date().toISOString();
	const today = businessToday(new Date(now));
	const from = addDays(today, -Math.max(0, Number(daysBack) || 7));
	const report = { startedAt, from, to: today, dryRun: !!dryRun, checked: 0, visits: 0, changes: 0, byReason: {}, samples: [], notes: {} };
	const note = (k) => { report.notes[k] = (report.notes[k] || 0) + 1; };
	const push = (reason, change) => {
		report.changes++;
		report.byReason[reason] = (report.byReason[reason] || 0) + 1;
		if (report.samples.length < 200) report.samples.push({ reason, ...change });
	};

	const appointments = await models.Appointment.findAll({
		where: { bitrix_lead_id: { [Op.not]: null }, date: { [Op.between]: [from, today] } },
		order: [['date', 'ASC']],
	});
	report.checked = appointments.length;

	// Без списка визитов сверка не имеет смысла: «пришёл» — главный факт.
	// Если Битрикс не отдал сделки, ничего не трогаем и сообщаем об этом.
	let visits;
	try {
		visits = await fetchOfficeVisits(from);
	} catch (e) {
		report.error = `Битрикс не отдал сделки «Офис»: ${e?.message || e}`;
		console.error(`RECONCILE_FAILED ${report.error}`);
		await saveReport(report);
		return report;
	}
	for (const set of visits.values()) report.visits += set.size;

	const todays = appointments.filter((a) => a.date === today && ACTIVE.includes(a.status));
	const statusById = todays.length
		? await fetchLeadStatuses([...new Set(todays.map((a) => Number(a.bitrix_lead_id)))])
		: new Map();

	const trace = { source: 'reconcile' };
	const handledVisit = new Set();
	for (const appointment of appointments) {
		const leadId = Number(appointment.bitrix_lead_id);
		const key = `${leadId}|${appointment.date}`;
		const visited = visits.get(leadId)?.has(appointment.date);

		if (visited) {
			if (handledVisit.has(key)) continue;
			handledVisit.add(key);
			const r = await markVisit(leadId, appointment.date, trace, { dryRun });
			if (r.changed) push(r.change.from === 'cancelled' ? 'visit_after_cancel' : `visit_marked_${r.change.from}`, r.change);
			continue;
		}

		if (appointment.date === today) {
			if (!ACTIVE.includes(appointment.status)) continue;
			if (!statusById.has(leadId)) { note('today_no_bitrix_answer'); continue; }
			if (await hasRecentLocalStatusChange(appointment.id)) { note('today_guarded'); continue; }
			const decision = decideFromLeadStatus(appointment, statusById.get(leadId), now);
			if (!decision) continue;
			const change = { appointmentId: appointment.id, leadId, date: appointment.date, from: appointment.status, to: decision.status, bitrixStatus: statusById.get(leadId) };
			if (!dryRun) await applyDecision(appointment, { ...decision, action: `reconcile_${decision.status}` }, { ...trace, bitrixStatus: statusById.get(leadId) });
			push(`today_${decision.status}`, change);
			continue;
		}

		// Прошедший день без визита: живая встреча — это неявка.
		if (ACTIVE.includes(appointment.status)) {
			const end = appointmentEnd(appointment);
			if (end && end.getTime() > now) continue;
			const change = { appointmentId: appointment.id, leadId, date: appointment.date, from: appointment.status, to: 'no_show' };
			if (!dryRun) await applyDecision(appointment, { status: 'no_show', action: 'reconcile_no_show' }, trace);
			push('past_active_no_visit', change);
			continue;
		}
		// «Выполнена» без сделки «Офис» в тот же день — не исправляем (визит мог
		// быть заведён иначе), но показываем в отчёте.
		if (appointment.status === 'completed') note('completed_without_office_deal');
	}

	report.finishedAt = new Date().toISOString();
	if (report.changes > 0) {
		console.warn(`RECONCILE_DRIFT ${dryRun ? '(проверка) ' : ''}${from}..${today}: ${report.changes} расхождений`, JSON.stringify(report.byReason));
	} else {
		console.log(`Reconcile ${from}..${today}: расхождений нет, проверено ${report.checked}`);
	}
	await saveReport(report);
	return report;
}

async function saveReport(report) {
	try {
		await redis.set(LAST_REPORT_KEY, JSON.stringify(report), 'EX', 7 * 86400);
	} catch (e) {
		console.error('reconcile: не удалось сохранить отчёт', e?.message || e);
	}
}

async function lastReport() {
	try {
		const raw = await redis.get(LAST_REPORT_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

module.exports = {
	applyLeadState,
	applyOfficeDeal,
	reconcileRecentAppointments,
	markVisit,
	fetchOfficeVisits,
	lastReport,
	_internal: { addDays, businessDateOf },
};
