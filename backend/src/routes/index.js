const { Router } = require('express');

const officesRouter = require('./offices');
const slotsRouter = require('./slots');
const templatesRouter = require('./templates');
const appointmentsRouter = require('./appointments');
const bitrixRouter = require('./placement');

const router = Router();

// Публичный контур (виджет в Bitrix24) — только чтение справочников.
//
// Раньше здесь монтировались те же самые роутеры офисов, шаблонов и слотов,
// что и под /api/admin/* с adminAuthMiddleware. Из-за этого POST /api/offices,
// DELETE /api/offices/:id и POST /api/templates/:id/apply были доступны любому,
// кто прошёл bitrixAuth. Пишущие маршруты остаются только на админском префиксе.
function readOnly(req, res, next) {
	if (req.method === 'GET' || req.method === 'HEAD') return next();
	return res.status(403).json({
		error: 'Forbidden',
		details: 'Изменение справочников доступно только через /api/admin',
	});
}

router.use('/offices', readOnly, officesRouter);
router.use('/slots', readOnly, slotsRouter);
router.use('/templates', readOnly, templatesRouter);

// Записи: чтение своих + создание/изменение с проверкой принадлежности внутри
router.use('/appointments', appointmentsRouter);
router.use('/bitrix', bitrixRouter);

// Админские роутеры здесь больше не монтируются: они уже подключены в index.js
// под /api/admin/* вместе со своей авторизацией. Дубликат только запутывал
// маршрутизацию и создавал второй путь к тем же обработчикам.

module.exports = router;
