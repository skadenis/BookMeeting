const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');

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

router.put('/:id', [
	param('id').isString().notEmpty(),
	body('name').optional().isString().notEmpty(),
	body('city').optional().isString().notEmpty(),
	body('address').optional().isString().notEmpty(),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const office = await models.Office.findByPk(req.params.id);
		if (!office) return res.status(404).json({ error: 'Not found' });
		const { name, city, address } = req.body;
		if (name) office.name = name;
		if (city) office.city = city;
		if (address) office.address = address;
		await office.save();
		res.json({ data: office });
	} catch (e) { next(e); }
});

router.delete('/:id', [param('id').isString().notEmpty()], async (req, res, next) => {
	try {
		await models.Office.destroy({ where: { id: req.params.id } });
		res.json({ ok: true });
	} catch (e) { next(e); }
});

module.exports = router;