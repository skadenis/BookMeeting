const cron = require('node-cron');
const axios = require('axios');
const { autoSyncStatuses, autoExpireAppointments, dedupeAppointments, syncMissingAppointments } = require('./syncTasks');

// Расписание фоновых задач (решение владельца 26.09: «и события, и общая
// сверка раз в час»). Все значения — через env, по умолчанию:
//  - опрос Битрикса (статусы сегодняшних встреч и встречи из карточки) — раз в
//    5 минут, пока события Битрикса не включены; с BITRIX_EVENTS_TOKEN — раз в
//    30 минут, как страховка к событиям;
//  - сверка раз в час за вчера и сегодня плюс будущие встречи;
//  - ночная сверка за 7 дней.
function schedules(env = process.env) {
	const withEvents = !!env.BITRIX_EVENTS_TOKEN;
	const poll = withEvents
		? (env.POLL_CRON_WITH_EVENTS || '*/30 * * * *')
		: (env.POLL_CRON || env.LEADS_SYNC_CRON || '*/5 * * * *');
	return {
		withEvents,
		statusSync: poll,
		leadsSync: poll,
		reconcileHourly: env.RECONCILE_CRON || '7 * * * *',
		reconcileHourlyDays: Number(env.RECONCILE_DAYS || 1),
		reconcileNightly: env.RECONCILE_NIGHTLY_CRON || '15 4 * * *',
		reconcileNightlyDays: Number(env.RECONCILE_NIGHTLY_DAYS || 7),
	};
}

class CronService {
  constructor() {
    this.jobs = new Map();
    // prod-safe default to port 4000; override with API_BASE_URL
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000/api';
    this.cronToken = process.env.CRON_TOKEN || null;
    this.adminBearer = process.env.CRON_ADMIN_TOKEN || '';
    this.started = false;
  }

  // Запуск автоматической синхронизации статусов каждые 5 минут
  startAutoSync() {
    const job = cron.schedule(schedules().statusSync, async () => {
      try {
        console.log('Running automatic status sync (direct)...');
        const result = await autoSyncStatuses();
        console.log(`Auto sync completed: ${result.updated} updated, ${result.no_show} marked as no_show`);
        
      } catch (error) {
        console.error('Auto sync cron error:', error.message);
      }
    }, {
      scheduled: false, // Не запускаем автоматически
      timezone: "Europe/Minsk"
    });

    return job;
  }

  // Запуск автоматического истечения просроченных встреч каждый час
  startAutoExpire() {
    const job = cron.schedule('0 * * * *', async () => {
      try {
        console.log('Running automatic appointment expiration (direct)...');
        const result = await autoExpireAppointments();
        console.log(`Auto expire completed: ${result.no_show} appointments expired`);
        
      } catch (error) {
        console.error('Auto expire cron error:', error.message);
      }
    }, {
      scheduled: false,
      timezone: "Europe/Minsk"
    });

    return job;
  }

