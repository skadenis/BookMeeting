// Проверка 26.09: «не пришёл», «клиент отменил», «клиент перенёс» — на
// настоящем приложении и Postgres. Битрикс подменяется по имени метода REST.

process.env.NODE_ENV = 'test';
process.env.BITRIX_DEV_MODE = 'false';
process.env.PUBLIC_TOKEN_PAIRS = 'widget-test:secret-test';
process.env.ENABLE_CRON = 'false';
process.env.EXPORT_TOKEN = 'export-secret';

jest.mock('axios');

const request = require('supertest');
const axios = require('axios');
const { createApp } = require('../../src/index');
const { resetDatabase, closeDatabase, models } = require('../helpers/db');
const { reconcileRecentAppointments, applyLeadState } = require('../../src/services/reconcile');
const { autoSyncStatuses, checkNoShowLeads } = require('../../src/services/syncTasks');
const { repairHistory } = require('../../src/services/repairHistory');
const { businessToday } = require('../../src/lib/time');

const TODAY = businessToday();
const day = (n) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (n, hhmm) => `${day(n)}T${hhmm}:00+03:00`;
const WIDGET = { 'X-App-Id': 'widget-test', 'X-App-Token': 'secret-test' };

let bx;
function resetBitrix() {
  bx = { leads: {}, deals: {}, stages: [], calls: [] };
}
axios.post.mockImplementation(async (url, params) => {
  const method = String(url).split('/').pop();
  bx.calls.push({ method, params });
  if (method === 'crm.lead.list') {
    if (params.filter?.STATUS_ID) {
      if (Number(params.start || 0) > 0) return { data: { result: [] } };
      const st = params.filter.STATUS_ID.map(String);
      return { data: { result: Object.entries(bx.leads).filter(([, l]) => st.includes(String(l.STATUS_ID))).map(([ID, l]) => ({ ID, ...l })) } };
    }
    const ids = (params.filter?.ID || []).map(Number);
    return { data: { result: ids.filter((id) => bx.leads[id]).map((id) => ({ ID: String(id), ...bx.leads[id] })) } };
  }
  if (method === 'crm.deal.list') {
    const all = Object.entries(bx.deals).map(([ID, d]) => ({ ID, ...d })).filter((d) => String(d.CATEGORY_ID) === '0');
    return { data: { result: all } };
  }
  if (method === 'crm.stagehistory.list') {
    const f = params.filter || {};
    let items = bx.stages.map((s, i) => ({ ID: String(i + 1), OWNER_ID: String(s.lead), CREATED_TIME: s.at, STATUS_ID: s.stage }));
    if (f.STATUS_ID) items = items.filter((it) => it.STATUS_ID === String(f.STATUS_ID));
    if (f.OWNER_ID) items = items.filter((it) => f.OWNER_ID.map(String).includes(it.OWNER_ID));
    if (f['>=CREATED_TIME']) items = items.filter((it) => new Date(it.CREATED_TIME) >= new Date(f['>=CREATED_TIME']));
    if (f['<CREATED_TIME']) items = items.filter((it) => new Date(it.CREATED_TIME) < new Date(f['<CREATED_TIME']));
    // по две записи на страницу — проверяем постраничное чтение
    const start = Number(params.start || 0);
    return { data: { result: { items: items.slice(start, start + 2) }, ...(start + 2 < items.length ? { next: start + 2 } : {}) } };
  }
  if (method === 'crm.lead.update' || method === 'crm.lead.get') return { data: { result: true } };
  throw new Error(`unexpected ${method}`);
});

let app;
let office;

