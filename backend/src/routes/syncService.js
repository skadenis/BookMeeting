const { Router } = require('express');
const crypto = require('crypto');
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

// Middleware: разрешить вызов либо по внутреннему X-Cron-Token, либо от авторизованного админа.
//
// Раньше здесь было `process.env.CRON_TOKEN || 'internal-cron-token'`, а сама
// переменная не задавалась ни в одном compose-файле — значит в проде работала
// именно константа из исходников. Заголовка X-Cron-Token: internal-cron-token
// хватало, чтобы вызвать /dedupe, который физически удаляет записи.
// Теперь при незаданном CRON_TOKEN этот путь просто отключён.
function allowCronOrAdmin(req, res, next) {
  const expected = process.env.CRON_TOKEN;
  if (expected && expected !== 'internal-cron-token') {
    const token = req.headers['x-cron-token'];
    if (token && Buffer.byteLength(token) === Buffer.byteLength(expected)
        && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return next();
    }
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
router.get('/completed-stats', allowCronOrAdmin, async (req, res, next) => {
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
        [models.Appointment.sequelize.fn('COUNT', models.Appointment.sequelize.col('id')), 'count']
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
    res.json({ data: { ...result, message: `Помечено как просроченные: ${result.no_show} встреч` } });
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

// Сверка последних дней с Битриксом. dry_run: true — только отчёт.
router.post('/reconcile', allowCronOrAdmin, async (req, res, next) => {
  try {
    const { reconcileRecentAppointments } = require('../services/reconcile');
    const days = Math.min(31, Math.max(1, Number(req.body?.days) || 7));
    const report = await reconcileRecentAppointments({ daysBack: days, dryRun: req.body?.dry_run !== false });
    res.json({ data: report });
  } catch (e) { next(e); }
});

// Отчёт последней сверки (крон или ручной запуск)
router.get('/reconcile/last', allowCronOrAdmin, async (_req, res, next) => {
  try {
    const { lastReport } = require('../services/reconcile');
    res.json({ data: await lastReport() });
  } catch (e) { next(e); }
});

// Очередь событий Битрикса: сколько пришло, обработано, упало
router.get('/events/stats', allowCronOrAdmin, (_req, res) => {
  const { getStats } = require('../services/bitrixEvents');
  res.json({ data: { enabled: !!process.env.BITRIX_EVENTS_TOKEN, ...getStats() } });
});

// Назначения мимо сетки: по дням, исходам и сотрудникам Битрикса
router.get('/bypass', allowCronOrAdmin, async (req, res, next) => {
  try {
    const from = String(req.query.from || dayjs().subtract(30, 'day').format('YYYY-MM-DD')).slice(0, 10);
    const to = String(req.query.to || dayjs().format('YYYY-MM-DD')).slice(0, 10);
    const rows = await models.CrmBypass.findAll({
      where: { createdAt: { [Op.between]: [new Date(`${from}T00:00:00+03:00`), new Date(`${to}T23:59:59+03:00`)] } },
      order: [['createdAt', 'DESC']],
      limit: 2000,
      raw: true,
    });
    const count = (key) => rows.reduce((acc, r) => { const k = String(r[key] ?? '—'); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    res.json({ data: { from, to, total: rows.length, byOutcome: count('outcome'), byUser: count('bitrixUserId'), rows: rows.slice(0, 500) } });
  } catch (e) { next(e); }
});

module.exports = router;

// Маршрут /backfill-lead-offices удалён: он импортировал backfillLeadOffices,
// которой в services/syncTasks.js нет уже давно (там на её месте комментарий
// «Backfill function removed»). Любой вызов падал с
// TypeError: backfillLeadOffices is not a function.
