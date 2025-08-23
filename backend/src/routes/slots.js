const { Router } = require('express');
const { query, validationResult } = require('express-validator');
const { getAvailableSlots } = require('../services/slotsService');

const router = Router();

router.get('/', [
	query('office_id').isString().notEmpty(),
	query('date').isISO8601(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const officeId = String(req.query.office_id);
		const date = String(req.query.date).slice(0, 10);
		const slots = await getAvailableSlots(officeId, date);
		res.json({ data: slots });
	} catch (e) { next(e); }
});

module.exports = router;