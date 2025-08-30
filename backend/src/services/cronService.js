const cron = require('node-cron');
const axios = require('axios');

class CronService {
  constructor() {
    this.jobs = new Map();
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
  }

  // Запуск автоматической синхронизации статусов каждые 15 минут
  startAutoSync() {
    const job = cron.schedule('*/15 * * * *', async () => {
      try {
        console.log('Running automatic status sync...');
        
        const response = await axios.post(`${this.apiBaseUrl}/admin/sync/auto-sync-statuses`, {}, {
          timeout: 120000, // 2 минуты таймаут
          headers: {
            'Content-Type': 'application/json',
            // Добавляем внутренний токен для cron задач
            'X-Cron-Token': process.env.CRON_TOKEN || 'internal-cron-token'
          }
        });

        const result = response.data.data;
        console.log(`Auto sync completed: ${result.updated} updated, ${result.expired} expired`);
        
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
        console.log('Running automatic appointment expiration...');
        
        const response = await axios.post(`${this.apiBaseUrl}/admin/sync/auto-expire`, {}, {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json',
            'X-Cron-Token': process.env.CRON_TOKEN || 'internal-cron-token'
          }
        });

        const result = response.data.data;
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
    
    autoSyncJob.start();
    autoExpireJob.start();
    
    console.log('Cron jobs started:');
    console.log('- Auto sync statuses: every 15 minutes');
    console.log('- Auto expire appointments: every hour');
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
