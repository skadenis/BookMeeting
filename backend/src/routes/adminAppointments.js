const { Router } = require('express');
const { query, param, body, validationResult } = require('express-validator');
const { models, Op, Sequelize } = require('../lib/db');
const { adminAuthMiddleware } = require('../middleware/adminAuth');
const dayjs = require('dayjs');

const router = Router();

// Middleware для проверки админских прав
router.use(adminAuthMiddleware);

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
    
    // Фильтр по датам
    if (start_date && end_date) {
      where.date = {
        [Op.between]: [start_date, end_date]
      };
    } else if (start_date) {
      where.date = {
        [Op.gte]: start_date
      };
    } else if (end_date) {
      where.date = {
        [Op.lte]: end_date
      };
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
router.put('/:id', [
  param('id').isUUID(),
  body('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'rescheduled']),
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
    if (date !== undefined) appointment.date = date;
    if (time_slot !== undefined) appointment.timeSlot = time_slot;
    if (office_id !== undefined) appointment.office_id = office_id;

    await appointment.save();

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
router.delete('/:id', [
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

    await appointment.destroy();

    res.json({ message: 'Встреча удалена' });

  } catch (e) { 
    next(e); 
  }
});

// Получить статистику по встречам
router.get('/stats/overview', async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;
    
    let where = {};
    if (start_date && end_date) {
      where.date = {
        [Op.between]: [start_date, end_date]
      };
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
      rescheduled: 0
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
    console.log('Starting Bitrix24 sync...')
    const allLeads = []
    let start = 0
    let pageCount = 0

    while (true) {
      console.log(`Fetching page ${pageCount + 1}, start: ${start}`)
      const response = await fetch('https://bitrix24.newhc.by/rest/15/qseod599og9fc16a/crm.lead.list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          "SELECT": ["ID", "UF_CRM_1675255265", "UF_CRM_1725445029", "UF_CRM_1725483092", "UF_CRM_1655460588", "UF_CRM_1657019494", "STATUS_ID"],
          "FILTER": {
            "STATUS_ID": [2, 37] // 2 - встреча назначена, 37 - встреча подтверждена
          },
          "start": start
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Bitrix24 API error:', response.status, errorText)
        throw new Error(`Bitrix24 API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      console.log(`Received ${data.result ? data.result.length : 0} leads from Bitrix24`)

      if (data.result && data.result.length > 0) {
        allLeads.push(...data.result)
        pageCount++

        if (data.next) {
          start = data.next
        } else {
          break
        }
      } else {
        break
      }

      // Защита от бесконечного цикла
      if (pageCount > 100) {
        console.warn('Too many pages, stopping sync')
        break
      }
    }

    console.log(`Total leads fetched: ${allLeads.length}`)

    // Получаем все существующие встречи из нашей системы
    console.log('Fetching existing appointments from database...')
    const existingAppointments = await models.Appointment.findAll({
      attributes: ['id', 'bitrix_lead_id', 'status', 'date', 'timeSlot']
    })
    console.log(`Found ${existingAppointments.length} existing appointments`)

    // Создаем мап статусов Bitrix24 -> наша система
    const statusMapping = {
      '2': 'pending',      // встреча назначена
      '37': 'confirmed'    // встреча подтверждена
    }

    // Анализируем каждый лид из Bitrix24
    const toCreate = []    // Новые встречи для создания
    const toUpdate = []    // Существующие встречи для обновления
    const existingLeadMap = new Map()

    // Создаем мап существующих лидов для быстрого поиска
    existingAppointments.forEach(app => {
      if (app.bitrix_lead_id) {
        existingLeadMap.set(app.bitrix_lead_id, app)
      }
    })

    console.log('Analyzing leads...')
    // Обрабатываем каждый лид из Bitrix24
    allLeads.forEach(lead => {
      try {
        const existingAppointment = existingLeadMap.get(lead.ID)
        const bitrixStatus = statusMapping[lead.STATUS_ID] || 'pending'

        if (!existingAppointment) {
          // Лида нет в нашей системе - нужно создать
          toCreate.push({
            bitrix_lead_id: lead.ID,
            office_id: lead.UF_CRM_1675255265,
            date: dayjs(lead.UF_CRM_1655460588).format('YYYY-MM-DD'),
            timeSlot: lead.UF_CRM_1657019494,
            status: bitrixStatus
          })
        } else {
          // Лид есть в нашей системе - проверяем статус и данные
          const leadDate = dayjs(lead.UF_CRM_1655460588).format('YYYY-MM-DD')
          const needsUpdate = (
            existingAppointment.status !== bitrixStatus ||
            existingAppointment.date !== leadDate ||
            existingAppointment.timeSlot !== lead.UF_CRM_1657019494
          )

          if (needsUpdate) {
            toUpdate.push({
              id: existingAppointment.id,
              bitrix_lead_id: lead.ID,
              office_id: lead.UF_CRM_1675255265,
              date: leadDate,
              timeSlot: lead.UF_CRM_1657019494,
              status: bitrixStatus,
              currentStatus: existingAppointment.status,
              currentDate: existingAppointment.date,
              currentTime: existingAppointment.timeSlot
            })
          }
        }
      } catch (error) {
        console.error('Error processing lead:', lead.ID, error)
      }
    })

    console.log(`Analysis complete: ${toCreate.length} to create, ${toUpdate.length} to update`)

    // Группируем по офисам для удобства отображения
    console.log('Grouping appointments by office...')
    const groupedToCreate = toCreate.reduce((acc, lead) => {
      try {
        const officeId = lead.office_id || 'unknown'
        if (!acc[officeId]) {
          acc[officeId] = []
        }
        acc[officeId].push(lead)
      } catch (error) {
        console.error('Error grouping lead for creation:', lead, error)
      }
      return acc
    }, {})

    const groupedToUpdate = toUpdate.reduce((acc, lead) => {
      try {
        const officeId = lead.office_id || 'unknown'
        if (!acc[officeId]) {
          acc[officeId] = []
        }
        acc[officeId].push(lead)
      } catch (error) {
        console.error('Error grouping lead for update:', lead, error)
      }
      return acc
    }, {})

    const createList = Object.entries(groupedToCreate).map(([officeId, leads]) => ({
      officeId,
      leads,
      count: leads.length,
      type: 'create'
    }))

    const updateList = Object.entries(groupedToUpdate).map(([officeId, leads]) => ({
      officeId,
      leads,
      count: leads.length,
      type: 'update'
    }))

    console.log(`Sync complete: ${createList.length} office groups to create, ${updateList.length} office groups to update`)

    res.json({
      data: {
        totalBitrixLeads: allLeads.length,
        toCreate: createList,
        toUpdate: updateList,
        createCount: toCreate.length,
        updateCount: toUpdate.length,
        allLeads: allLeads
      }
    })

  } catch (e) {
    next(e)
  }
})

// Bulk создание встреч для импорта из Bitrix24
router.post('/bulk', [
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

    // Обрабатываем по частям, чтобы избежать таймаутов
    const batchSize = 50;
    const createdAppointments = [];
    let processed = 0;

    for (let i = 0; i < appointments.length; i += batchSize) {
      const batch = appointments.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(appointments.length / batchSize)} (${batch.length} items)`);

      try {
        const batchResults = await models.Appointment.bulkCreate(
          batch.map(apt => ({
            bitrix_lead_id: apt.bitrix_lead_id,
            office_id: apt.office_id,
            date: apt.date,
            timeSlot: apt.timeSlot,
            status: apt.status || 'pending',
            createdBy: 0 // Системный пользователь
          }))
        );
        createdAppointments.push(...batchResults);
        processed += batch.length;
        console.log(`Batch complete: ${processed}/${appointments.length} processed`);
      } catch (batchError) {
        console.error('Error in batch:', batchError);
        // Продолжаем с следующей партией, но логируем ошибку
      }
    }

    console.log(`Bulk creation complete: ${createdAppointments.length} appointments created`);
    res.json({
      data: createdAppointments,
      message: `Создано ${createdAppointments.length} встреч`
    });

  } catch (e) {
    console.error('Bulk creation error:', e);
    next(e);
  }
});

// Bulk обновление встреч для синхронизации из Bitrix24
router.put('/bulk', [
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

module.exports = router;
