// Интеграционные тесты публичного контура на реальном приложении.
//
// Проверяются ровно те дыры, которые были найдены аудитом: обход авторизации,
// запись мимо ограничений слота, изменение чужой встречи и открытые на запись
// справочники. Приложение поднимается настоящее (createApp), маршруты не
// подменяются заглушками.

process.env.NODE_ENV = 'test';
process.env.BITRIX_DEV_MODE = 'false';
process.env.PUBLIC_TOKEN_PAIRS = 'widget-test:secret-test';
process.env.BITRIX_ALLOWED_DOMAINS = 'portal.example.by';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.ENABLE_CRON = 'false';

// Bitrix наружу не дёргаем: без мока axios уходил в реальную сеть и висел
// на таймауте 10 с, а jest не завершался из-за открытых сокетов.
jest.mock('axios');

const request = require('supertest');
const axios = require('axios');
const { createApp } = require('../../src/index');
const { resetDatabase, closeDatabase, seedSchedule, models } = require('../helpers/db');

const WIDGET = { 'X-App-Id': 'widget-test', 'X-App-Token': 'secret-test' };
const LEAD_ID = 12345;

// Дата заведомо в будущем, но в пределах горизонта записи (по умолчанию 7 дней)
function futureDate(daysAhead = 2) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

let app;

beforeAll(async () => {
  await resetDatabase();
  app = createApp();
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: { result: {} } });
  await models.Appointment.destroy({ where: {}, truncate: true, cascade: true });
  await models.Slot.destroy({ where: {}, truncate: true, cascade: true });
  await models.Schedule.destroy({ where: {}, truncate: true, cascade: true });
  await models.Office.destroy({ where: {}, truncate: true, cascade: true });
});

describe('bitrixAuth: обход авторизации', () => {
  it('отклоняет запрос без учётных данных', async () => {
    await request(app).get('/api/offices').expect(401);
  });

  it('отклоняет НЕВЕРНУЮ пару X-App-Id/X-App-Token', async () => {
    // Ветка «на всякий случай» повторяла условие проверки пары, но уже без
    // сверки секрета, и пропускала любые значения заголовков.
    await request(app)
      .get('/api/offices')
      .set({ 'X-App-Id': 'widget-test', 'X-App-Token': 'wrong-secret' })
      .expect(401);
  });

  it('не пускает по заголовку Upgrade: websocket', async () => {
    // Заголовок задаётся клиентом произвольно и раньше полностью обходил проверку
    await request(app)
      .get('/api/offices')
      .set('Upgrade', 'websocket')
      .expect(401);
  });

  it('не пускает по одному лишь параметру domain', async () => {
    // Проверка токена была помечена TODO: хватало ?domain=что-угодно
    await request(app).get('/api/offices?domain=evil.example.com').expect((res) => {
      if (res.status === 200) throw new Error('запрос прошёл без валидного токена');
    });
  });

  it('пропускает корректную пару токенов виджета', async () => {
    await request(app).get('/api/offices').set(WIDGET).expect(200);
  });
});

describe('публичный контур доступен только на чтение', () => {
  it('запрещает создание офиса через /api/offices', async () => {
    // Роутеры офисов/шаблонов/слотов монтировались вторично под /api,
    // где стоял только bitrixAuth: DELETE /api/offices/:id был открыт наружу
    await request(app)
      .post('/api/offices')
      .set(WIDGET)
      .send({ city: 'Минск', address: 'взлом' })
      .expect(403);
  });

  it('запрещает удаление офиса через /api/offices/:id', async () => {
    const { office } = await seedSchedule({ date: futureDate() });
    await request(app).delete(`/api/offices/${office.id}`).set(WIDGET).expect(403);
    expect(await models.Office.count()).toBe(1);
  });

  it('запрещает применение шаблона через /api/templates', async () => {
    await request(app)
      .post('/api/templates/00000000-0000-0000-0000-000000000000/apply')
      .set(WIDGET)
      .send({ office_id: '00000000-0000-0000-0000-000000000000', start_date: futureDate(), end_date: futureDate(3) })
      .expect(403);
  });

  it('запрещает закрытие дня через /api/slots', async () => {
    const { office } = await seedSchedule({ date: futureDate() });
    await request(app)
      .post('/api/slots/close-day')
      .set(WIDGET)
      .send({ office_id: office.id, date: futureDate() })
      .expect(403);
  });

  it('удалённые мутирующие GET-эндпоинты больше не отвечают', async () => {
    for (const url of ['/api/slots/fix-slot?slot_id=1&capacity=99', '/api/slots/_routes', '/api/custom/manage']) {
      const res = await request(app).get(url).set(WIDGET);
      expect(res.status).toBe(404);
    }
  });
});