  // Запуск всех cron задач
  startAll() {
    if (this.started) {
      console.log('Cron jobs already started, skipping');
      return;
    }
    const plan = schedules();
    console.log('Starting cron jobs...', plan);

    this.register('auto-sync', this.startAutoSync());
    this.register('auto-expire', this.startAutoExpire());

    // Встречи, назначенные или перенесённые в карточке лида.
    //
    // Раньше стояло '* * * * *' — раз в минуту, и лог при старте честно писал
    // «(DEBUG MODE)». В проде это 1440 полных обходов crm.lead.list в сутки.
    // Расписание — schedules().leadsSync.
    const leadsSyncJob = cron.schedule(plan.leadsSync, async () => {
      try {
        if (process.env.ENABLE_LEADS_SYNC !== 'true') {
          return; // feature is disabled unless explicitly enabled
        }
        console.log('Running admin leads sync (direct)...');
        if (!process.env.BITRIX_REST_URL) {
          console.warn('Leads sync skipped: BITRIX_REST_URL is not set');
          return;
        }
        // Раньше перед syncMissingAppointments отдельно звался
        // fetchAndAnalyzeBitrixLeads только ради строки в логе, а
        // syncMissingAppointments сам вызывает его ещё раз: полный обход лидов
        // шёл дважды (≈1 150 лишних запросов в Битрикс в сутки).
        const apply = await syncMissingAppointments({ applyUpdates: true });
        console.log('Admin leads sync applied:', apply);
      } catch (error) {
        console.error('Admin leads sync cron error:', error.message);
      }
    }, { scheduled: false, timezone: 'Europe/Minsk' });

    // Ежедневная чистка дублей в 03:30 по Минску
    const dedupeJob = cron.schedule('30 3 * * *', async () => {
      try {
        console.log('Running daily dedupe...');
        const result = await dedupeAppointments({ dryRun: false });
        console.log('Dedupe done:', result);
      } catch (error) {
        console.error('Dedupe cron error:', error.message);
      }
    }, { scheduled: false, timezone: 'Europe/Minsk' });

    // Проверка лидов со статусом "не пришел" каждые 30 минут
    const noShowLeadsJob = cron.schedule('*/30 * * * *', async () => {
      try {
        if (process.env.ENABLE_LEADS_SYNC !== 'true') {
          return; // feature is disabled unless explicitly enabled
        }
        console.log('Running no-show leads check...');
        if (!process.env.BITRIX_REST_URL) {
          console.warn('No-show leads check skipped: BITRIX_REST_URL is not set');
          return;
        }
        const { checkNoShowLeads } = require('./syncTasks');
        const result = await checkNoShowLeads({ daysBack: 3 });
        console.log('No-show leads check done:', result);
      } catch (error) {
        console.error('No-show leads check cron error:', error.message);
      }
    }, { scheduled: false, timezone: 'Europe/Minsk' });

    // Эти три задачи раньше не попадали в this.jobs: они создавались
    // локальными переменными и запускались, но stopAll() итерируется по Map и
    // останавливал только auto-sync и auto-expire. После SIGTERM старый
    // контейнер продолжал писать в БД во время запуска нового.
    // Сверка с Битриксом: пришёл / не пришёл по сделкам «Офис» и стадиям
    // лида, отказы и переносы будущих встреч в карточке. Страховка к событиям
    // Битрикса и опросу — исправляет всё, что они пропустили, и пишет отчёт
    // (RECONCILE_DRIFT). Раз в час — вчера и сегодня, ночью — 7 дней.
    const reconcileJob = (expr, daysBack, label) => cron.schedule(expr, async () => {
      try {
        if (process.env.ENABLE_LEADS_SYNC !== 'true' || !process.env.BITRIX_REST_URL) return;
        const { reconcileRecentAppointments } = require('./reconcile');
        const report = await reconcileRecentAppointments({ daysBack });
        console.log(`Reconcile ${label} done:`, { changes: report.changes, byReason: report.byReason, skipped: report.skipped || null, error: report.error || null });
      } catch (error) {
        console.error(`Reconcile ${label} cron error:`, error.message);
      }
    }, { scheduled: false, timezone: 'Europe/Minsk' });

    this.register('leads-sync', leadsSyncJob);
    this.register('dedupe', dedupeJob);
    this.register('no-show-leads', noShowLeadsJob);
    this.register('reconcile-hourly', reconcileJob(plan.reconcileHourly, plan.reconcileHourlyDays, 'hourly'));
    this.register('reconcile-nightly', reconcileJob(plan.reconcileNightly, plan.reconcileNightlyDays, 'nightly'));

    for (const [name, job] of this.jobs) {
      job.start();
      console.log(`- Started ${name}`);
    }
    this.started = true;
  }

  register(name, job) {
    this.jobs.set(name, job);
    return job;
  }

  // Остановка всех cron задач
  stopAll() {
    console.log('Stopping cron jobs...');
    for (const [name, job] of this.jobs) {
      try {
        job.stop();
        console.log(`- Stopped ${name}`);
      } catch (e) {
        console.error(`- Failed to stop ${name}:`, e?.message || e);
      }
    }
    this.jobs.clear();
    this.started = false;
  }

  // Получить статус всех задач
  getStatus() {
    const status = {};
    for (const [name, job] of this.jobs) {
      status[name] = {
        running: job.running,
        scheduled: job.scheduled
      };
    }
    return status;
  }
}

module.exports = new CronService();
module.exports.schedules = schedules;
