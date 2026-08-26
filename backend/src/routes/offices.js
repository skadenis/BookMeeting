const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');

const { models, Op } = require('../lib/db');
const { requireRole } = require('../middleware/adminAuth');

const router = Router();

// Пишущие маршруты доступны только через /api/admin/offices (adminAuthMiddleware
// + эта проверка). На публичном префиксе они отсекаются раньше — в routes/index.js.
const canEdit = requireRole('editor');

router.get('/', async (_req, res, next) => {
	try {
		const offices = await models.Office.findAll({ order: [['address', 'ASC']] });
		res.json({ data: offices });
	} catch (e) { next(e); }
});

router.post('/', canEdit, [
	body('city').isString().notEmpty(),
	body('address').isString().notEmpty(),
	body('addressNote').optional().isString(),
	body('bitrixOfficeId').optional().isInt({ min: 1 }),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const { city, address, addressNote, bitrixOfficeId } = req.body;
		const office = await models.Office.create({ city, address, addressNote, bitrixOfficeId });
		res.status(201).json({ data: office });
	} catch (e) { next(e); }
});

router.put('/:id', canEdit, [
	param('id').isString().notEmpty(),

	body('city').optional().isString().notEmpty(),
	body('address').optional().isString().notEmpty(),
	body('addressNote').optional().isString(),
	body('bitrixOfficeId').optional().isInt({ min: 1 }),
], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
		const office = await models.Office.findByPk(req.params.id);
		if (!office) return res.status(404).json({ error: 'Not found' });
		const { city, address, addressNote, bitrixOfficeId } = req.body;

		if (city) office.city = city;
		if (address) office.address = address;
		if (addressNote !== undefined) office.addressNote = addressNote;
		if (bitrixOfficeId !== undefined) office.bitrixOfficeId = bitrixOfficeId;
		await office.save();
		res.json({ data: office });
	} catch (e) { next(e); }
});

router.delete('/:id', canEdit, [param('id').isUUID()], async (req, res, next) => {
	try {
		const errors = validationResult(req);
		if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

		const office = await models.Office.findByPk(req.params.id);
		if (!office) return res.status(404).json({ error: 'Not found' });

		// Раньше destroy() шёл сразу: при наличии встреч или расписаний Postgres
		// отвечал нарушением внешнего ключа, а клиент получал глухую 500.
		const activeAppointments = await models.Appointment.count({
			where: { office_id: office.id, status: { [Op.in]: ['pending', 'confirmed', 'rescheduled'] } },
		});
		if (activeAppointments > 0) {
			return res.status(409).json({
				error: 'Office has active appointments',
				message: `В офисе ${activeAppointments} активных встреч — сначала перенесите или отмените их`,
				count: activeAppointments,
			});
		}

		const totalAppointments = await models.Appointment.count({ where: { office_id: office.id } });
		if (totalAppointments > 0) {
			return res.status(409).json({
				error: 'Office has appointment history',
				message: `За офисом закреплено ${totalAppointments} записей в истории — удаление удалит их безвозвратно`,
				count: totalAppointments,
			});
		}

		// Расписания и слоты офиса удаляем явно: FK на них ON DELETE не настроен
		const schedules = await models.Schedule.findAll({ where: { office_id: office.id }, attributes: ['id'] });
		for (const sch of schedules) {
			await models.Slot.destroy({ where: { schedule_id: sch.id } });
		}
		await models.Schedule.destroy({ where: { office_id: office.id } });
		await models.Template.update({ office_id: null }, { where: { office_id: office.id } });

		await office.destroy();
		res.json({ ok: true });
	} catch (e) { next(e); }
});

module.exports = router;