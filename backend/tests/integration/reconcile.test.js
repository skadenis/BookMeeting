// События Битрикса, суточная сверка, продление расписания, учёт назначений
// мимо сетки и журнал — на настоящем приложении и настоящем Postgres.
// Битрикс подменяется: axios отвечает по имени метода REST.

process.env.NODE_ENV = 'test';
process.env.BITRIX_DEV_MODE = 'false';
process.env.PUBLIC_TOKEN_PAIRS = 'widget-test:secret-test';
process.env.ENABLE_CRON = 'false';
process.env.BITRIX_EVENTS_TOKEN = 'hook-secret';

jest.mock('axios');

const request = require('supertest');
const axios = require('axios');
const { createApp } = require('../../src/index');
const { resetDatabase, closeDatabase, models } = require('../helpers/db');
const events = require('../../src/services/bitrixEvents');
const { reconcileRecentAppointments } = require('../../src/services/reconcile');
const { rollForwardSchedules } = require('../../src/services/scheduleRollForward');
const { businessToday } = require('../../src/lib/time');

const TODAY = businessToday();
const day = (n) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ru = (iso) => iso.split('-').reverse().join('.');

// Состояние «портала»
let bx;
function resetBitrix() {
  bx = { leads: {}, deals: {}, dealListFails: false, calls: [] };
}
axios.post.mockImplementation(async (url, params) => {
  const method = String(url).split('/').pop();
  bx.calls.push({ method, params });
  if (method === 'crm.lead.get') {
    const lead = bx.leads[params.id];
    if (!lead) { const e = new Error('Not found'); e.response = { status: 400, data: { error: '', error_description: 'Not found' } }; throw e; }
    return { data: { result: { ID: String(params.id), ...lead } } };
  }
  if (method === 'crm.lead.list') {
    const ids = (params.filter?.ID || []).map(Number);
    return { data: { result: ids.filter((id) => bx.leads[id]).map((id) => ({ ID: String(id), STATUS_ID: bx.leads[id].STATUS_ID })) } };
  }
  if (method === 'crm.deal.get') {
    const deal = bx.deals[params.id];
    return { data: { result: deal ? { ID: String(params.id), ...deal } : null } };
  }
  if (method === 'crm.deal.list') {
    if (bx.dealListFails) { const e = new Error('Bitrix down'); e.response = { status: 502 }; throw e; }
    const all = Object.entries(bx.deals).map(([ID, d]) => ({ ID, ...d })).filter((d) => String(d.CATEGORY_ID) === '0');
    // по одной сделке на страницу — проверяем постраничное чтение
    const start = Number(params.start || 0);
    const page = all.slice(start, start + 1);
    return { data: { result: page, ...(start + 1 < all.length ? { next: start + 1 } : {}) } };
  }
  if (method === 'crm.lead.update' || method === 'crm.timeline.comment.add') return { data: { result: true } };
  throw new Error(`unexpected ${method}`);
});

let app;
let office;
const adminToken = () => global.testUtils.createTestAdminToken();

async function scheduleFor(date, { capacity = 2, slots = [['10:00', '10:30'], ['15:00', '15:30'], ['00:00', '00:30']], customized = false } = {}) {
  const schedule = await models.Schedule.create({ office_id: office.id, date, isWorkingDay: true, isCustomized: customized });
  for (const [start, end] of slots) await models.Slot.create({ schedule_id: schedule.id, start, end, available: true, capacity });
  return schedule;
}

async function sendEvent(query) {
  const res = await request(app).post(`/api/bitrix-events?token=hook-secret&${query}`);
  expect(res.status).toBe(202);
  await events.idle();
}

const history = async (appointmentId) => models.AppointmentHistory.findAll({ where: { appointment_id: appointmentId }, order: [['createdAt', 'ASC']], raw: true });

beforeAll(async () => {
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
  resetBitrix();
  events.reset();
  office = await models.Office.create({ city: 'Минск', address: 'ул. Тестовая, 1', bitrixOfficeId: 774 });
});

afterAll(async () => {
  await closeDatabase();
});

