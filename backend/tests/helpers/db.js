// Общая подготовка тестовой БД.
//
// Прежние «интеграционные» тесты подменяли всё приложение заглушкой на express,
// возвращавшей выдуманные ответы, и не проверяли ни одного реального маршрута.
// При этом beforeEach чистил таблицы, которых никто не создавал, — набор падал
// целиком (22 из 22) даже при поднятой базе.
const { sequelize, models } = require('../../src/lib/db');

async function resetDatabase() {
  await sequelize.sync({ force: true });
}

async function closeDatabase() {
  await sequelize.close();
}

// Офис + расписание + слот на заданную дату
async function seedSchedule({ date, start = '10:00', end = '10:30', capacity = 1, city = 'Минск', address = 'ул. Тестовая, 1' }) {
  const office = await models.Office.create({ city, address, bitrixOfficeId: 777 });
  const schedule = await models.Schedule.create({ office_id: office.id, date, isWorkingDay: true });
  const slot = await models.Slot.create({ schedule_id: schedule.id, start, end, available: true, capacity });
  return { office, schedule, slot, timeSlot: `${start}-${end}` };
}

module.exports = { resetDatabase, closeDatabase, seedSchedule, sequelize, models };
