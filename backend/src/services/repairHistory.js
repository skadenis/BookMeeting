// Исправление уже записанной истории встреч по Битриксу.
//
// До 26.09.2026 синхронизация превращала неявку (стадия лида 3) в «отменена»,
// а с 26.09 до исправления правила leadRules — ещё и неявку, которую роботы
// сразу уводили из 3 в «НДЗ 1». Операторы, кроме того, жали «Отменить» или
// перезаписывали клиента уже после начала встречи. Сверка (reconcile) смотрит
// только последние дни и такие встречи не трогает. Эта команда проходит окно
// дат целиком:
//
//  1. сделка «Офис» по лиду в день встречи → «пришёл» (как сверка);
//  2. стадия 3 «Не пришел на встречу» в день встречи после её начала, а
//     встреча не закрыта оператором ДО начала → «не пришёл» (repair_no_show);
//  3. отменена синхронизацией без записи в журнале (записи до 26.09), стадии 3
//     нет, а лид ушёл со стадий встречи до её начала → статус остаётся
//     «отменена», в журнал пишется repair_cancelled с моментом ухода: выгрузка
//     для платформы тогда видит отмену заранее, а не неявку.
// Остальное не меняется и попадает в отчёт.
//
// Битрикс читается дважды: сделки «Офис» за окно и стадии 3 за окно (оба —
// постранично по 50), плюс полная история стадий только для лидов из п. 3.
// По умолчанию — сухой прогон.

const { models, Op } = require('../lib/db');
const { callBitrix } = require('../lib/bitrix');
const { businessToday } = require('../lib/time');
const { appointmentStart, appointmentEnd } = require('./leadRules');
const { recordSyncChange } = require('./syncTasks');
const { fetchOfficeVisits, markVisit, _internal: { addDays, businessDateOf } } = require('./reconcile');

const MEETING = new Set(['2', '37']);
// Любое событие журнала, которое закрывает встречу
const CLOSING = new Set([
	'status_cancelled', 'cancelled_by_rebooking', 'cancelled_after_start', 'no_show_by_rebooking',
	'sync_cancelled', 'sync_no_show', 'sync_completed', 'expired_no_show', 'restored_completed',
	'reconcile_no_show', 'reconcile_cancelled', 'reconcile_completed', 'visit_completed', 'visit_after_cancel',
	'repair_no_show', 'repair_cancelled',
]);
// Оператор закрыл встречу сам — до начала это его решение, его не трогаем
const OPERATOR_CLOSE = new Set(['status_cancelled', 'cancelled_by_rebooking']);
const RETRY_DELAY_MS = () => Number(process.env.BITRIX_RETRY_DELAY_MS ?? 1000);

// crm.stagehistory.list лидов постранично: [{ leadId, stage, at: Date }] по возрастанию ID
async function fetchLeadStages(filter) {
	const out = [];
	let start = 0;
	for (let page = 0; page < 2000; page++) {
		const data = await callBitrix('crm.stagehistory.list', {
			entityTypeId: 1,
			order: { ID: 'ASC' },
			filter,
			select: ['ID', 'OWNER_ID', 'CREATED_TIME', 'STATUS_ID'],
			start,
		}, { attempts: 3, retryDelayMs: RETRY_DELAY_MS() });
		for (const it of data?.result?.items || []) {
			const at = new Date(it.CREATED_TIME);
			if (!Number.isNaN(at.getTime())) out.push({ id: Number(it.ID), leadId: Number(it.OWNER_ID), stage: String(it.STATUS_ID), at });
		}
		if (data?.next === undefined || data?.next === null) break;
		start = data.next;
	}
	return out.sort((a, b) => a.id - b.id);
}

// Стадия лида на момент t по его истории (null — событий до t в окне нет)
function stageAt(events, t) {
	let stage = null;
	for (const e of events) {
		if (e.at.getTime() > t) break;
		stage = e.stage;
	}
	return stage;
}

// Момент последнего ухода со стадий встречи до t (null — не уходил)
function leftMeetingAt(events, t) {
	let left = null;
	for (const e of events) {
		if (e.at.getTime() > t) break;
		if (MEETING.has(e.stage)) left = null;
		else if (left === null) left = e.at;
	}
	return left;
}

/**
 * from, to — даты встреч (YYYY-MM-DD, по Минску). Берутся только встречи,
 * которые уже закончились. dryRun (по умолчанию true) — только отчёт.
 */