describe('событие Битрикса: встреча назначена в карточке мимо сетки', () => {
  it('заводит встречу в сетку сразу, пишет автора из Битрикса и учёт «мимо сетки»', async () => {
    await scheduleFor(day(1));
    bx.leads[5001] = { STATUS_ID: '2', UF_CRM_1655460588: `${day(1)}T03:00:00+03:00`, UF_CRM_1657019494: '15:00', UF_CRM_1675255265: '774', MODIFY_BY_ID: '295' };

    await sendEvent('lead_id=5001');

    const appts = await models.Appointment.findAll({ where: { bitrix_lead_id: 5001 } });
    expect(appts).toHaveLength(1);
    expect(appts[0]).toMatchObject({ date: day(1), timeSlot: '15:00-15:30', status: 'pending' });
    const [h] = await history(appts[0].id);
    expect(h.action).toBe('created_from_crm');
    expect(h.newValue.actor).toMatchObject({ type: 'system', source: 'bitrix_event', bitrixUserId: 295 });
    const bypass = await models.CrmBypass.findAll({ raw: true });
    expect(bypass).toEqual([expect.objectContaining({ leadId: '5001', outcome: 'created', bitrixUserId: '295', source: 'bitrix_event' })]);
  });

  it('повтор и дубль события не плодят встречи и записи журнала', async () => {
    await scheduleFor(day(1));
    bx.leads[5002] = { STATUS_ID: '2', UF_CRM_1655460588: `${day(1)}T03:00:00+03:00`, UF_CRM_1657019494: '10:00', UF_CRM_1675255265: '774' };

    await sendEvent('lead_id=5002');
    await sendEvent('lead_id=5002');
    const res = await request(app).post('/api/bitrix-events').type('form')
      .send('event=ONCRMLEADUPDATE&data[FIELDS][ID]=5002&auth[application_token]=hook-secret');
    expect(res.status).toBe(202);
    await events.idle();

    const appts = await models.Appointment.findAll({ where: { bitrix_lead_id: 5002 } });
    expect(appts).toHaveLength(1);
    expect(await history(appts[0].id)).toHaveLength(1);
    expect(await models.CrmBypass.count()).toBe(1);
  });

  it('в полный слот — встреча заводится как перебор, сетка показывает «мест нет»', async () => {
    await scheduleFor(day(1), { capacity: 1 });
    await models.Appointment.create({ office_id: office.id, bitrix_lead_id: 1, date: day(1), timeSlot: '10:00-10:30', status: 'pending', createdBy: 288 });
    bx.leads[5003] = { STATUS_ID: '2', UF_CRM_1655460588: `${day(1)}T03:00:00+03:00`, UF_CRM_1657019494: '10:00', UF_CRM_1675255265: '774' };

    await sendEvent('lead_id=5003');

    expect(await models.Appointment.count({ where: { date: day(1), timeSlot: '10:00-10:30', status: 'pending' } })).toBe(2);
    expect((await models.CrmBypass.findOne({ raw: true })).outcome).toBe('overbooked');
  });

  it('день без расписания — встречи нет, но назначение учтено', async () => {
    bx.leads[5004] = { STATUS_ID: '2', UF_CRM_1655460588: `${day(2)}T03:00:00+03:00`, UF_CRM_1657019494: '11:00', UF_CRM_1675255265: '774' };

    await sendEvent('lead_id=5004');

    expect(await models.Appointment.count()).toBe(0);
    expect((await models.CrmBypass.findOne({ raw: true })).outcome).toBe('no_schedule');
  });
});

describe('событие Битрикса: пришёл / не пришёл', () => {
  it('стадия 3 после встречи → неявка; затем сделка «Офис» → пришёл (опоздал)', async () => {
    await scheduleFor(TODAY);
    const a = await models.Appointment.create({ office_id: office.id, bitrix_lead_id: 6001, date: TODAY, timeSlot: '00:00-00:30', status: 'confirmed', createdBy: 288 });

    bx.leads[6001] = { STATUS_ID: '3' };
    await sendEvent('lead_id=6001');
    await a.reload();
    expect(a.status).toBe('no_show');

    bx.deals[9001] = { CATEGORY_ID: '0', LEAD_ID: '6001', DATE_CREATE: new Date().toISOString(), CREATED_BY_ID: '328' };
    await sendEvent('deal_id=9001');
    await a.reload();
    expect(a.status).toBe('completed');
    const actions = (await history(a.id)).map((h) => h.action);
    expect(actions).toEqual(['sync_no_show', 'visit_completed']);
  });

  it('клиент пришёл в день встречи, которую заранее отменили, — встреча «пришёл»', async () => {
    await scheduleFor(TODAY);
    const a = await models.Appointment.create({ office_id: office.id, bitrix_lead_id: 6002, date: TODAY, timeSlot: '15:00-15:30', status: 'cancelled', createdBy: 288 });
    bx.deals[9002] = { CATEGORY_ID: '0', LEAD_ID: '6002', DATE_CREATE: new Date().toISOString() };

    await sendEvent('deal_id=9002');

    await a.reload();
    expect(a.status).toBe('completed');
    expect((await history(a.id))[0].action).toBe('visit_after_cancel');
  });

  it('сделка не из воронки «Офис» ничего не меняет', async () => {
    const a = await models.Appointment.create({ office_id: office.id, bitrix_lead_id: 6003, date: TODAY, timeSlot: '15:00-15:30', status: 'pending', createdBy: 288 });
    bx.deals[9003] = { CATEGORY_ID: '12', LEAD_ID: '6003', DATE_CREATE: new Date().toISOString() };

    await sendEvent('deal_id=9003');

    await a.reload();
    expect(a.status).toBe('pending');
  });
});

