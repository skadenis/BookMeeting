// События Битрикса пачками.
//
// Владелец 25.09: стандартные события портала о лиде и сделке, «без тонны
// лишних запросов». ONCRMLEADUPDATE приходит на каждое изменение любого лида,
// поэтому событие само по себе ничего не стоит: берём из него только ID.
//
// Как устроено:
//  1. ID копятся в окне (BITRIX_EVENTS_WINDOW_MS, по умолчанию 15 с), повторы
//     одного ID в окне — один ID.
//  2. В конце окна лиды отсеиваются по нашей базе, без запроса в Битрикс:
//     остаются только те, у кого в шахматке есть незакрытая встреча на сегодня
//     или позже либо за последние BITRIX_EVENTS_LOOKBACK_HOURS часов (по
//     умолчанию 24). Остальной поток лидов выбрасывается.
//  3. Оставшиеся лиды — один crm.lead.list на 50 ID с select только нужных
//     полей; сделки — один crm.deal.list на 50 ID с CATEGORY_ID воронки
//     «Офис». Итог — не больше одного запроса на тип за окно при обычном потоке.
//  4. Сбой чтения — ID возвращаются в следующее окно (до 3 попыток). Что
//     потерялось совсем, подберёт опрос раз в 5 минут и суточная сверка.
// Обработка читает состояние лида/сделки из Битрикса, а не из события,
// поэтому повторное событие безопасно.

const { models, Op } = require('../lib/db');
const { callBitrix } = require('../lib/bitrix');
const { businessToday } = require('../lib/time');
const { applyLeadState, applyOfficeDeal } = require('./reconcile');

const WINDOW_MS = () => Number(process.env.BITRIX_EVENTS_WINDOW_MS ?? 15000);
const LOOKBACK_HOURS = () => Number(process.env.BITRIX_EVENTS_LOOKBACK_HOURS ?? 24);
const OFFICE_DEAL_CATEGORY = Number(process.env.BITRIX_OFFICE_DEAL_CATEGORY || 0);
const BATCH = 50;
const MAX_ATTEMPTS = 3;
const MAX_PENDING = 20000;

// Незакрытые встречи: по ним стадия лида ещё может что-то изменить
// (неявка → пришёл, если клиент опоздал).
const OPEN_STATUSES = ['pending', 'confirmed', 'rescheduled', 'no_show'];

const LEAD_FIELDS = ['ID', 'STATUS_ID', 'MODIFY_BY_ID', 'UF_CRM_1655460588', 'UF_CRM_1657019494', 'UF_CRM_1675255265'];
const DEAL_FIELDS = ['ID', 'LEAD_ID', 'CONTACT_ID', 'DATE_CREATE', 'CATEGORY_ID'];

const pending = { lead: new Map(), deal: new Map() }; // id → попытка
let timer = null;
let flushing = null;
const stats = {
	received: 0, leadsQueued: 0, dealsQueued: 0, leadsFiltered: 0, leadsProcessed: 0, dealsProcessed: 0,
	bitrixCalls: 0, windows: 0, failed: 0, dropped: 0, lastEventAt: null, lastFlushAt: null, lastError: null,
};

function schedule() {
	if (timer || flushing) return;
	timer = setTimeout(() => { timer = null; flush(); }, WINDOW_MS());
	timer.unref?.();
}

function enqueue(type, id) {
	const n = Number(id);
	if (!pending[type]) throw new Error(`unknown event type ${type}`);
	stats.received++;
	stats.lastEventAt = new Date().toISOString();
	if (!Number.isFinite(n) || n <= 0) return { queued: false, reason: 'bad_id' };
	if (!pending[type].has(n)) {
		if (pending.lead.size + pending.deal.size >= MAX_PENDING) {
			stats.dropped++;
			return { queued: false, reason: 'queue_full' };
		}
		pending[type].set(n, 0);
		stats[type === 'lead' ? 'leadsQueued' : 'dealsQueued']++;
	}
	schedule();
	return { queued: true };
}

function take(type) {
	const items = [...pending[type].entries()];
	pending[type].clear();
	return items;
}

function requeue(type, items) {
	for (const [id, attempt] of items) {
		if (attempt + 1 >= MAX_ATTEMPTS) { stats.failed++; continue; }
		if (!pending[type].has(id)) pending[type].set(id, attempt + 1);
	}
}

