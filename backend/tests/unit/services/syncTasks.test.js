jest.mock('../../../src/lib/db', () => ({
  models: {
    Appointment: { findAll: jest.fn() },
    Office: {}
  },
  Op: { not: Symbol('not'), in: Symbol('in') },
  Sequelize: {}
}));

jest.mock('axios');

const axios = require('axios');
const { models } = require('../../../src/lib/db');
const { autoSyncStatuses, fetchAndAnalyzeBitrixLeads } = require('../../../src/services/syncTasks');

const today = require('dayjs')().format('YYYY-MM-DD');

function makeAppointment(overrides = {}) {
  return {
    id: 'a1',
    bitrix_lead_id: 12345,
    date: today,
    timeSlot: '23:00-23:30', // late enough that isPastDue is false during the test run
    status: 'pending',
    update: jest.fn(function (fields) { Object.assign(this, fields); return Promise.resolve(this); }),
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BITRIX_REST_URL = 'https://example.invalid/rest/1/token';
});

describe('autoSyncStatuses', () => {
  it('leaves appointments untouched when Bitrix does not answer', async () => {
    const appointment = makeAppointment();
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockRejectedValue(new Error('timeout of 15000ms exceeded'));

    const result = await autoSyncStatuses();

    expect(appointment.update).not.toHaveBeenCalled();
    expect(appointment.status).toBe('pending');
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('leaves appointments untouched when Bitrix omits the lead from the batch', async () => {
    const appointment = makeAppointment();
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [] } });

    const result = await autoSyncStatuses();

    expect(appointment.update).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('applies the Bitrix status when the lead is returned', async () => {
    const appointment = makeAppointment({ status: 'pending' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: '37' }] } });

    const result = await autoSyncStatuses();

    expect(appointment.update).toHaveBeenCalledWith({ status: 'confirmed' });
    expect(result.updated).toBe(1);
  });

  // Тест закреплял отмену встречи при стадии IN_PROCESS. Но в эту стадию лид
  // переводит само приложение: ensureLeadStage сначала ставит IN_PROCESS и
  // только потом целевую стадию. Синхронизация видела промежуточное состояние,
  // считала, что лид ушёл со стадий встречи, и отменяла живую запись —
  // встреча пропадала из виджета. IN_PROCESS означает «ещё не доехало».
  it('leaves the appointment alone on a transient Bitrix stage', async () => {
    const appointment = makeAppointment({ status: 'pending' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: 'IN_PROCESS' }] } });

    const result = await autoSyncStatuses();

    expect(appointment.update).not.toHaveBeenCalled();
    expect(appointment.status).toBe('pending');
    expect(result.skipped).toBe(1);
  });

  it('cancels when the lead really left the meeting stages in Bitrix', async () => {
    const appointment = makeAppointment({ status: 'pending' });
    models.Appointment.findAll.mockResolvedValue([appointment]);
    axios.post.mockResolvedValue({ data: { result: [{ ID: '12345', STATUS_ID: 'JUNK' }] } });

    await autoSyncStatuses();

    expect(appointment.update).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('fetches every lead in one batched call instead of one call per lead', async () => {
    const appointments = Array.from({ length: 30 }, (_, i) =>
      makeAppointment({ id: `a${i}`, bitrix_lead_id: 1000 + i })
    );
    models.Appointment.findAll.mockResolvedValue(appointments);
    axios.post.mockResolvedValue({ data: { result: [] } });

    await autoSyncStatuses();

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain('crm.lead.list');
  });

  it('only looks at today\'s appointments', async () => {
    models.Appointment.findAll.mockResolvedValue([]);
    axios.post.mockResolvedValue({ data: { result: [] } });

    await autoSyncStatuses();

    expect(models.Appointment.findAll.mock.calls[0][0].where.date).toBe(today);
  });
});

// Лид Bitrix хранит только время начала («15:00»), приложение — интервал
// («15:00-15:30»). Анализ обязан сравнивать по началу: сравнение сырых строк
// помечало каждую встречу как изменившуюся, и applyUpdates раз в 5 минут
// затирал полный интервал коротким временем.
describe('fetchAndAnalyzeBitrixLeads', () => {
  function makeLead(overrides = {}) {
    return {
      ID: '12345',
      STATUS_ID: '2',
      UF_CRM_1675255265: '774',
      UF_CRM_1655460588: `${today}T03:00:00+03:00`,
      UF_CRM_1657019494: '15:00',
      ...overrides
    };
  }

  it('does not flag an appointment when only the slot format differs', async () => {
    models.Appointment.findAll.mockResolvedValue([
      { id: 'a1', bitrix_lead_id: '12345', status: 'pending', date: today, timeSlot: '15:00-15:30' }
    ]);
    axios.post.mockResolvedValue({ data: { result: [makeLead()] } });

    const analysis = await fetchAndAnalyzeBitrixLeads();

    expect(analysis.createCount).toBe(0);
    expect(analysis.updateCount).toBe(0);
  });

  it('flags an update when the start time really changed', async () => {
    models.Appointment.findAll.mockResolvedValue([
      { id: 'a1', bitrix_lead_id: '12345', status: 'pending', date: today, timeSlot: '15:00-15:30' }
    ]);
    axios.post.mockResolvedValue({ data: { result: [makeLead({ UF_CRM_1657019494: '16:00' })] } });

    const analysis = await fetchAndAnalyzeBitrixLeads();

    expect(analysis.updateCount).toBe(1);
  });

  it('creates an appointment for a meeting booked directly in Bitrix', async () => {
    models.Appointment.findAll.mockResolvedValue([]);
    axios.post.mockResolvedValue({ data: { result: [makeLead({ STATUS_ID: '37' })] } });

    const analysis = await fetchAndAnalyzeBitrixLeads();

    expect(analysis.createCount).toBe(1);
    const lead = analysis.toCreate[0].leads[0];
    expect(lead.status).toBe('confirmed');
    expect(lead.date).toBe(today);
  });

  it('skips leads with no meeting date or time filled in', async () => {
    models.Appointment.findAll.mockResolvedValue([]);
    axios.post.mockResolvedValue({ data: { result: [
      makeLead({ UF_CRM_1655460588: '' }),
      makeLead({ ID: '12346', UF_CRM_1657019494: '' })
    ] } });

    const analysis = await fetchAndAnalyzeBitrixLeads();

    expect(analysis.createCount).toBe(0);
    expect(analysis.updateCount).toBe(0);
  });
});
