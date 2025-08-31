const { Router } = require('express');
const { models, Op } = require('../lib/db');
const { adminAuthMiddleware } = require('../middleware/adminAuth');
const dayjs = require('dayjs');
const axios = require('axios');

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
    console.log('Starting automatic status sync with Bitrix24...');

    // Получаем все встречи с bitrix_lead_id, которые не в финальном статусе
    const appointmentsToCheck = await models.Appointment.findAll({
      where: {
        bitrix_lead_id: { [Op.not]: null },
        status: { [Op.in]: ['pending', 'confirmed', 'rescheduled'] }, // Только активные статусы
        date: { [Op.gte]: dayjs().subtract(7, 'days').format('YYYY-MM-DD') } // За последние 7 дней
      },
      include: [{ model: models.Office, attributes: ['city', 'address'] }]
    });

    console.log(`Found ${appointmentsToCheck.length} appointments to check`);

    if (appointmentsToCheck.length === 0) {
      return res.json({
        data: {
          checked: 0,
          updated: 0,
          expired: 0,
          message: 'Нет встреч для проверки'
        }
      });
    }

    // Получаем уникальные lead_id для запроса в Bitrix24
    const leadIds = [...new Set(appointmentsToCheck.map(a => a.bitrix_lead_id))];
    console.log(`Checking ${leadIds.length} unique leads in Bitrix24`);

    // Запрашиваем статусы лидов из Bitrix24 — по одному lead'у (устойчивее, но больше запросов)
    const leadStatusMap = {};
    for (const id of leadIds) {
      try {
        const response = await axios.post('https://bitrix24.newhc.by/rest/15/qseod599og9fc16a/crm.lead.get', {
          id: Number(id)
        }, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' }
        });
        const statusId = response?.data?.result?.STATUS_ID;
        leadStatusMap[id] = BITRIX_STATUS_MAPPING[statusId] || (statusId ?? null);
      } catch (error) {
        console.error(`Error fetching lead ${id}:`, error.message);
      }
      // Небольшая пауза, чтобы не задушить Bitrix
      await new Promise(r => setTimeout(r, 100));
    }

    let updatedCount = 0;
    let noShowCount = 0;

    // Обновляем статусы встреч
    for (const appointment of appointmentsToCheck) {
      const leadId = appointment.bitrix_lead_id;
      const newStatus = leadStatusMap[leadId];

      // Проверяем, прошла ли встреча
      const appointmentDateTime = dayjs(`${appointment.date} ${appointment.timeSlot?.split('-')[1] || '23:59'}`);
      const isPastDue = appointmentDateTime.isBefore(dayjs().subtract(2, 'hours')); // 2 часа буфер

      // Если статус в Bitrix один из "рабочих" — маппим и обновляем
      if (newStatus && ['pending','confirmed','completed','no_show','cancelled','rescheduled'].includes(newStatus) && newStatus !== appointment.status) {
        // Статус изменился в Bitrix24 (включая CONVERTED -> completed)
        await appointment.update({ status: newStatus });
        updatedCount++;
        console.log(`Updated appointment ${appointment.id}: ${appointment.status} -> ${newStatus}`);
      } else if (
        // Если Bitrix вернул другой статус (не из 2,37,CONVERTED) — считаем отменой
        newStatus && !['pending','confirmed','completed','no_show','cancelled','rescheduled'].includes(newStatus)
      ) {
        await appointment.update({ status: 'cancelled' });
        updatedCount++;
        console.log(`Cancelled appointment ${appointment.id} due to external status: ${newStatus}`);
      } else if (isPastDue && ['pending', 'confirmed', 'rescheduled'].includes(appointment.status)) {
        // Встреча прошла, а в Bitrix нет признака завершения → считаем как неявку
        await appointment.update({ status: 'no_show' });
        noShowCount++;
        console.log(`Marked appointment ${appointment.id} as no_show (past due without conversion)`);
      }
    }

    console.log(`Status sync complete: ${updatedCount} updated, ${noShowCount} marked as no_show`);

    res.json({
      data: {
        checked: appointmentsToCheck.length,
        updated: updatedCount,
        no_show: noShowCount,
        message: `Проверено ${appointmentsToCheck.length} встреч, обновлено ${updatedCount}, неявок ${noShowCount}`
      }
    });

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
    console.log('Starting automatic appointment expiration...');

    // Находим встречи, которые прошли более 2 часов назад и еще в статусе pending/confirmed
    const cutoffTime = dayjs().subtract(2, 'hours');
    
    const expiredAppointments = await models.Appointment.findAll({
      where: {
        status: { [Op.in]: ['pending', 'confirmed'] },
        [Op.and]: [
          models.Appointment.sequelize.where(
            models.Appointment.sequelize.fn(
              'CONCAT',
              models.Appointment.sequelize.col('date'),
              ' ',
              models.Appointment.sequelize.fn(
                'SPLIT_PART',
                models.Appointment.sequelize.col('timeSlot'),
                '-',
                2
              )
            ),
            { [Op.lt]: cutoffTime.format('YYYY-MM-DD HH:mm') }
          )
        ]
      }
    });

    console.log(`Found ${expiredAppointments.length} expired appointments`);

    let expiredCount = 0;
    for (const appointment of expiredAppointments) {
      await appointment.update({ status: 'expired' });
      expiredCount++;
    }

    console.log(`Expired ${expiredCount} appointments`);

    res.json({
      data: {
        checked: expiredAppointments.length,
        expired: expiredCount,
        message: `Помечено как просроченные: ${expiredCount} встреч`
      }
    });

  } catch (e) {
    console.error('Auto expire error:', e);
    next(e);
  }
});

module.exports = router;
