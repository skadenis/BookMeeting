// Приём событий Битрикса: POST /api/bitrix-events
//
// Два формата, оба — только ID сущности, содержимое шахматка читает сама:
//  1. Исходящий вебхук Битрикса (ONCRMLEADUPDATE, ONCRMLEADADD, ONCRMDEALADD,
//     ONCRMDEALUPDATE): form-urlencoded, event=…, data[FIELDS][ID]=…,
//     auth[application_token]=… — токен исходящего вебхука.
//  2. Робот/бизнес-процесс или свой обработчик портала: ?token=…&lead_id=… или
//     &deal_id=… (GET или POST, также JSON).
// Токен — BITRIX_EVENTS_TOKEN. Без него приём выключен (503): открытый адрес,
// который по любому запросу ходит в CRM, нам не нужен.

const express = require('express');
const crypto = require('crypto');
const { enqueue } = require('../services/bitrixEvents');

const router = express.Router();
router.use(express.urlencoded({ extended: true, limit: '64kb' }));

function safeEqual(a, b) {
	const bufA = Buffer.from(String(a || ''));
	const bufB = Buffer.from(String(b || ''));
	if (bufA.length === 0 || bufA.length !== bufB.length) return false;
	return crypto.timingSafeEqual(bufA, bufB);
}

function presentedToken(req) {
	return req.body?.auth?.application_token
		|| req.header('X-Hook-Token')
		|| req.query?.token
		|| req.body?.token
		|| null;
}

const LEAD_EVENTS = new Set(['ONCRMLEADADD', 'ONCRMLEADUPDATE']);
const DEAL_EVENTS = new Set(['ONCRMDEALADD', 'ONCRMDEALUPDATE']);

function parseEvent(req) {
	const src = { ...(req.query || {}), ...(req.body || {}) };
	const event = String(src.event || '').toUpperCase();
	const fieldsId = Number(src?.data?.FIELDS?.ID);
	if (LEAD_EVENTS.has(event) && fieldsId > 0) return { type: 'lead', id: fieldsId, event };
	if (DEAL_EVENTS.has(event) && fieldsId > 0) return { type: 'deal', id: fieldsId, event };
	const leadId = Number(src.lead_id);
	if (leadId > 0) return { type: 'lead', id: leadId, event: event || 'ROBOT' };
	const dealId = Number(src.deal_id);
	if (dealId > 0) return { type: 'deal', id: dealId, event: event || 'ROBOT' };
	return null;
}

async function handle(req, res) {
	const expected = process.env.BITRIX_EVENTS_TOKEN;
	if (!expected) {
		return res.status(503).json({ ok: false, error: 'events_disabled' });
	}
	if (!safeEqual(presentedToken(req), expected)) {
		return res.status(401).json({ ok: false, error: 'bad_token' });
	}
	const parsed = parseEvent(req);
	if (!parsed) {
		// 200, а не 400: Битрикс шлёт и события, которые нам не нужны
		// (например, ONCRMLEADDELETE), и не должен считать адрес сломанным.
		return res.status(200).json({ ok: true, ignored: true });
	}
	const r = enqueue(parsed.type, parsed.id, { event: parsed.event });
	return res.status(202).json({ ok: true, ...r });
}

router.post('/', handle);
router.get('/', handle);

module.exports = router;
module.exports.parseEvent = parseEvent;
