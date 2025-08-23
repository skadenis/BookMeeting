function bitrixAuthMiddleware(req, res, next) {
	try {
		const authHeader = req.header('Authorization') || '';
		const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
		const domain = String(req.header('X-Bitrix-Domain') || req.query.domain || '');
		const leadId = req.query.lead_id ? Number(req.query.lead_id) : undefined;
		const dealId = req.query.deal_id ? Number(req.query.deal_id) : undefined;
		const contactId = req.query.contact_id ? Number(req.query.contact_id) : undefined;

		if (String(process.env.BITRIX_DEV_MODE) === 'true') {
			req.bitrix = {
				userId: 1,
				domain: domain || process.env.VITE_DEV_BITRIX_DOMAIN || 'example.bitrix24.ru',
				leadId,
				dealId,
				contactId,
				accessToken: token || process.env.VITE_DEV_BITRIX_TOKEN || 'dev-token',
			};
			return next();
		}

		if (!token || !domain) return res.status(401).json({ error: 'Unauthorized' });

		req.bitrix = { userId: 0, domain, leadId, dealId, contactId, accessToken: token };
		return next();
	} catch (e) {
		return next(e);
	}
}

module.exports = { bitrixAuthMiddleware };