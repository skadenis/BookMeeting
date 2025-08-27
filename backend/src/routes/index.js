const { Router } = require('express');

const officesRouter = require('./offices');
const slotsRouter = require('./slots');
const templatesRouter = require('./templates');
const appointmentsRouter = require('./appointments');
const bitrixRouter = require('./placement');

const router = Router();

// Mount domain routers
router.use('/offices', officesRouter);
router.use('/slots', slotsRouter);
router.use('/templates', templatesRouter);
router.use('/appointments', appointmentsRouter);
router.use('/bitrix', bitrixRouter);

module.exports = router;