describe('создание встречи: проверка слота', () => {
  it('создаёт встречу в существующем свободном слоте', async () => {
    const date = futureDate();
    const { office, timeSlot } = await seedSchedule({ date, capacity: 1 });

    const res = await request(app)
      .post('/api/appointments')
      .set(WIDGET)
      .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID })
      .expect(201);

    expect(res.body.data.status).toBe('pending');
    expect(String(res.body.data.bitrix_lead_id)).toBe(String(LEAD_ID));
  });

  it('отказывает, когда слот заполнен', async () => {
    // Проверки вместимости на сервере не было вообще: овербукинг был неограничен
    const date = futureDate();
    const { office, timeSlot } = await seedSchedule({ date, capacity: 1 });

    await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID }).expect(201);

    const res = await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID + 1 }).expect(400);

    expect(res.body.reason).toBe('slot_full');
    expect(await models.Appointment.count({ where: { status: 'pending' } })).toBe(1);
  });

  it('отказывает для несуществующего слота', async () => {
    const date = futureDate();
    const { office } = await seedSchedule({ date });

    const res = await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: '03:00-03:30', lead_id: LEAD_ID }).expect(400);

    expect(res.body.reason).toBe('no_slot');
  });

  it('отказывает для даты в прошлом', async () => {
    const date = '2020-01-01';
    const { office, timeSlot } = await seedSchedule({ date });

    const res = await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID }).expect(400);

    expect(res.body.reason).toBe('slot_in_past');
  });

  it('отказывает за горизонтом записи', async () => {
    const date = futureDate(60);
    const { office, timeSlot } = await seedSchedule({ date });

    const res = await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID }).expect(400);

    expect(res.body.reason).toBe('beyond_horizon');
  });

  it('отказывает, когда день помечен нерабочим', async () => {
    const date = futureDate();
    const { office, schedule, timeSlot } = await seedSchedule({ date });
    await schedule.update({ isWorkingDay: false });

    const res = await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID }).expect(400);

    expect(res.body.reason).toBe('day_closed');
  });

  it('не занимает место при параллельных запросах сверх вместимости', async () => {
    // Без транзакции с блокировкой слота два одновременных бронирования
    // прочитали бы одну и ту же занятость и оба прошли бы
    const date = futureDate();
    const { office, timeSlot } = await seedSchedule({ date, capacity: 2 });

    const results = await Promise.all([1, 2, 3, 4, 5].map((i) =>
      request(app).post('/api/appointments').set(WIDGET)
        .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID + i })
    ));

    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBe(2);
    expect(await models.Appointment.count({ where: { status: 'pending' } })).toBe(2);
  });
});

describe('изменение встречи: принадлежность лиду', () => {
  async function createAppointment() {
    const date = futureDate();
    const { office, timeSlot } = await seedSchedule({ date, capacity: 5 });
    const res = await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: timeSlot, lead_id: LEAD_ID }).expect(201);
    return { id: res.body.data.id, office, date, timeSlot };
  }

  it('позволяет владельцу лида отменить свою встречу', async () => {
    const { id } = await createAppointment();
    await request(app).put(`/api/appointments/${id}?lead_id=${LEAD_ID}`).set(WIDGET)
      .send({ status: 'cancelled' }).expect(200);

    const appt = await models.Appointment.findByPk(id);
    expect(appt.status).toBe('cancelled');
  });

  it('не даёт изменить встречу чужого лида', async () => {
    // Раньше проверки принадлежности не было: хватало знать UUID встречи
    const { id } = await createAppointment();
    await request(app).put(`/api/appointments/${id}?lead_id=999999`).set(WIDGET)
      .send({ status: 'cancelled' }).expect(404);

    const appt = await models.Appointment.findByPk(id);
    expect(appt.status).toBe('pending');
  });

  it('не даёт изменить встречу без контекста лида', async () => {
    const { id } = await createAppointment();
    await request(app).put(`/api/appointments/${id}`).set(WIDGET)
      .send({ status: 'cancelled' }).expect(404);
  });

  it('не даёт перенести встречу в заполненный слот', async () => {
    const date = futureDate();
    const { office } = await seedSchedule({ date, capacity: 5 });
    const full = await models.Slot.create({
      schedule_id: (await models.Schedule.findOne({ where: { office_id: office.id, date } })).id,
      start: '11:00', end: '11:30', available: true, capacity: 1,
    });

    const mine = await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: '10:00-10:30', lead_id: LEAD_ID }).expect(201);
    await request(app).post('/api/appointments').set(WIDGET)
      .send({ office_id: office.id, date, time_slot: '11:00-11:30', lead_id: LEAD_ID + 1 }).expect(201);

    const res = await request(app).put(`/api/appointments/${mine.body.data.id}?lead_id=${LEAD_ID}`).set(WIDGET)
      .send({ date, time_slot: `${full.start}-${full.end}` }).expect(400);
    expect(res.body.reason).toBe('slot_full');
  });
});

describe('карточка лида из Bitrix', () => {
  it('отдаёт только разрешённые поля, без сырого ответа Bitrix', async () => {
    // Маршрут возвращал весь объект лида плюс raw: response.data —
    // ФИО, телефоны и комментарии любого лида по его ID
    axios.post.mockResolvedValue({
      data: { result: { ID: LEAD_ID, TITLE: 'Иванов Иван', PHONE: [{ VALUE: '+375291234567' }], UF_CRM_1675255265: 777 } },
    });

    const res = await request(app).get(`/api/bitrix/lead?id=${LEAD_ID}`).set(WIDGET).expect(200);

    expect(res.body).not.toHaveProperty('raw');
    expect(res.body.lead).not.toHaveProperty('TITLE');
    expect(res.body.lead).not.toHaveProperty('PHONE');
    expect(res.body.lead.UF_CRM_1675255265).toBe(777);
  });

  it('отклоняет домен вне белого списка (SSRF)', async () => {
    const res = await request(app)
      .get('/api/bitrix/lead-id?AUTH_ID=token&domain=attacker.example.com')
      .set(WIDGET);
    expect(res.status).toBe(403);
  });
});
