const { Router } = require('express');
const { models, Op } = require('../lib/db');
const { adminAuthMiddleware } = require('../middleware/adminAuth');
const dayjs = require('dayjs');
const axios = require('axios');
const { autoSyncStatuses, autoExpireAppointments, dedupeAppointments } = require('../services/syncTasks');

const router = Router();

// Маппинг статусов Bitrix24 -> наша система
const BITRIX_STATUS_MAPPING = {
  '2': 'pending',        // Встреча назначена
  '37': 'confirmed',     // Встреча подтверждена
  '38': 'completed',     // Встреча завершена успешно
  '39': 'no_show',       // Клиент не пришел
  '40': 'cancelled',     // Встреча отменена
  'CONVERTED': 'completed', // Лид конвертирован → считаем как завершенную встречу
  // Добавьте другие статусы по мере необходимости
};

// Middleware: разрешить вызов либо по внутреннему X-Cron-Token, либо от авторизованного админа
function allowCronOrAdmin(req, res, next) {
  const token = req.headers['x-cron-token'];
  const expected = process.env.CRON_TOKEN || 'internal-cron-token';
  if (token && token === expected) {
    return next();
  }
  // Фоллбек: пускаем авторизованных админов
  return adminAuthMiddleware(req, res, next);
}

// Автоматическая синхронизация статусов с Bitrix24
router.post('/auto-sync-statuses', allowCronOrAdmin, async (req, res, next) => {
  try {
    const result = await autoSyncStatuses();
    res.json({ data: { ...result, message: `Проверено ${result.checked}, обновлено ${result.updated}, неявок ${result.no_show}` } });
  } catch (e) {
    console.error('Auto sync error:', e);
    next(e);
  }
});

// Получить статистику завершенных встреч
router.get('/completed-stats', async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;

    const whereClause = {
      status: { [Op.in]: ['completed', 'no_show', 'cancelled'] }
    };

    if (start_date && end_date) {
      whereClause.date = {
        [Op.between]: [start_date, end_date]
      };
    } else {
      // По умолчанию за последний месяц
      whereClause.date = {
        [Op.gte]: dayjs().subtract(30, 'days').format('YYYY-MM-DD')
      };
    }

    const stats = await models.Appointment.findAll({
      attributes: [
        'status',
        [models.Appointment.sequelize.fn('COUNT', '*'), 'count']
      ],
      where: whereClause,
      group: ['status'],
      raw: true
    });

    // Агрегируем по дате без JOIN, чтобы избежать ошибок GROUP BY
    const detailedStats = await models.Appointment.findAll({
      attributes: [
        'status',
        [models.Appointment.sequelize.fn('COUNT', models.Appointment.sequelize.col('id')), 'count'],
        'date'
      ],
      where: whereClause,
      group: ['status', 'date'],
      order: [['date', 'DESC']],
      raw: true
    });

    const totalStats = stats.reduce((acc, stat) => {
      acc[stat.status] = parseInt(stat.count);
      return acc;
    }, {
      completed: 0,
      no_show: 0,
      cancelled: 0
    });

    const totalProcessed = Object.values(totalStats).reduce((sum, count) => sum + count, 0);
    // Дублируем total внутрь summary для удобства фронта
    const summary = { ...totalStats, total: totalProcessed };

    res.json({
      data: {
        summary,
        daily: detailedStats,
        total: totalProcessed
      }
    });

  } catch (e) {
    console.error('Completed stats error:', e);
    next(e);
  }
});

// Автоматическое истечение просроченных встреч
router.post('/auto-expire', allowCronOrAdmin, async (req, res, next) => {
  try {
    const result = await autoExpireAppointments();
    res.json({ data: { ...result, message: `Помечено как просроченные: ${result.expired} встреч` } });
  } catch (e) {
    console.error('Auto expire error:', e);
    next(e);
  }
});

// Удаление дублей встреч (для крона/админа)
router.post('/dedupe', allowCronOrAdmin, async (req, res, next) => {
  try {
    const { dry_run } = req.body || {};
    const result = await dedupeAppointments({ dryRun: !!dry_run });
    res.json({ data: result });
  } catch (e) { next(e); }
});

module.exports = router;
