const cron = require('node-cron');
const axios = require('axios');
const { autoSyncStatuses, autoExpireAppointments, dedupeAppointments, fetchAndAnalyzeBitrixLeads, syncMissingAppointments } = require('./syncTasks');

class CronService {
  constructor() {
    this.jobs = new Map();
    // prod-safe default to port 4000; override with API_BASE_URL
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000/api';
    this.cronToken = process.env.CRON_TOKEN || 'internal-cron-token';
    this.adminBearer = process.env.CRON_ADMIN_TOKEN || '';
  }

  // Запуск автоматической синхронизации статусов каждые 5 минут
  startAutoSync() {
    const job = cron.schedule('*/5 * * * *', async () => {
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

    this.jobs.set('auto-sync', job);
    return job;
  }

  // Запуск автоматического истечения просроченных встреч каждый час
  startAutoExpire() {
    const job = cron.schedule('0 * * * *', async () => {
      try {
        console.log('Running automatic appointment expiration (direct)...');
        const result = await autoExpireAppointments();
        console.log(`Auto expire completed: ${result.expired} appointments expired`);
        
      } catch (error) {
        console.error('Auto expire cron error:', error.message);
      }
    }, {
      scheduled: false,
      timezone: "Europe/Minsk"
    });

    this.jobs.set('auto-expire', job);
    return job;
  }

  // Запуск всех cron задач
  startAll() {
    console.log('Starting cron jobs...');
    
    const autoSyncJob = this.startAutoSync();
    const autoExpireJob = this.startAutoExpire();
    // Синхронизация лидов для админской страницы (данные источника /admin/appointments/sync/bitrix24)
    const leadsSyncJob = cron.schedule('* * * * *', async () => {
      try {
        if (process.env.ENABLE_LEADS_SYNC !== 'true') {
          return; // feature is disabled unless explicitly enabled
        }
        console.log('Running admin leads sync (direct)...');
        if (!process.env.BITRIX_REST_URL) {
          console.warn('Leads sync skipped: BITRIX_REST_URL is not set');
          return;
        }
        const analysis = await fetchAndAnalyzeBitrixLeads();
        console.log('Admin leads sync analyze:', { toCreate: analysis?.toCreate?.length || 0, toUpdate: analysis?.toUpdate?.length || 0 });
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
    
    autoSyncJob.start();
    autoExpireJob.start();
    leadsSyncJob.start();
    dedupeJob.start();
    
    console.log('Cron jobs started:');
    console.log('- Auto sync statuses: every 5 minutes');
    console.log('- Auto expire appointments: every hour');
    console.log('- Admin leads sync: every minute (DEBUG MODE)');
    console.log('- Dedupe appointments: daily at 03:30');
  }

  // Остановка всех cron задач
  stopAll() {
    console.log('Stopping cron jobs...');
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`- Stopped ${name}`);
    }
    this.jobs.clear();
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
