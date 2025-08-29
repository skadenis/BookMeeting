const { Router } = require('express');
const { query, param, body, validationResult } = require('express-validator');
const { models, Op, Sequelize } = require('../lib/db');
const { adminAuthMiddleware } = require('../middleware/adminAuth');

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
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { start_date, end_date, status, office_id, search } = req.query;
    
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

    // Получаем встречи с включением офиса
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
      ]
    });

    res.json({ 
      data: appointments,
      meta: {
        total: appointments.length,
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

module.exports = router;