async function scheduleFor(date, { capacity = 2, slots = [['00:00', '00:30'], ['10:00', '10:30'], ['23:30', '23:59']] } = {}) {
  const schedule = await models.Schedule.create({ office_id: office.id, date, isWorkingDay: true });
  for (const [start, end] of slots) await models.Slot.create({ schedule_id: schedule.id, start, end, available: true, capacity });
  return schedule;
}
const mk = (lead, n, timeSlot, status, extra = {}) => models.Appointment.create({ office_id: office.id, bitrix_lead_id: lead, date: day(n), timeSlot, status, createdBy: 288, ...extra });
const history = async (id) => models.AppointmentHistory.findAll({ where: { appointment_id: id }, order: [['createdAt', 'ASC']], raw: true });
const actions = async (id) => (await history(id)).map((h) => h.action);

beforeAll(() => { app = createApp(); });
beforeEach(async () => {
  await resetDatabase();
  resetBitrix();
  office = await models.Office.create({ city: 'Минск', address: 'ул. Тестовая, 1', bitrixOfficeId: 774 });
});
afterAll(async () => { await closeDatabase(); });

describe('«не пришёл»: опрос после начала встречи', () => {
  it('агент поставил 3, робот сразу увёл лид в «НДЗ 1» — неявка, а не отмена', async () => {
    const a = await mk(7101, 0, '00:00-00:30', 'confirmed');
    bx.leads[7101] = { STATUS_ID: '1' };

    await autoSyncStatuses();

    await a.reload();
    expect(a.status).toBe('no_show');
    expect(await actions(a.id)).toEqual(['sync_no_show']);
  });

  it('вчерашняя неявка, сегодня клиент пришёл по новой записи — вчера остаётся неявкой (опрос неявок и событие)', async () => {
    const a = await mk(7102, -1, '10:00-10:30', 'no_show');
    bx.leads[7102] = { STATUS_ID: 'CONVERTED' };

    await checkNoShowLeads({ daysBack: 3 });
    await applyLeadState({ ID: '7102', STATUS_ID: 'CONVERTED' });

    await a.reload();
    expect(a.status).toBe('no_show');
  });

  it('сегодняшняя неявка, опоздавшего приняли — пришёл', async () => {
    const a = await mk(7103, 0, '00:00-00:30', 'no_show');
    bx.leads[7103] = { STATUS_ID: 'CONVERTED' };

    await checkNoShowLeads({ daysBack: 3 });

    await a.reload();
    expect(a.status).toBe('completed');
  });
});

describe('«клиент отменил» в карточке: часовая сверка освобождает место заранее', () => {
  it('будущая встреча, лид в «Перезвонить» — отменена сверкой, место в сетке свободно, в выгрузке — отмена заранее', async () => {
    await scheduleFor(day(2), { capacity: 1 });
    const cancelled = await mk(7201, 2, '10:00-10:30', 'pending');
    const confirmed = await mk(7202, 2, '00:00-00:30', 'pending');
    const transit = await mk(7203, 3, '10:00-10:30', 'confirmed');
    const staleThree = await mk(7204, 3, '00:00-00:30', 'pending');
    bx.leads[7201] = { STATUS_ID: 'PROCESSED' };
    bx.leads[7202] = { STATUS_ID: '37' };
    bx.leads[7203] = { STATUS_ID: 'IN_PROCESS' };
    bx.leads[7204] = { STATUS_ID: '3' };

    const dry = await reconcileRecentAppointments({ daysBack: 1, dryRun: true });
    expect(dry.byReason).toEqual({ future_cancelled: 1, future_confirmed: 1 });
    expect(dry.future).toBe(4);

    const report = await reconcileRecentAppointments({ daysBack: 1 });
    expect(report.byReason).toEqual({ future_cancelled: 1, future_confirmed: 1 });
    for (const x of [cancelled, confirmed, transit, staleThree]) await x.reload();
    expect([cancelled.status, confirmed.status, transit.status, staleThree.status]).toEqual(['cancelled', 'confirmed', 'confirmed', 'pending']);
    expect(await actions(cancelled.id)).toEqual(['reconcile_cancelled']);

    const slots = await request(app).get(`/api/slots?office_id=${office.id}&date=${day(2)}`).set(WIDGET);
    const ten = (slots.body.data || []).find((s) => s.start === '10:00');
    expect(ten).toBeDefined();
    expect(ten.free).toBe(1);

    const exp = await request(app).get(`/api/export/appointments?from=${day(2)}&to=${day(2)}`).set('Authorization', 'Bearer export-secret');
    const row = exp.body.data.appointments.find((r) => r.leadId === 7201);
    expect(row).toMatchObject({ status: 'cancelled', closedBy: 'bitrix_status', closingBitrixStatus: 'PROCESSED' });
    expect(new Date(row.closedAt) < new Date(`${day(2)}T10:00:00+03:00`)).toBe(true);

    const again = await reconcileRecentAppointments({ daysBack: 1 });
    expect(again.changes).toBe(0);
  });
});

