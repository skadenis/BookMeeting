const { Router } = require('express');
const axios = require('axios');

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


