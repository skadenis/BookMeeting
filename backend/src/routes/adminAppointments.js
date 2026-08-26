const { Router } = require('express');
const { query, param, body, validationResult } = require('express-validator');
const { models, Op, Sequelize } = require('../lib/db');
const { markLocalStatusChange } = require('../services/localStatusGuard');
const { adminAuthMiddleware, requireRole } = require('../middleware/adminAuth');
const { recordAppointmentChange, snapshot } = require('../services/appointmentHistory');
const { assertSlotBookable, BookingError } = require('../services/bookingGuard');
const { invalidateSlotsCache } = require('../services/slotsService');
const { broadcastSlotsUpdated, broadcastAppointmentUpdated } = require('../lib/ws');
const dayjs = require('dayjs');
const axios = require('axios');
const { fetchAndAnalyzeBitrixLeads } = require('../services/syncTasks');

const router = Router();

// Middleware для проверки админских прав.
// Раньше проверялась только подпись JWT: роль в payload была, но её никто
// не смотрел, и учётка с ролью viewer могла удалять встречи.
router.use(adminAuthMiddleware);
const canEdit = requireRole('editor');
const canAdmin = requireRole('admin');

// Получить все встречи с фильтрами
router.get('/', [
  query('start_date').optional().isISO8601(),
  query('end_date').optional().isISO8601(),
  query('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
  query('office_id').optional().isUUID(),
  query('search').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 100 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      start_date,
      end_date,
      status,
      office_id,
      search,
      page = 1,
      pageSize = 20
    } = req.query;
    
    // Базовые условия
    const where = {};
    
    // Фильтр по датам: строго уважаем выбранный период, без подмены границ
    const today = dayjs().format('YYYY-MM-DD');
    if (start_date && end_date) {
      where.date = { [Op.between]: [start_date, end_date] };
    } else if (start_date) {
      where.date = { [Op.gte]: start_date };
    } else if (end_date) {
      where.date = { [Op.lte]: end_date };
    } else {
      // По умолчанию: с сегодняшнего дня
      where.date = { [Op.gte]: today };
    }
    
    // Фильтр по статусу
    if (status) {
      where.status = status;
    }
    
    // Фильтр по офису
    if (office_id) {
      where.office_id = office_id;
    }
    
    // Поиск по ID лида, сделки или контакта
    if (search) {
      const searchConditions = [];
      
      // Поиск по ID лида
      if (!isNaN(search)) {
        searchConditions.push(
          { bitrix_lead_id: Number(search) },
          { bitrix_deal_id: Number(search) },
          { bitrix_contact_id: Number(search) }
        );
      }
      
      // Поиск по тексту (можно расширить)
      if (searchConditions.length > 0) {
        where[Op.or] = searchConditions;
      }
    }

    // Получаем общее количество записей
    const totalCount = await models.Appointment.count({ where });

    // Получаем встречи с включением офиса и пагинацией
    const offset = (page - 1) * pageSize;
    const appointments = await models.Appointment.findAll({
      where,
      include: [
        {
          model: models.Office,
          attributes: ['id', 'city', 'address', 'addressNote']
        }
      ],
      order: [
        ['date', 'ASC'],
        ['timeSlot', 'ASC']
      ],
      limit: parseInt(pageSize),
      offset: offset
    });

    res.json({
      data: appointments,
      meta: {
        total: totalCount,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil(totalCount / pageSize),
        filters: { start_date, end_date, status, office_id, search }
      }
    });

  } catch (e) { 
    next(e); 
  }
});

// Получить конкретную встречу
router.get('/:id', [
  param('id').isUUID()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    
    const appointment = await models.Appointment.findByPk(id, {
      include: [
        { 
          model: models.Office,
          attributes: ['id', 'city', 'address', 'addressNote']
        }
      ]
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Встреча не найдена' });
    }

    res.json({ data: appointment });

  } catch (e) { 
    next(e); 
  }
});

