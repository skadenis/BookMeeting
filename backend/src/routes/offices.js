const { Router } = require('express');
const { models } = require('../lib/db');

const router = Router();

router.get('/', async (_req, res, next) => {
	try {
		const offices = await models.Office.findAll({ order: [['name', 'ASC']] });
		res.json({ data: offices });
	} catch (e) { next(e); }
});

module.exports = router;