const { models } = require('./lib/db');

async function seedIfEmpty() {
	const officesCount = await models.Office.count();
	if (officesCount > 0) return;

	const msk = await models.Office.create({ name: 'Центральный офис', city: 'Москва', address: 'Тверская, 1' });
	const spb = await models.Office.create({ name: 'Северо-Запад', city: 'Санкт-Петербург', address: 'Невский, 10' });

	const offices = [msk, spb];
	const today = new Date();
	for (const office of offices) {
		for (let d = 0; d < 7; d++) {
			const date = new Date(today);
			date.setDate(today.getDate() + d);
			const iso = date.toISOString().slice(0, 10);
			const weekday = date.getDay(); // 0 Sun - 6 Sat
			const isWorkingDay = weekday !== 0; // Sunday off
			const schedule = await models.Schedule.create({ office_id: office.id, date: iso, isWorkingDay });
			if (isWorkingDay) {
				const slots = [
					['09:00', '09:30'], ['09:30', '10:00'], ['10:00', '10:30'], ['10:30', '11:00'],
					['11:00', '11:30'], ['11:30', '12:00'], ['14:00', '14:30'], ['14:30', '15:00'],
					['15:00', '15:30'], ['15:30', '16:00']
				];
				for (const [start, end] of slots) {
					await models.Slot.create({ schedule_id: schedule.id, start, end, available: true });
				}
			}
		}
	}
}

module.exports = { seedIfEmpty };