async function repairHistory({ from, to, dryRun = true, now = Date.now() } = {}) {
	const today = businessToday(new Date(now));
	const report = { from, to, dryRun: !!dryRun, checked: 0, changes: 0, byReason: {}, notes: {}, samples: [] };
	const note = (k) => { report.notes[k] = (report.notes[k] || 0) + 1; };
	const push = (reason, change) => {
		report.changes++;
		report.byReason[reason] = (report.byReason[reason] || 0) + 1;
		if (report.samples.length < 300) report.samples.push({ reason, ...change });
	};

	const appointments = (await models.Appointment.findAll({
		where: { bitrix_lead_id: { [Op.not]: null }, date: { [Op.between]: [from, to > today ? today : to] } },
		order: [['date', 'ASC'], ['createdAt', 'ASC']],
	})).filter((a) => {
		const end = appointmentEnd(a);
		return end && end.getTime() <= now;
	});
	report.checked = appointments.length;
	if (appointments.length === 0) return report;

	const history = await models.AppointmentHistory.findAll({
		where: { appointment_id: { [Op.in]: appointments.map((a) => a.id) } },
		attributes: ['appointment_id', 'action', 'createdAt'],
		order: [['createdAt', 'ASC']],
		raw: true,
	});
	const journal = new Map();
	for (const h of history) {
		if (!CLOSING.has(h.action)) continue;
		const k = String(h.appointment_id);
		if (!journal.has(k)) journal.set(k, []);
		journal.get(k).push(h);
	}

	// 1. Визиты
	const visits = await fetchOfficeVisits(from);
	const trace = { source: 'repair' };
	const visitedDays = new Set();
	for (const a of appointments) {
		const leadId = Number(a.bitrix_lead_id);
		if (!visits.get(leadId)?.has(a.date)) continue;
		const key = `${leadId}|${a.date}`;
		if (visitedDays.has(key)) continue;
		visitedDays.add(key);
		const r = await markVisit(leadId, a.date, trace, { dryRun });
		if (r.changed) push(r.change.from === 'cancelled' ? 'visit_after_cancel' : `visit_marked_${r.change.from}`, r.change);
	}

	// Встречи дня без визита, не закрытые оператором до начала. Меняются
	// только отменённые и зависшие активные; неявки участвуют в раздаче стадий 3.
	const open = [];
	for (const a of appointments) {
		const leadId = Number(a.bitrix_lead_id);
		if (visitedDays.has(`${leadId}|${a.date}`)) continue;
		const start = appointmentStart(a);
		if (!start) { note('bad_time'); continue; }
		const closes = journal.get(String(a.id)) || [];
		if (closes.some((h) => OPERATOR_CLOSE.has(h.action) && new Date(h.createdAt).getTime() < start.getTime())) {
			note('operator_closed_before_start');
			continue;
		}
		if (a.status === 'completed') { note('keep_completed'); continue; }
		open.push({ a, leadId, start, closes });
	}

	// 2. Стадия 3 в день встречи. Одна стадия 3 — одной встрече лида: той,
	// что началась последней до неё (агент ставит 3 через 5 минут после начала).
	const noShows = await fetchLeadStages({
		STATUS_ID: '3',
		'>=CREATED_TIME': `${from}T00:00:00+03:00`,
		'<CREATED_TIME': `${addDays(to, 1)}T00:00:00+03:00`,
	});
	const openByLeadDay = new Map();
	for (const c of open) {
		const k = `${c.leadId}|${c.a.date}`;
		if (!openByLeadDay.has(k)) openByLeadDay.set(k, []);
		openByLeadDay.get(k).push(c);
	}
	const owner = new Map(); // встреча → момент стадии 3
	for (const e of noShows) {
		const day = openByLeadDay.get(`${e.leadId}|${businessDateOf(e.at)}`) || [];
		const t = e.at.getTime();
		const mine = day.filter((c) => c.start.getTime() - 10 * 60 * 1000 <= t).sort((x, y) => y.start - x.start)[0];
		if (mine && !owner.has(mine)) owner.set(mine, e.at);
	}
	const rest = [];
	for (const c of open) {
		if (c.a.status === 'no_show') { note('keep_no_show'); continue; }
		const t = owner.get(c);
		if (!t) { rest.push(c); continue; }
		const last = c.closes[c.closes.length - 1];
		const reason = `no_show_was_${last ? last.action : `${c.a.status}_without_journal`}`;
		const change = { appointmentId: c.a.id, leadId: c.leadId, date: c.a.date, from: c.a.status, to: 'no_show', closedBy: last ? last.action : null, bitrixAt: t.toISOString() };
		if (!dryRun) {
			const before = { status: c.a.status };
			await c.a.update({ status: 'no_show' });
			await recordSyncChange(c.a, 'repair_no_show', before, { ...trace, bitrixStatus: '3', eventAt: t.toISOString() });
		}
		push(reason, change);
	}

	// 3. Отменены синхронизацией без журнала и без стадии 3: когда лид ушёл со
	// стадий встречи — по полной истории стадий этих лидов
	const silent = rest.filter((c) => c.a.status === 'cancelled' && c.closes.length === 0);
	for (const c of rest) if (!silent.includes(c)) note(c.a.status === 'cancelled' ? 'cancelled_with_journal_no_stage3' : `past_${c.a.status}_no_stage3`);
	const leadIds = [...new Set(silent.map((c) => c.leadId))];
	const events = new Map();
	for (let i = 0; i < leadIds.length; i += 50) {
		const chunk = leadIds.slice(i, i + 50);
		for (const e of await fetchLeadStages({ OWNER_ID: chunk, '>=CREATED_TIME': `${addDays(from, -30)}T00:00:00+03:00` })) {
			if (!events.has(e.leadId)) events.set(e.leadId, []);
			events.get(e.leadId).push(e);
		}
	}
	for (const c of silent) {
		const ev = events.get(c.leadId) || [];
		const t = c.start.getTime();
		const stage = stageAt(ev, t);
		if (stage === null) { note('silent_cancel_no_history'); continue; }
		if (MEETING.has(stage)) { note('silent_cancel_meeting_stage_no_3'); continue; }
		if (stage === 'CONVERTED' || stage === '4') { note('silent_cancel_visited_earlier'); continue; }
		const left = leftMeetingAt(ev, t) || c.start;
		const change = { appointmentId: c.a.id, leadId: c.leadId, date: c.a.date, from: 'cancelled', to: 'cancelled', bitrixStatus: stage, bitrixAt: left.toISOString() };
		if (!dryRun) {
			await recordSyncChange(c.a, 'repair_cancelled', { status: 'cancelled' }, { ...trace, bitrixStatus: stage, eventAt: left.toISOString() });
		}
		push('cancelled_before_start_journaled', change);
	}

	report.finishedAt = new Date().toISOString();
	console.log(`REPAIR_HISTORY ${dryRun ? '(проверка) ' : ''}${from}..${to}: ${report.changes} исправлений`, JSON.stringify(report.byReason));
	return report;
}

module.exports = { repairHistory, _internal: { stageAt, leftMeetingAt } };
