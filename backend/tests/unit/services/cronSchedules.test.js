// Расписание фоновых задач: опрос реже, когда включены события Битрикса;
// сверка раз в час и ночью.
jest.mock('../../../src/services/syncTasks', () => ({}));
const { schedules } = require('../../../src/services/cronService');

describe('schedules', () => {
  it('без событий Битрикса: опрос раз в 5 минут, сверка раз в час за вчера/сегодня и ночью за 7 дней', () => {
    expect(schedules({})).toEqual({
      withEvents: false,
      statusSync: '*/5 * * * *',
      leadsSync: '*/5 * * * *',
      reconcileHourly: '7 * * * *',
      reconcileHourlyDays: 1,
      reconcileNightly: '15 4 * * *',
      reconcileNightlyDays: 7,
    });
  });

  it('с BITRIX_EVENTS_TOKEN опрос — страховка раз в 30 минут', () => {
    const plan = schedules({ BITRIX_EVENTS_TOKEN: 'x', POLL_CRON: '*/5 * * * *' });
    expect(plan).toMatchObject({ withEvents: true, statusSync: '*/30 * * * *', leadsSync: '*/30 * * * *' });
  });

  it('всё переопределяется через env', () => {
    const plan = schedules({
      BITRIX_EVENTS_TOKEN: 'x', POLL_CRON_WITH_EVENTS: '0 * * * *',
      RECONCILE_CRON: '30 * * * *', RECONCILE_DAYS: '2', RECONCILE_NIGHTLY_CRON: '0 3 * * *', RECONCILE_NIGHTLY_DAYS: '14',
    });
    expect(plan).toMatchObject({ statusSync: '0 * * * *', reconcileHourly: '30 * * * *', reconcileHourlyDays: 2, reconcileNightly: '0 3 * * *', reconcileNightlyDays: 14 });
  });

  it('прежняя LEADS_SYNC_CRON понимается как расписание опроса', () => {
    expect(schedules({ LEADS_SYNC_CRON: '*/10 * * * *' }).statusSync).toBe('*/10 * * * *');
  });
});
