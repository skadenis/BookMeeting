const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { models } = require('../lib/db');

const router = Router();

router.get('/', async (_req, res, next) => {
	try {
		const offices = await models.Office.findAll({ order: [['name', 'ASC']] });
		res.json({ data: offices });
	} catch (e) { next(e); }
});

router.post('/', [
	body('name').isString().notEmpty(),
	body('city').isString().notEmpty(),
	body('address').isString().notEmpty(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { name, city, address } = req.body;
		const office = await models.Office.create({ name, city, address });
		res.status(201).json({ data: office });
	} catch (e) { next(e); }
});

module.exports = router;