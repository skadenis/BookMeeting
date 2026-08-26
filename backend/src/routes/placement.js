const { Router } = require('express');
const axios = require('axios');
const { models } = require('../lib/db');
const { restUrl, isAllowedDomain, normalizeDomain } = require('../lib/bitrix');

const router = Router();

// Bitrix REST can hang for minutes under load; without a cap the widget waits on it forever
const BITRIX_READ_TIMEOUT_MS = 10000;
const BITRIX_WRITE_TIMEOUT_MS = 20000;

// Поля лида, которые нужны виджету. Раньше отдавался весь объект целиком
// плюс `raw: response.data` — то есть ФИО, телефоны, почта и комментарии
// любого лида по его ID, а сам маршрут был в списке публичных в bitrixAuth.
const LEAD_PUBLIC_FIELDS = ['ID', 'STATUS_ID', 'UF_CRM_1675255265', 'UF_CRM_1655460588', 'UF_CRM_1657019494'];

function pickLeadFields(lead) {
	if (!lead || typeof lead !== 'object') return null;
	const out = {};
	for (const key of LEAD_PUBLIC_FIELDS) {
		if (lead[key] !== undefined) out[key] = lead[key];
	}
	return out;
}

// GET /api/bitrix/lead-id - resolves lead id using Bitrix placement.info if needed
router.get('/lead-id', async (req, res) => {
	try {
		// 1) If lead_id explicitly provided, return it
		const explicit = req.query.lead_id || req.query.LEAD_ID;
		if (explicit) {
			const id = Number(explicit);
			if (Number.isFinite(id) && id > 0) {
				return res.json({ ok: true, source: 'query', lead_id: id });
			}
		}

		// 2) Otherwise try using Bitrix AUTH_ID (access token) to call placement.info
		const token = req.query.AUTH_ID || req.query.auth || (req.bitrix && req.bitrix.accessToken);
		const rawDomain = req.query.DOMAIN || req.query.domain || (req.bitrix && req.bitrix.domain);
		if (!token || !rawDomain) {
			return res.status(400).json({ ok: false, error: 'Missing AUTH_ID or domain' });
		}

		// SSRF: домен приходил из query и подставлялся в URL без проверки —
		// сервер делал POST по любому адресу и уносил туда токен.
		const domain = normalizeDomain(rawDomain);
		if (!isAllowedDomain(domain)) {
			return res.status(403).json({ ok: false, error: 'Домен Bitrix не разрешён' });
		}

		const url = `https://${domain}/rest/placement.info.json`;
		const r = await axios.post(url, { auth: String(token) }, { timeout: BITRIX_READ_TIMEOUT_MS });
		const entityId = Number(r?.data?.result?.entityId);
		if (Number.isFinite(entityId) && entityId > 0) {
			return res.json({ ok: true, source: 'placement', lead_id: entityId });
		}
		return res.status(404).json({ ok: false, error: 'lead id not found in placement.info' });
	} catch (e) {
		console.error('placement/lead-id:', e?.message || e);
		return res.status(502).json({ ok: false, error: 'Bitrix request failed' });
	}
});

// Ограниченная карточка лида: только поля, нужные виджету для выбора офиса
router.get('/lead', async (req, res) => {
	try {
		const id = Number(req.query.id || req.query.lead_id || req.query.LEAD_ID);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ ok: false, error: 'Missing lead id' });
		}

		const response = await axios.post(restUrl('crm.lead.get'), { id }, { timeout: BITRIX_READ_TIMEOUT_MS });
		const lead = pickLeadFields(response?.data?.result);
		if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
		// Ответ Bitrix целиком (`raw`) наружу больше не отдаём
		return res.json({ ok: true, lead });
	} catch (e) {
		console.error('placement/lead:', e?.response?.status || '', e?.message || e);
		return res.status(502).json({ ok: false, error: 'Bitrix request failed' });
	}
});

router.post('/lead/update-office', async (req, res) => {
	try {
		const leadId = Number(req.body.lead_id || req.body.id);
		const officeId = req.body.office_id;
		let officeBitrixId = req.body.office_bitrix_id;

		if (!Number.isFinite(leadId) || leadId <= 0) {
			return res.status(400).json({ ok: false, error: 'Invalid lead_id' });
		}

		if (!officeBitrixId && officeId) {
			const office = await models.Office.findByPk(officeId);
			officeBitrixId = office ? office.bitrixOfficeId : null;
		}

		if (!officeBitrixId) {
			return res.status(400).json({ ok: false, error: 'office_bitrix_id not provided or office not found' });
		}

		if (process.env.NODE_ENV === 'production') {
			const payload = {
				id: Number(leadId),
				fields: {
					UF_CRM_1675255265: Number(officeBitrixId),
				},
			};
			await axios.post(restUrl('crm.lead.update'), payload, { timeout: BITRIX_WRITE_TIMEOUT_MS });
			return res.json({ ok: true });
		}

		console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при размещении лида');
		return res.json({ ok: true, result: { message: 'Local development - Bitrix update skipped' } });
	} catch (e) {
		console.error('placement/lead/update-office:', e?.message || e);
		return res.status(502).json({ ok: false, error: 'Bitrix request failed' });
	}
});

module.exports = router;