// Лиды, по которым в шахматке есть незакрытая встреча, — один запрос в нашу базу
async function relevantLeadIds(ids) {
	if (ids.length === 0) return new Set();
	const since = businessToday(new Date(Date.now() - LOOKBACK_HOURS() * 3600 * 1000));
	const rows = await models.Appointment.findAll({
		attributes: ['bitrix_lead_id'],
		where: { bitrix_lead_id: { [Op.in]: ids }, date: { [Op.gte]: since }, status: { [Op.in]: OPEN_STATUSES } },
		raw: true,
	});
	return new Set(rows.map((r) => Number(r.bitrix_lead_id)));
}

async function flushLeads() {
	const items = take('lead');
	if (items.length === 0) return;
	const attemptOf = new Map(items);
	const keep = await relevantLeadIds(items.map(([id]) => id));
	stats.leadsFiltered += items.length - keep.size;
	const ids = [...keep];
	for (let i = 0; i < ids.length; i += BATCH) {
		const chunk = ids.slice(i, i + BATCH);
		let rows;
		try {
			stats.bitrixCalls++;
			const data = await callBitrix('crm.lead.list', { filter: { ID: chunk }, select: LEAD_FIELDS }, { attempts: 2, retryDelayMs: Number(process.env.BITRIX_RETRY_DELAY_MS ?? 1000) });
			rows = data?.result || [];
		} catch (e) {
			stats.lastError = `crm.lead.list: ${e?.message || e}`;
			console.error(`BITRIX_EVENT_BATCH_FAILED leads=${chunk.length}: ${e?.message || e}`);
			requeue('lead', chunk.map((id) => [id, attemptOf.get(id) || 0]));
			continue;
		}
		for (const lead of rows) {
			try {
				await applyLeadState(lead, { source: 'bitrix_event', event: 'ONCRMLEADUPDATE' });
				stats.leadsProcessed++;
			} catch (e) {
				stats.lastError = `lead ${lead.ID}: ${e?.message || e}`;
				console.error(`BITRIX_EVENT_FAILED lead:${lead.ID}: ${e?.message || e}`);
			}
		}
	}
}

async function flushDeals() {
	const items = take('deal');
	if (items.length === 0) return;
	const attemptOf = new Map(items);
	const ids = items.map(([id]) => id);
	for (let i = 0; i < ids.length; i += BATCH) {
		const chunk = ids.slice(i, i + BATCH);
		let rows;
		try {
			stats.bitrixCalls++;
			const data = await callBitrix('crm.deal.list', {
				filter: { ID: chunk, CATEGORY_ID: OFFICE_DEAL_CATEGORY },
				select: DEAL_FIELDS,
			}, { attempts: 2, retryDelayMs: Number(process.env.BITRIX_RETRY_DELAY_MS ?? 1000) });
			rows = data?.result || [];
		} catch (e) {
			stats.lastError = `crm.deal.list: ${e?.message || e}`;
			console.error(`BITRIX_EVENT_BATCH_FAILED deals=${chunk.length}: ${e?.message || e}`);
			requeue('deal', chunk.map((id) => [id, attemptOf.get(id) || 0]));
			continue;
		}
		for (const deal of rows) {
			try {
				await applyOfficeDeal(deal, { source: 'bitrix_event', event: 'ONCRMDEALADD' });
				stats.dealsProcessed++;
			} catch (e) {
				stats.lastError = `deal ${deal.ID}: ${e?.message || e}`;
				console.error(`BITRIX_EVENT_FAILED deal:${deal.ID}: ${e?.message || e}`);
			}
		}
	}
}

async function flush() {
	if (flushing) return flushing;
	if (timer) { clearTimeout(timer); timer = null; }
	flushing = (async () => {
		stats.windows++;
		stats.lastFlushAt = new Date().toISOString();
		try { await flushLeads(); } catch (e) { stats.lastError = e?.message || String(e); console.error('BITRIX_EVENT_FLUSH_FAILED leads:', e?.message || e); }
		try { await flushDeals(); } catch (e) { stats.lastError = e?.message || String(e); console.error('BITRIX_EVENT_FLUSH_FAILED deals:', e?.message || e); }
	})();
	try { await flushing; } finally {
		flushing = null;
		if (pending.lead.size || pending.deal.size) schedule();
	}
}

function getStats() {
	return { ...stats, pendingLeads: pending.lead.size, pendingDeals: pending.deal.size, windowMs: WINDOW_MS() };
}

function reset() {
	if (timer) { clearTimeout(timer); timer = null; }
	pending.lead.clear();
	pending.deal.clear();
	for (const k of Object.keys(stats)) stats[k] = typeof stats[k] === 'number' ? 0 : null;
}

module.exports = { enqueue, flush, getStats, reset, LEAD_FIELDS, DEAL_FIELDS };