// Обновить встречу
// Place BULK endpoints BEFORE parametric ':id' routes to avoid '/bulk' being treated as ':id'
// Bulk создание встреч для импорта из Bitrix24
router.post('/bulk', canEdit, [
  body('appointments').isArray({ min: 1 }),
  body('appointments.*.bitrix_lead_id').isString(),
  body('appointments.*.office_id').isUUID(),
  body('appointments.*.date').isISO8601(),
  body('appointments.*.timeSlot').isString(),
  body('appointments.*.status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { appointments } = req.body;
    console.log(`Starting bulk creation of ${appointments.length} appointments`);

    // Обрабатываем по частям, чтобы избежать таймаутов и не создавать дубликаты
    const batchSize = 50;
    const createdAppointments = [];
    const updatedAppointments = [];
    let processed = 0;

    for (let i = 0; i < appointments.length; i += batchSize) {
      const batch = appointments.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(appointments.length / batchSize)} (${batch.length} items)`);

      try {
        for (const apt of batch) {
          // Проверяем наличие дубликата по ключу (lead, office, date, time)
          const existing = await models.Appointment.findOne({
            where: {
              bitrix_lead_id: apt.bitrix_lead_id,
              office_id: apt.office_id,
              date: apt.date,
              timeSlot: apt.timeSlot
            }
          });

          if (existing) {
            // Обновим статус при необходимости (не трогаем прочие поля)
            const newStatus = apt.status || 'pending';
            if (newStatus && existing.status !== newStatus) {
              existing.status = newStatus;
              await existing.save();
              updatedAppointments.push(existing);
            }
          } else {
            const created = await models.Appointment.create({
              bitrix_lead_id: apt.bitrix_lead_id,
              office_id: apt.office_id,
              date: apt.date,
              timeSlot: apt.timeSlot,
              status: apt.status || 'pending',
              createdBy: 0
            });
            createdAppointments.push(created);
          }
          processed++;
        }
        console.log(`Batch complete: ${processed}/${appointments.length} processed`);
      } catch (batchError) {
        console.error('Error in batch:', batchError);
      }
    }

    console.log(`Bulk creation complete: ${createdAppointments.length} created, ${updatedAppointments.length} updated`);
    res.json({
      data: { created: createdAppointments.length, updated: updatedAppointments.length },
      message: `Создано ${createdAppointments.length}, обновлено ${updatedAppointments.length}`
    });

  } catch (e) {
    console.error('Bulk creation error:', e);
    next(e);
  }
});

// Bulk обновление встреч для синхронизации из Bitrix24
router.put('/bulk', canEdit, [
  body('appointments').isArray({ min: 1 }),
  body('appointments.*.id').isUUID(),
  body('appointments.*.date').optional().isISO8601(),
  body('appointments.*.timeSlot').optional().isString(),
  body('appointments.*.status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { appointments } = req.body;
    console.log(`Starting bulk update of ${appointments.length} appointments`);

    const updatedAppointments = [];
    const batchSize = 50;
    let processed = 0;

    // Обрабатываем по частям
    for (let i = 0; i < appointments.length; i += batchSize) {
      const batch = appointments.slice(i, i + batchSize);
      console.log(`Processing update batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(appointments.length / batchSize)} (${batch.length} items)`);

      const batchPromises = batch.map(async (apt) => {
        try {
          const appointment = await models.Appointment.findByPk(apt.id);
          if (appointment) {
            if (apt.date !== undefined) appointment.date = apt.date;
            if (apt.timeSlot !== undefined) appointment.timeSlot = apt.timeSlot;
            if (apt.status !== undefined) appointment.status = apt.status;
            await appointment.save();
            return appointment;
          }
          return null;
        } catch (error) {
          console.error('Error updating appointment:', apt.id, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter(result => result !== null);
      updatedAppointments.push(...validResults);

      processed += batch.length;
      console.log(`Update batch complete: ${processed}/${appointments.length} processed, ${validResults.length} updated`);
    }

    console.log(`Bulk update complete: ${updatedAppointments.length} appointments updated`);
    res.json({
      data: updatedAppointments,
      message: `Обновлено ${updatedAppointments.length} встреч`
    });

  } catch (e) {
    console.error('Bulk update error:', e);
    next(e);
  }
});

// Синхронизация и авто-истечение сами проставляют completed/no_show, а UI их
// показывает — но валидатор их не принимал, и ошибочную неявку нельзя было
// исправить через интерфейс.
const ADMIN_SETTABLE_STATUSES = ['pending', 'confirmed', 'cancelled', 'rescheduled', 'completed', 'no_show'];

router.put('/:id', canEdit, [
  param('id').isUUID(),
  body('status').optional().isIn(ADMIN_SETTABLE_STATUSES),
  body('date').optional().isISO8601(),
  body('time_slot').optional().isString(),
  body('office_id').optional().isUUID(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { status, date, time_slot, office_id } = req.body;
    
    const appointment = await models.Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({ error: 'Встреча не найдена' });
    }

    const before = snapshot(appointment);
    const prevOfficeId = appointment.office_id;
    const prevDate = appointment.date;

    // Проверяем, изменяется ли дата или время
    const isDateChanged = date !== undefined && new Date(date).toISOString().split('T')[0] !== appointment.date;
    const isTimeSlotChanged = time_slot !== undefined && time_slot !== appointment.timeSlot;

    // Если изменяется дата или время, и статус не был явно установлен,
    // и текущий статус не является финальным - автоматически устанавливаем rescheduled
    if ((isDateChanged || isTimeSlotChanged) && status === undefined) {
      // Не устанавливаем rescheduled для уже завершенных или отмененных встреч
      if (appointment.status !== 'confirmed' && appointment.status !== 'cancelled') {
        appointment.status = 'rescheduled';
      }
    }

    // Обновляем поля
    if (status !== undefined) appointment.status = status;
    // Срез до YYYY-MM-DD: isISO8601() пропускает полную метку вида
    // 2026-08-27T22:00:00.000Z, которую отдаёт antd DatePicker, и она
    // сохранялась целиком — дата могла сместиться на сутки.
    if (date !== undefined) appointment.date = String(date).slice(0, 10);
    if (time_slot !== undefined) appointment.timeSlot = time_slot;
    if (office_id !== undefined) appointment.office_id = office_id;

    // Снимаем флаг до save(): после сохранения changed() уже сброшен.
    const statusWasChanged = appointment.changed('status') === true;
    const slotChanged = appointment.changed('date') === true
      || appointment.changed('timeSlot') === true
      || appointment.changed('office_id') === true;

    // Перенос из админки — такое же занятие места, как и запись из виджета,
    // и он должен проходить ту же проверку. Раньше новые дата/время
    // присваивались напрямую: перенос был вторым путём к переполнению слота.
    if (slotChanged && !['cancelled', 'no_show'].includes(appointment.status)) {
      try {
        await assertSlotBookable({
          officeId: appointment.office_id,
          date: appointment.date,
          timeSlot: appointment.timeSlot,
          excludeAppointmentId: appointment.id,
          // Админ вправе поставить встречу задним числом и вне горизонта записи
          allowPast: true,
          enforceHorizon: false,
        });
      } catch (guardError) {
        if (guardError instanceof BookingError) {
          return res.status(guardError.status).json({
            error: 'Slot not bookable',
            reason: guardError.reason,
            message: guardError.message,
          });
        }
        throw guardError;
      }
    }

    await appointment.save();

    await recordAppointmentChange({
      appointmentId: appointment.id,
      action: slotChanged ? 'admin_rescheduled' : `admin_status_${appointment.status}`,
      oldValue: before,
      newValue: snapshot(appointment),
      req,
    });

    // Сетка слотов меняется и на старом, и на новом месте
    await invalidateSlotsCache(prevOfficeId, prevDate);
    await invalidateSlotsCache(appointment.office_id, appointment.date);
    broadcastSlotsUpdated(prevOfficeId, prevDate);
    broadcastSlotsUpdated(appointment.office_id, appointment.date);
    broadcastAppointmentUpdated(appointment);

    // Та же защита, что и в операторском маршруте: синхронизация с Bitrix
    // не должна откатывать только что выставленный админом статус.
    if (statusWasChanged) {
      await markLocalStatusChange(appointment.id, appointment.status);
    }

    // Получаем обновленную встречу с офисом
    const updatedAppointment = await models.Appointment.findByPk(id, {
      include: [
        { 
          model: models.Office,
          attributes: ['id', 'city', 'address', 'addressNote']
        }
      ]
    });

    res.json({ data: updatedAppointment });

  } catch (e) { 
    next(e); 
  }
});

// Удалить встречу
router.delete('/:id', canAdmin, [
  param('id').isUUID()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    
    const appointment = await models.Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({ error: 'Встреча не найдена' });
    }

    const before = snapshot(appointment);
    const officeId = appointment.office_id;
    const date = appointment.date;

    // Журнал пишем ДО destroy(): у AppointmentHistory внешний ключ на
    // appointment_id, после удаления встречи запись создать уже нельзя.
    await recordAppointmentChange({
      appointmentId: appointment.id,
      action: 'deleted',
      oldValue: before,
      newValue: null,
      req,
    });

    await appointment.destroy();

    // Освободившееся место должно сразу появиться в сетке
    await invalidateSlotsCache(officeId, date);
    broadcastSlotsUpdated(officeId, date);

    res.json({ message: 'Встреча удалена' });

  } catch (e) { 
    next(e); 
  }
});

// Удалить дубликаты встреч (утилита для админа). Группируем по lead+office+date+timeSlot и оставляем одну, остальные переводим в cancelled и удаляем.
router.post('/dedupe', canAdmin, async (req, res, next) => {
  try {
    const { dry_run } = req.body || {};
    // Получаем все встречи с bitrix_lead_id
    const all = await models.Appointment.findAll({ where: { bitrix_lead_id: { [Op.not]: null } }, order: [['createdAt','ASC']] });
    const keyMap = new Map();
    const toDelete = [];
    for (const a of all) {
      const key = `${a.bitrix_lead_id}__${a.office_id}__${a.date}__${a.timeSlot}`;
      if (!keyMap.has(key)) {
        keyMap.set(key, a);
      } else {
        toDelete.push(a);
      }
    }
    if (!dry_run) {
      for (const d of toDelete) {
        await d.destroy();
      }
    }
    res.json({ data: { duplicates: toDelete.length, dry_run: !!dry_run } });
  } catch (e) { next(e); }
});

// Получить статистику по встречам
router.get('/stats/overview', async (req, res, next) => {
  try {
    const { start_date, end_date, status, office_id, search } = req.query;
    
    // Принудительно показываем только будущие встречи (включая сегодняшние)
    const today = dayjs().format('YYYY-MM-DD');
    
    // Границы периода должны совпадать с GET /: там комментарий прямо говорит
    // «строго уважаем выбранный период». Здесь нижняя граница молча
    // поднималась до сегодняшнего дня, и при фильтре по прошлому периоду
    // карточки статистики не сходились с таблицей на том же экране.
    let where = {};
    if (start_date && end_date) {
      where.date = { [Op.between]: [start_date, end_date] };
    } else if (start_date) {
      where.date = { [Op.gte]: start_date };
    } else if (end_date) {
      where.date = { [Op.lte]: end_date };
    } else {
      where.date = { [Op.gte]: today };
    }

    // Фильтр по статусу
    if (status) where.status = status;

    // Фильтр по офису
    if (office_id) where.office_id = office_id;

    // Поиск по lead/deal/contact ID (числовой)
    if (search && !isNaN(search)) {
      const num = Number(search);
      where[Op.or] = [
        { bitrix_lead_id: num },
        { bitrix_deal_id: num },
        { bitrix_contact_id: num }
      ];
    }

    const stats = await models.Appointment.findAll({
      where,
      attributes: [
        'status',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    const result = {
      total: 0,
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      rescheduled: 0,
      completed: 0,
      no_show: 0,
      expired: 0
    };

    stats.forEach(stat => {
      const count = parseInt(stat.getDataValue('count'));
      result.total += count;
      result[stat.status] = count;
    });

    res.json({ data: result });

  } catch (e) { 
    next(e); 
  }
});

// Синхронизация с Bitrix24
router.get('/sync/bitrix24', async (req, res, next) => {
  try {
    if (!process.env.BITRIX_REST_URL) {
      return res.status(503).json({ error: 'BITRIX_REST_URL is not configured on server' });
    }
    const analysis = await fetchAndAnalyzeBitrixLeads();
    res.json({ data: analysis });

  } catch (e) {
    console.error('Sync complete error:', e);
    if (e.response) {
      // Ошибка от сервера Bitrix24
      const status = Number(e.response.status) || 502;
      const payload = e.response.data || { error: 'Bitrix error' };
      return res.status(502).json({ error: 'Bitrix24 credentials invalid or expired', details: payload });
    } else if (e.code === 'ECONNABORTED') {
      // Таймаут
      console.error('Bitrix24 API timeout')
      return next(new Error('Bitrix24 API request timeout'))
    } else {
      // Другая ошибка
      return next(e)
    }
  }
})

// Здесь были повторные объявления POST /bulk и PUT /bulk (около 120 строк).
// Express отдаёт запрос первому совпавшему обработчику, поэтому вторые версии
// не выполнялись никогда — при этом отличались поведением (bulkCreate без
// проверки дубликатов вместо findOne + create). Удалены.

// Normalize existing appointments that have timeSlot in short form ("HH:MM") to full interval ("HH:MM-HH:MM")
router.post('/normalize-timeslots', canAdmin, [
  body('start_date').optional().isISO8601(),
  body('end_date').optional().isISO8601(),
  body('office_id').optional().isUUID(),
  body('dry_run').optional().isBoolean(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const todayIso = new Date().toISOString().slice(0,10);
    const start = req.body.start_date || todayIso;
    const end = req.body.end_date || new Date(Date.now()+365*24*3600*1000).toISOString().slice(0,10);
    const officeId = req.body.office_id || null;
    const dryRun = !!req.body.dry_run;

    const where = {
      status: ['pending','confirmed'],
      date: { [Op.between]: [start, end] }
    };
    if (officeId) where.office_id = officeId;

    // Only short-form timeslots
    const all = await models.Appointment.findAll({ where });
    const targets = all.filter(a => a && a.timeSlot && !String(a.timeSlot).includes('-'));

    const invalidatePairs = new Set();
    const results = { scanned: all.length, candidates: targets.length, updated: 0, misses: 0 };

    for (const appt of targets) {
      try {
        const startTime = String(appt.timeSlot).slice(0,5);
        const schedule = await models.Schedule.findOne({ where: { office_id: appt.office_id, date: appt.date } });
        if (!schedule) { results.misses++; continue; }
        const slot = await models.Slot.findOne({ where: { schedule_id: schedule.id, start: startTime } });
        if (!slot) { results.misses++; continue; }
        const full = `${slot.start}-${slot.end}`;
        if (!dryRun) {
          appt.timeSlot = full;
          await appt.save();
          invalidatePairs.add(`${appt.office_id}__${appt.date}`);
        }
        results.updated++;
      } catch { results.misses++; }
    }

    if (!dryRun) {
      for (const key of Array.from(invalidatePairs)) {
        const [oid, dt] = key.split('__');
        await require('../services/slotsService').invalidateSlotsCache(oid, dt);
        const { broadcastSlotsUpdated } = require('../lib/ws');
        broadcastSlotsUpdated(oid, dt);
      }
    }

    res.json({ ok: true, range: { start, end }, office_id: officeId, dry_run: dryRun, ...results });
  } catch (e) { next(e); }
});

module.exports = router;
