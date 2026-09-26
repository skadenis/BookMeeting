// Статусы лида Битрикса → статусы встречи, восстановление неявок и заведение
// встреч, назначенных в Битриксе мимо шахматки.
jest.mock('../../../src/lib/db', () => ({
  models: {
    Appointment: { findAll: jest.fn(), findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
    Office: { findByPk: jest.fn(), findOne: jest.fn() },
    Schedule: { findOne: jest.fn() },
    Slot: { findOne: jest.fn(), findAll: jest.fn() }
  },
  Op: { not: Symbol('not'), in: Symbol('in'), between: Symbol('between'), gte: Symbol('gte') },
  Sequelize: {}
}));
jest.mock('axios');
jest.mock('../../../src/services/localStatusGuard', () => ({
  hasRecentLocalStatusChange: jest.fn().mockResolvedValue(false)
}));
jest.mock('../../../src/services/appointmentHistory', () => ({
  recordAppointmentChange: jest.fn().mockResolvedValue(null)
}));
jest.mock('../../../src/services/slotsService', () => ({ invalidateSlotsCache: jest.fn() }));
jest.mock('../../../src/services/bypassLog', () => ({ recordBypass: jest.fn().mockResolvedValue(null) }));
jest.mock('../../../src/lib/ws', () => ({ broadcastSlotsUpdated: jest.fn() }));
jest.mock('../../../src/services/bookingGuard', () => {
  class BookingError extends Error {
    constructor(reason, message) { super(message); this.reason = reason; }
  }
  return { BookingError, assertSlotBookable: jest.fn() };
});

const axios = require('axios');
const { models } = require('../../../src/lib/db');
const { recordAppointmentChange } = require('../../../src/services/appointmentHistory');
const { recordBypass } = require('../../../src/services/bypassLog');
const { assertSlotBookable, BookingError } = require('../../../src/services/bookingGuard');
const { autoSyncStatuses, checkNoShowLeads, syncMissingAppointments } = require('../../../src/services/syncTasks');
const { businessToday } = require('../../../src/lib/time');

const today = businessToday();

function makeAppointment(overrides = {}) {
  return {
    id: 'a1',
    bitrix_lead_id: '12345',
    office_id: 'o1',
    date: today,
    timeSlot: '23:00-23:30',
    status: 'pending',
    update: jest.fn(function (fields) { Object.assign(this, fields); return Promise.resolve(this); }),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BITRIX_REST_URL = 'https://example.invalid/rest/1/token';
});

describe('autoSyncStatuses: стадии лида на портале', () => {
  it.each([
    ['3', 'no_show'],      // Не пришел на встречу — раньше становилось cancelled
    ['4', 'completed'],    // Находится в офисе — раньше становилось cancelled
    ['CONVERTED', 'completed'],
    ['37', 'confirmed']
  ])('стадия %s → %s', async (stage, expected) => {
    // «Не пришёл» относится только к начавшейся встрече
    const appointment = makeAppointment(stage === '3' ? { timeSlot: '00:00-00:30' } : {});
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: stage }] } });

    await autoSyncStatuses();

    expect(appointment.update).toHaveBeenCalledWith({ status: expected });
  });

  it('стадия 40 «Не наши услуги» — это отказ, а не выполненная встреча', async () => {
    const appointment = makeAppointment();
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: '40' }] } });

    await autoSyncStatuses();

    expect(appointment.update).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('пишет в журнал, что встречу закрыла синхронизация, и стадию Битрикса', async () => {
    const appointment = makeAppointment({ timeSlot: '00:00-00:30' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: '3' }] } });

    await autoSyncStatuses();

    expect(recordAppointmentChange).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'a1',
      action: 'sync_no_show',
      oldValue: { status: 'pending' },
      newValue: expect.objectContaining({ status: 'no_show', bitrixStatus: '3', source: 'bitrix_status_sync' })
    }));
  });
});