describe('защита свежей записи оператора от отката', () => {
  it('запись в виджете не откатывается событием, пока Битрикс ещё держит старые дату и время', async () => {
    await scheduleFor(day(1));
    await scheduleFor(day(2));
    const WIDGET = { 'X-App-Id': 'widget-test', 'X-App-Token': 'secret-test' };
    const first = await request(app).post('/api/appointments?lead_id=7001').set(WIDGET)
      .send({ office_id: office.id, date: day(1), time_slot: '10:00-10:30', lead_id: 7001 });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/appointments?lead_id=7001').set(WIDGET)
      .send({ office_id: office.id, date: day(2), time_slot: '15:00-15:30', lead_id: 7001 });
    expect(second.status).toBe(201);

    // В Битриксе лид ещё со старым слотом (фоновое обновление не доехало)
    bx.leads[7001] = { STATUS_ID: '2', UF_CRM_1655460588: `${day(1)}T03:00:00+03:00`, UF_CRM_1657019494: '10:00', UF_CRM_1675255265: '774' };
    await sendEvent('lead_id=7001');

    const active = await models.Appointment.findAll({ where: { bitrix_lead_id: 7001, status: 'pending' }, raw: true });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ date: day(2), timeSlot: '15:00-15:30' });
  });
});

describe('суточная сверка последних 7 дней', () => {
  async function seedPast() {
    for (const n of [-3, -2, -1]) await scheduleFor(day(n));
    const mk = (lead, n, status) => models.Appointment.create({ office_id: office.id, bitrix_lead_id: lead, date: day(n), timeSlot: '10:00-10:30', status, createdBy: 288 });
    const cancelledCame = await mk(8001, -3, 'cancelled');
    const pendingNoVisit = await mk(8002, -2, 'pending');
    const noShowCame = await mk(8003, -1, 'no_show');
    const completedNoDeal = await mk(8004, -1, 'completed');
    const cancelledNoVisit = await mk(8005, -2, 'cancelled');
    const visitAt = (n) => `${day(n)}T11:00:00+03:00`;
    bx.deals[9101] = { CATEGORY_ID: '0', LEAD_ID: '8001', DATE_CREATE: visitAt(-3) };
    bx.deals[9102] = { CATEGORY_ID: '0', LEAD_ID: '8003', DATE_CREATE: visitAt(-1) };
    bx.deals[9103] = { CATEGORY_ID: '12', LEAD_ID: '8002', DATE_CREATE: visitAt(-2) };
    return { cancelledCame, pendingNoVisit, noShowCame, completedNoDeal, cancelledNoVisit };
  }

  it('проверка (dry run) показывает расхождения и ничего не пишет', async () => {
    const s = await seedPast();

    const report = await reconcileRecentAppointments({ daysBack: 7, dryRun: true });

    expect(report.changes).toBe(3);
    expect(report.byReason).toEqual({ visit_after_cancel: 1, past_active_no_visit: 1, visit_marked_no_show: 1 });
    expect(report.notes.completed_without_office_deal).toBe(1);
    await s.cancelledCame.reload();
    expect(s.cancelledCame.status).toBe('cancelled');
  });

  it('исправляет расхождения, пишет журнал, повторный прогон — без изменений', async () => {
    const s = await seedPast();

    const report = await reconcileRecentAppointments({ daysBack: 7 });
    expect(report.changes).toBe(3);

    for (const k of Object.keys(s)) await s[k].reload();
    expect(s.cancelledCame.status).toBe('completed');
    expect(s.pendingNoVisit.status).toBe('no_show');
    expect(s.noShowCame.status).toBe('completed');
    expect(s.completedNoDeal.status).toBe('completed');
    expect(s.cancelledNoVisit.status).toBe('cancelled');
    expect((await history(s.pendingNoVisit.id))[0]).toMatchObject({ action: 'reconcile_no_show' });
    expect((await history(s.pendingNoVisit.id))[0].newValue.actor.source).toBe('reconcile');

    const again = await reconcileRecentAppointments({ daysBack: 7 });
    expect(again.changes).toBe(0);

    const last = await request(app).get('/api/admin/sync/reconcile/last').set('Authorization', `Bearer ${adminToken()}`);
    expect(last.body.data.changes).toBe(0);
  });

  it('Битрикс не отдал сделки — ничего не трогаем и сообщаем об ошибке', async () => {
    const s = await seedPast();
    bx.dealListFails = true;

    const report = await reconcileRecentAppointments({ daysBack: 7 });

    expect(report.error).toMatch(/сделки/);
    expect(report.changes).toBe(0);
    await s.pendingNoVisit.reload();
    expect(s.pendingNoVisit.status).toBe('pending');
  });

  it('ручной запуск через API по умолчанию — только проверка', async () => {
    await seedPast();
    const res = await request(app).post('/api/admin/sync/reconcile').set('Authorization', `Bearer ${adminToken()}`).send({ days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(await models.Appointment.count({ where: { status: 'completed' } })).toBe(1);
  });
});

describe('продление расписания', () => {
  it('берёт самую частую раскладку того же дня недели, разовые дни не тиражирует, существующие не трогает', async () => {
    // для завтра: 1 и 3 недели назад — обычный день, 2 недели назад — короткий разовый
    await scheduleFor(day(1 - 7), { capacity: 4, slots: [['09:00', '09:30'], ['09:30', '10:00']], customized: true });
    await scheduleFor(day(1 - 14), { capacity: 4, slots: [['09:00', '09:30']], customized: true });
    await scheduleFor(day(1 - 21), { capacity: 4, slots: [['09:00', '09:30'], ['09:30', '10:00']], customized: true });
    // для послезавтра неделю назад офис закрывали — берём две недели назад
    const closed = await scheduleFor(day(2 - 7), { capacity: 9, slots: [['12:00', '12:30']] });
    await closed.update({ isWorkingDay: false });
    await scheduleFor(day(2 - 14), { capacity: 3, slots: [['10:00', '10:30']] });
    // сегодня уже есть — не трогаем
    await scheduleFor(TODAY, { capacity: 1, slots: [['18:00', '18:30']] });

    const dry = await rollForwardSchedules({ extraDays: 0, dryRun: true });
    expect(dry.created.map((c) => c.date)).toEqual(expect.arrayContaining([day(1), day(2)]));
    expect(await models.Schedule.count({ where: { office_id: office.id, date: day(1) } })).toBe(0);

    await rollForwardSchedules({ extraDays: 0 });

    const slotsOf = async (date) => {
      const sch = await models.Schedule.findOne({ where: { office_id: office.id, date } });
      return sch ? (await models.Slot.findAll({ where: { schedule_id: sch.id }, order: [['start', 'ASC']], raw: true })).map((s) => `${s.start}-${s.end}x${s.capacity}`) : null;
    };
    expect(await slotsOf(day(1))).toEqual(['09:00-09:30x4', '09:30-10:00x4']);
    expect(await slotsOf(day(2))).toEqual(['10:00-10:30x3']);
    expect(await slotsOf(TODAY)).toEqual(['18:00-18:30x1']);
    // день без образца (3 дня вперёд) остаётся пустым
    expect(await slotsOf(day(3))).toBeNull();
  });
});

describe('журнал в админке', () => {
  it('показывает, кто менял встречу: оператор, событие Битрикса с автором', async () => {
    await scheduleFor(TODAY);
    const a = await models.Appointment.create({ office_id: office.id, bitrix_lead_id: 6101, date: TODAY, timeSlot: '00:00-00:30', status: 'pending', createdBy: 288 });
    await models.AppointmentHistory.create({ appointment_id: a.id, action: 'created', newValue: { status: 'pending', actor: { type: 'operator', id: 288 } }, changedBy: 288 });
    bx.leads[6101] = { STATUS_ID: '3', MODIFY_BY_ID: '240' };
    await sendEvent('lead_id=6101');

    const res = await request(app).get(`/api/admin/appointments/${a.id}/history`).set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.who)).toEqual(['Оператор #288 (виджет)', 'Событие Битрикса · изменил в Битриксе #240']);
    expect(res.body.data[1]).toMatchObject({ action: 'sync_no_show', bitrixStatus: '3', after: expect.objectContaining({ status: 'no_show' }) });
  });

  it('список назначений мимо сетки в админке', async () => {
    await scheduleFor(day(1));
    bx.leads[5101] = { STATUS_ID: '2', UF_CRM_1655460588: ru(day(1)), UF_CRM_1657019494: '15:05', UF_CRM_1675255265: '774', MODIFY_BY_ID: '327' };
    await sendEvent('lead_id=5101');

    const res = await request(app).get('/api/admin/sync/bypass').set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.byOutcome).toEqual({ created: 1 });
    expect(res.body.data.byUser).toEqual({ 327: 1 });
    // 15:05 вне сетки привязано к слоту 15:00-15:30
    expect((await models.Appointment.findOne({ where: { bitrix_lead_id: 5101 }, raw: true })).timeSlot).toBe('15:00-15:30');
  });
});
