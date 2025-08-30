const { Router } = require('express');

const officesRouter = require('./offices');
const slotsRouter = require('./slots');
const templatesRouter = require('./templates');
const appointmentsRouter = require('./appointments');
const authRouter = require('./auth');
const adminUsersRouter = require('./adminUsers');
const adminAppointmentsRouter = require('./adminAppointments');
const adminSettingsRouter = require('./adminSettings');
const syncServiceRouter = require('./syncService');
const bitrixRouter = require('./placement');

const router = Router();

// Mount domain routers
router.use('/offices', officesRouter);
router.use('/slots', slotsRouter);
router.use('/templates', templatesRouter);
router.use('/appointments', appointmentsRouter);
router.use('/auth', authRouter);
router.use('/admin/users', adminUsersRouter);
router.use('/admin/appointments', adminAppointmentsRouter);
router.use('/admin/settings', adminSettingsRouter);
router.use('/admin/sync', syncServiceRouter);
router.use('/bitrix', bitrixRouter);

module.exports = router;


