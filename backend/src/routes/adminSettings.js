const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { models } = require('../lib/db');
const { adminAuthMiddleware } = require('../middleware/adminAuth');

const router = Router();

// Middleware для проверки админских прав
router.use(adminAuthMiddleware);

// Получить настройки системы
router.get('/', async (req, res, next) => {
  try {
    // Получаем все настройки из базы данных
    const settings = await models.Setting.findAll();
    
    // Преобразуем в удобный формат
    const settingsData = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    // Устанавливаем значения по умолчанию, если настройки не найдены
    const defaultSettings = {
      max_booking_days: 7,
      ...settingsData
    };

    res.json({ data: defaultSettings });
  } catch (e) {
    console.error('Get settings error:', e);
    next(e);
  }
});

// Обновить настройки системы
router.put('/', [
  body('max_booking_days').isInt({ min: 1, max: 365 }).withMessage('Период записи должен быть от 1 до 365 дней'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { max_booking_days } = req.body;

    // Обновляем или создаем настройку max_booking_days
    await models.Setting.upsert({
      key: 'max_booking_days',
      value: max_booking_days,
      description: 'Максимальное количество дней вперед для записи операторами'
    });

    console.log(`Settings updated: max_booking_days = ${max_booking_days}`);

    res.json({
      data: { max_booking_days },
      message: 'Настройки обновлены'
    });

  } catch (e) {
    console.error('Update settings error:', e);
    next(e);
  }
});

// Получить публичные настройки (для операторов)
router.get('/public', async (req, res, next) => {
  try {
    const settings = await models.Setting.findAll({
      where: {
        key: ['max_booking_days']
      }
    });
    
    const settingsData = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    // Значения по умолчанию
    const publicSettings = {
      max_booking_days: settingsData.max_booking_days || 7
    };

    res.json({ data: publicSettings });
  } catch (e) {
    console.error('Get public settings error:', e);
    next(e);
  }
});

module.exports = router;