describe('checkNoShowLeads', () => {
  it('возвращает пришедшего клиента из неявки, даже если лид создан давно', async () => {
    const appointment = makeAppointment({ status: 'no_show', timeSlot: '00:00-00:30' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: 'CONVERTED' }] } });

    const result = await checkNoShowLeads({ daysBack: 3 });

    expect(result.restored).toBe(1);
    expect(appointment.status).toBe('completed');
    // фильтра по дате создания лида больше нет — только ID
    expect(axios.post.mock.calls[0][1].filter).toEqual({ ID: [12345] });
  });

  it('читает статусы пачками по 50 — Битрикс не отдаёт больше 50 строк', async () => {
    const appointments = Array.from({ length: 120 }, (_, i) =>
      makeAppointment({ id: `a${i}`, bitrix_lead_id: String(1000 + i), status: 'no_show' }));
    models.Appointment.findAll.mockResolvedValue(appointments);
    axios.post.mockResolvedValue({ data: { result: [] } });

    await checkNoShowLeads({ daysBack: 3 });

    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it('не возвращает неявку в активные, если лид ушёл в «Перезвонить»', async () => {
    const appointment = makeAppointment({ status: 'no_show' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: 'PROCESSED' }] } });

    const result = await checkNoShowLeads({ daysBack: 3 });

    expect(result.restored).toBe(0);
    expect(appointment.save).not.toHaveBeenCalled();
  });
});

describe('syncMissingAppointments: встречи, назначенные в Битриксе', () => {
  const tomorrow = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  function bitrixLead(overrides = {}) {
    return { ID: '555', STATUS_ID: '2', UF_CRM_1675255265: '774', UF_CRM_1655460588: `${tomorrow}T03:00:00+03:00`, UF_CRM_1657019494: '15:00', ...overrides };
  }

  beforeEach(() => {
    models.Appointment.findAll.mockResolvedValue([]);
    models.Appointment.findOne.mockResolvedValue(null);
    models.Office.findOne.mockResolvedValue({ id: 'o1' });
    models.Schedule.findOne.mockResolvedValue({ id: 's1' });
    models.Slot.findOne.mockResolvedValue({ start: '15:00', end: '15:30' });
    models.Appointment.create.mockImplementation(async (fields) => ({ id: 'new', ...fields }));
  });

  it('заводит встречу в полный слот и помечает перебор — сетка не должна показывать свободные места', async () => {
    axios.post.mockResolvedValue({ data: { result: [bitrixLead()] } });
    assertSlotBookable.mockRejectedValue(new BookingError('slot_full', 'нет мест'));

    const result = await syncMissingAppointments();

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(models.Appointment.create).toHaveBeenCalledWith(expect.objectContaining({ bitrix_lead_id: '555', office_id: 'o1', date: tomorrow, timeSlot: '15:00-15:30' }));
    expect(recordAppointmentChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created_from_crm_overbooked' }));
  });

  it('время вне сетки (15:05) привязывается к слоту, который его покрывает', async () => {
    axios.post.mockResolvedValue({ data: { result: [bitrixLead({ UF_CRM_1657019494: '15:05' })] } });
    models.Slot.findOne.mockResolvedValue(null);
    models.Slot.findAll.mockResolvedValue([{ start: '14:30', end: '15:00' }, { start: '15:00', end: '15:30' }]);
    assertSlotBookable.mockResolvedValue({});

    const result = await syncMissingAppointments();

    expect(result.created).toBe(1);
    expect(models.Appointment.create).toHaveBeenCalledWith(expect.objectContaining({ timeSlot: '15:00-15:30' }));
  });

  it('время, которого нет ни в одном слоте, пропускается и попадает в учёт назначений мимо сетки', async () => {
    axios.post.mockResolvedValue({ data: { result: [bitrixLead({ UF_CRM_1657019494: '22:40' })] } });
    models.Slot.findOne.mockResolvedValue(null);
    models.Slot.findAll.mockResolvedValue([{ start: '15:00', end: '15:30' }]);
    assertSlotBookable.mockRejectedValue(new BookingError('no_slot', 'нет слота'));

    const result = await syncMissingAppointments();

    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([expect.objectContaining({ bitrix_lead_id: '555', reason: 'no_slot' })]);
    expect(recordBypass).toHaveBeenCalledWith(expect.objectContaining({ leadId: '555', outcome: 'no_slot', time: '22:40' }));
  });

  it('обычная встреча из Битрикса заводится с записью в журнал', async () => {
    axios.post.mockResolvedValue({ data: { result: [bitrixLead()] } });
    assertSlotBookable.mockResolvedValue({});

    const result = await syncMissingAppointments();

    expect(result.created).toBe(1);
    expect(recordAppointmentChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created_from_crm' }));
  });
});