describe('виджет: отмена и перезапись после начала встречи', () => {
  it('«Отменить» после начала — неявка; до начала — отмена', async () => {
    const started = await mk(7301, 0, '00:00-00:30', 'pending');
    const future = await mk(7302, 1, '10:00-10:30', 'confirmed');

    const r1 = await request(app).put(`/api/appointments/${started.id}?lead_id=7301`).set(WIDGET).send({ status: 'cancelled' });
    const r2 = await request(app).put(`/api/appointments/${future.id}?lead_id=7302`).set(WIDGET).send({ status: 'cancelled' });

    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.data.status).toBe('no_show');
    expect(r2.body.data.status).toBe('cancelled');
    expect(await actions(started.id)).toEqual(['cancelled_after_start']);
    expect(await actions(future.id)).toEqual(['status_cancelled']);
  });

  it('перезапись: начавшаяся встреча — неявка, будущая — «отменена перезаписью»; активная остаётся одна', async () => {
    await scheduleFor(day(1));
    const started = await mk(7401, 0, '00:00-00:30', 'confirmed');

    const res = await request(app).post('/api/appointments?lead_id=7401').set(WIDGET)
      .send({ office_id: office.id, date: day(1), time_slot: '10:00-10:30', lead_id: 7401 });
    expect(res.status).toBe(201);
    await started.reload();
    expect(started.status).toBe('no_show');
    expect(await actions(started.id)).toEqual(['no_show_by_rebooking']);

    const again = await request(app).post('/api/appointments?lead_id=7401').set(WIDGET)
      .send({ office_id: office.id, date: day(1), time_slot: '23:30-23:59', lead_id: 7401 });
    expect(again.status).toBe(201);
    const first = await models.Appointment.findByPk(res.body.data.id);
    expect(first.status).toBe('cancelled');
    expect(await actions(first.id)).toEqual(['created', 'cancelled_by_rebooking']);
    expect(await models.Appointment.count({ where: { bitrix_lead_id: 7401, status: ['pending', 'confirmed'] } })).toBe(1);

    // выгрузка: перезапись до начала — «rebooking» (платформа не считает её встречей),
    // после начала — закрыл оператор, статус «не пришёл»
    const exp = await request(app).get(`/api/export/appointments?from=${day(0)}&to=${day(1)}`).set('Authorization', 'Bearer export-secret');
    const byId = Object.fromEntries(exp.body.data.appointments.map((r) => [r.id, r]));
    expect(byId[started.id]).toMatchObject({ status: 'no_show', closedBy: 'operator' });
    expect(byId[first.id]).toMatchObject({ status: 'cancelled', closedBy: 'rebooking' });
  });
});

