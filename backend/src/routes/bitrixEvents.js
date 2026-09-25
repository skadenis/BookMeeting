// Приём событий Битрикса: POST /api/bitrix-events
//
// Только стандартный исходящий вебхук портала: form-urlencoded, event=…,
// data[FIELDS][ID]=…, auth[application_token]=…. Принимаются ONCRMLEADUPDATE,
// ONCRMLEADADD, ONCRMDEALADD, ONCRMDEALUPDATE. Из события берётся только ID —
// дальше services/bitrixEvents.js копит ID и читает Битрикс пачками.
// Токен — BITRIX_EVENTS_TOKEN (application_token вебхука). Без него приём
// выключен (503).

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

const TYPES = {
	ONCRMLEADADD: 'lead',
	ONCRMLEADUPDATE: 'lead',
	ONCRMDEALADD: 'deal',
	ONCRMDEALUPDATE: 'deal',
};

function parseEvent(body) {
	const event = String(body?.event || '').toUpperCase();
	const type = TYPES[event];
	const id = Number(body?.data?.FIELDS?.ID);
	if (!type || !(id > 0)) return null;
	return { type, id, event };
}

router.post('/', (req, res) => {
	const expected = process.env.BITRIX_EVENTS_TOKEN;
	if (!expected) return res.status(503).json({ ok: false, error: 'events_disabled' });
	if (!safeEqual(req.body?.auth?.application_token, expected)) {
		return res.status(401).json({ ok: false, error: 'bad_token' });
	}
	const parsed = parseEvent(req.body);
	// 200, а не 400: портал может прислать и ненужное событие — адрес не должен
	// считаться сломанным.
	if (!parsed) return res.status(200).json({ ok: true, ignored: true });
	const r = enqueue(parsed.type, parsed.id);
	return res.status(202).json({ ok: true, ...r });
});

module.exports = router;
module.exports.parseEvent = parseEvent;
