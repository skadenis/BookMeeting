const { Router } = require('express');
const axios = require('axios');
const { models } = require('../lib/db');

const router = Router();

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
    const domain = req.query.DOMAIN || req.query.domain || (req.bitrix && req.bitrix.domain);
    if (!token || !domain) {
      return res.status(400).json({ ok: false, error: 'Missing AUTH_ID or domain' });
    }

    const url = `https://${domain}/rest/placement.info.json?auth=${encodeURIComponent(String(token))}`;
    const r = await axios.post(url, {});
    const entityId = Number(r?.data?.result?.entityId);
    if (Number.isFinite(entityId) && entityId > 0) {
      return res.json({ ok: true, source: 'placement', lead_id: entityId, raw: r.data });
    }
    return res.status(404).json({ ok: false, error: 'lead id not found in placement.info', raw: r.data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;

// Additional helpers for Bitrix lead operations
router.get('/lead', async (req, res) => {
  try {
    const id = Number(req.query.id || req.query.lead_id || req.query.LEAD_ID);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Missing lead id' });
    }

    const base = String(process.env.BITRIX_REST_URL).replace(/\/+$/, '');
    const url = `${base}/crm.lead.get`;
    const response = await axios.post(url, { id });
    const lead = response?.data?.result || null;
    return res.json({ ok: true, lead, raw: response?.data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.response?.data || e.message });
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
      const base = String(process.env.BITRIX_REST_URL).replace(/\/+$/, '');
      const url = `${base}/crm.lead.update`;
      const payload = {
        id: Number(leadId),
        fields: {
          UF_CRM_1675255265: Number(officeBitrixId),
        },
      };
      const response = await axios.post(url, payload);
      return res.json({ ok: true, result: response?.data });
    } else {
      console.log('🚫 Локальная разработка: пропускаю отправку в Bitrix при размещении лида');
      return res.json({ ok: true, result: { message: 'Local development - Bitrix update skipped' } });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.response?.data || e.message });
  }
});