describe('исправление записанной истории', () => {
  async function seed() {
    const c = {};
    // старая синхронизация: неявка записана «отменой» без журнала
    c.oldSync = await mk(7501, -3, '10:00-10:30', 'cancelled');
    bx.stages.push({ lead: 7501, at: at(-4, '12:00'), stage: '2' }, { lead: 7501, at: at(-3, '10:05'), stage: '3' }, { lead: 7501, at: at(-3, '10:05'), stage: '1' });
    // оператор отменил после неявки
    c.opAfter = await mk(7502, -3, '10:00-10:30', 'cancelled');
    await models.AppointmentHistory.create({ appointment_id: c.opAfter.id, action: 'status_cancelled', changedBy: 1, createdAt: new Date(at(-3, '10:20')) });
    bx.stages.push({ lead: 7502, at: at(-3, '10:05'), stage: '3' });
    // оператор отменил до начала — решение оператора, не трогаем, хотя стадия 3 есть (другая встреча)
    c.opBefore = await mk(7503, -3, '10:00-10:30', 'cancelled');
    await models.AppointmentHistory.create({ appointment_id: c.opBefore.id, action: 'status_cancelled', changedBy: 1, createdAt: new Date(at(-4, '10:00')) });
    bx.stages.push({ lead: 7503, at: at(-3, '10:05'), stage: '3' });
    // отказ в карточке до начала (без журнала): статус тот же, журнал с моментом ухода
    c.cardCancel = await mk(7504, -2, '10:00-10:30', 'cancelled');
    bx.stages.push({ lead: 7504, at: at(-5, '12:00'), stage: '2' }, { lead: 7504, at: at(-3, '16:00'), stage: 'IN_PROCESS' }, { lead: 7504, at: at(-3, '16:01'), stage: 'PROCESSED' });
    // пришёл, а записано «отменена»
    c.came = await mk(7505, -2, '10:00-10:30', 'cancelled');
    bx.deals[9505] = { CATEGORY_ID: '0', LEAD_ID: '7505', DATE_CREATE: at(-2, '10:40') };
    // перенос в тот же день: ранняя встреча заменена поздней, стадия 3 — у поздней
    c.early = await mk(7506, -2, '00:00-00:30', 'cancelled');
    c.late = await mk(7506, -2, '10:00-10:30', 'pending');
    bx.stages.push({ lead: 7506, at: at(-2, '10:05'), stage: '3' });
    return c;
  }

  it('сухой прогон: отчёт без записи; с --apply: исправляет, повтор — без изменений', async () => {
    const c = await seed();

    const dry = await repairHistory({ from: day(-7), to: day(-1) });
    expect(dry.dryRun).toBe(true);
    expect(dry.byReason).toEqual({
      visit_after_cancel: 1,
      no_show_was_cancelled_without_journal: 1,
      no_show_was_status_cancelled: 1,
      no_show_was_pending_without_journal: 1,
      cancelled_before_start_journaled: 1,
    });
    expect(dry.notes).toMatchObject({ operator_closed_before_start: 1, silent_cancel_no_history: 1 });
    await c.oldSync.reload();
    expect(c.oldSync.status).toBe('cancelled');

    const report = await repairHistory({ from: day(-7), to: day(-1), dryRun: false });
    expect(report.changes).toBe(dry.changes);
    for (const k of Object.keys(c)) await c[k].reload();
    expect({
      oldSync: c.oldSync.status, opAfter: c.opAfter.status, opBefore: c.opBefore.status, cardCancel: c.cardCancel.status,
      came: c.came.status, early: c.early.status, late: c.late.status,
    }).toEqual({
      oldSync: 'no_show', opAfter: 'no_show', opBefore: 'cancelled', cardCancel: 'cancelled',
      came: 'completed', early: 'cancelled', late: 'no_show',
    });
    const card = (await history(c.cardCancel.id)).find((h) => h.action === 'repair_cancelled');
    expect(card.newValue).toMatchObject({ bitrixStatus: 'PROCESSED', eventAt: new Date(at(-3, '16:00')).toISOString() });

    const exp = await request(app).get(`/api/export/appointments?from=${day(-3)}&to=${day(-2)}`).set('Authorization', 'Bearer export-secret');
    const row = exp.body.data.appointments.find((r) => r.id === c.cardCancel.id);
    expect(row).toMatchObject({ closedBy: 'bitrix_status', closedAt: new Date(at(-3, '16:00')).toISOString() });

    const again = await repairHistory({ from: day(-7), to: day(-1), dryRun: false });
    expect(again.byReason).toEqual({});
  });
});
