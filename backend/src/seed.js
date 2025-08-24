const { models } = require('./lib/db');

async function seedIfEmpty() {
	const officesCount = await models.Office.count();
	if (officesCount > 0) return;

	console.log('Seeding database with test data...');

	const msk = await models.Office.create({ name: 'Центральный офис', city: 'Москва', address: 'Тверская, 1' });
	const spb = await models.Office.create({ name: 'Северо-Запад', city: 'Санкт-Петербург', address: 'Невский, 10' });
	const ekb = await models.Office.create({ name: 'Уральский офис', city: 'Екатеринбург', address: 'Ленина, 50' });
	
	console.log('Created offices:', [msk.name, spb.name, ekb.name]);

	const offices = [msk, spb, ekb];
	const today = new Date();
	
	// Создаем расписание на 21 день: 7 дней назад + сегодня + 13 дней вперед
	for (const office of offices) {
		for (let d = -7; d < 14; d++) {
			const date = new Date(today);
			date.setDate(today.getDate() + d);
			const iso = date.toISOString().slice(0, 10);
			const weekday = date.getDay(); // 0 Sun - 6 Sat
			const isWorkingDay = weekday !== 0; // Sunday off
			
			const schedule = await models.Schedule.create({ 
				office_id: office.id, 
				date: iso, 
				isWorkingDay 
			});
			
					console.log(`Created schedule for ${office.name} on ${iso}, working day: ${isWorkingDay}`);
			
			if (isWorkingDay) {
				// Создаем слоты каждые 30 минут с 9:00 до 18:00
				const slots = [];
				for (let hour = 9; hour < 18; hour++) {
					// Слот 9:00-9:30
					slots.push([`${hour.toString().padStart(2, '0')}:00`, `${hour.toString().padStart(2, '0')}:30`]);
					// Слот 9:30-10:00
					if (hour < 17) {
						slots.push([`${hour.toString().padStart(2, '0')}:30`, `${(hour + 1).toString().padStart(2, '0')}:00`]);
					}
				}
				
				console.log(`Creating ${slots.length} slots for ${office.name} on ${iso} (${slots.length * 2} total slots)`);
				
				for (const [start, end] of slots) {
					await models.Slot.create({ 
						schedule_id: schedule.id, 
						start, 
						end, 
						available: true,
						capacity: Math.floor(Math.random() * 3) + 1 // Случайная вместимость 1-3
					});
				}
			} else {
				console.log(`Skipping slots for ${office.name} on ${iso} (not a working day)`);
			}
		}
	}

	// Создаем дефолтный шаблон для каждого офиса
	for (const office of offices) {
		await models.Template.create({
			name: `Стандартное расписание ${office.name}`,
			office_id: office.id,
			weekdays: {
				"1": [ // Понедельник
					{ start: "09:00", end: "09:30", capacity: 2 },
					{ start: "09:30", end: "10:00", capacity: 2 },
					{ start: "10:00", end: "10:30", capacity: 2 },
					{ start: "10:30", end: "11:00", capacity: 2 },
					{ start: "11:00", end: "11:30", capacity: 2 },
					{ start: "11:30", end: "12:00", capacity: 2 },
					{ start: "14:00", end: "14:30", capacity: 2 },
					{ start: "14:30", end: "15:00", capacity: 2 },
					{ start: "15:00", end: "15:30", capacity: 2 },
					{ start: "15:30", end: "16:00", capacity: 2 },
					{ start: "16:00", end: "16:30", capacity: 2 },
					{ start: "16:30", end: "17:00", capacity: 2 },
					{ start: "17:00", end: "17:30", capacity: 2 },
					{ start: "17:30", end: "18:00", capacity: 2 }
				],
				"2": [ // Вторник - аналогично
					{ start: "09:00", end: "09:30", capacity: 2 },
					{ start: "09:30", end: "10:00", capacity: 2 },
					{ start: "10:00", end: "10:30", capacity: 2 },
					{ start: "10:30", end: "11:00", capacity: 2 },
					{ start: "11:00", end: "11:30", capacity: 2 },
					{ start: "11:30", end: "12:00", capacity: 2 },
					{ start: "14:00", end: "14:30", capacity: 2 },
					{ start: "14:30", end: "15:00", capacity: 2 },
					{ start: "15:00", end: "15:30", capacity: 2 },
					{ start: "15:30", end: "16:00", capacity: 2 },
					{ start: "16:00", end: "16:30", capacity: 2 },
					{ start: "16:30", end: "17:00", capacity: 2 },
					{ start: "17:00", end: "17:30", capacity: 2 },
					{ start: "17:30", end: "18:00", capacity: 2 }
				],
				"3": [ // Среда
					{ start: "09:00", end: "09:30", capacity: 2 },
					{ start: "09:30", end: "10:00", capacity: 2 },
					{ start: "10:00", end: "10:30", capacity: 2 },
					{ start: "10:30", end: "11:00", capacity: 2 },
					{ start: "11:00", end: "11:30", capacity: 2 },
					{ start: "11:30", end: "12:00", capacity: 2 },
					{ start: "14:00", end: "14:30", capacity: 2 },
					{ start: "14:30", end: "15:00", capacity: 2 },
					{ start: "15:00", end: "15:30", capacity: 2 },
					{ start: "15:30", end: "16:00", capacity: 2 },
					{ start: "16:00", end: "16:30", capacity: 2 },
					{ start: "16:30", end: "17:00", capacity: 2 },
					{ start: "17:00", end: "17:30", capacity: 2 },
					{ start: "17:30", end: "18:00", capacity: 2 }
				],
				"4": [ // Четверг
					{ start: "09:00", end: "09:30", capacity: 2 },
					{ start: "09:30", end: "10:00", capacity: 2 },
					{ start: "10:00", end: "10:30", capacity: 2 },
					{ start: "10:30", end: "11:00", capacity: 2 },
					{ start: "11:00", end: "11:30", capacity: 2 },
					{ start: "11:30", end: "12:00", capacity: 2 },
					{ start: "14:00", end: "14:30", capacity: 2 },
					{ start: "14:30", end: "15:00", capacity: 2 },
					{ start: "15:00", end: "15:30", capacity: 2 },
					{ start: "15:30", end: "16:00", capacity: 2 },
					{ start: "16:00", end: "16:30", capacity: 2 },
					{ start: "16:30", end: "17:00", capacity: 2 },
					{ start: "17:00", end: "17:30", capacity: 2 },
					{ start: "17:30", end: "18:00", capacity: 2 }
				],
				"5": [ // Пятница
					{ start: "09:00", end: "09:30", capacity: 2 },
					{ start: "09:30", end: "10:00", capacity: 2 },
					{ start: "10:00", end: "10:30", capacity: 2 },
					{ start: "10:30", end: "11:00", capacity: 2 },
					{ start: "11:00", end: "11:30", capacity: 2 },
					{ start: "11:30", end: "12:00", capacity: 2 },
					{ start: "14:00", end: "14:30", capacity: 2 },
					{ start: "14:30", end: "15:00", capacity: 2 },
					{ start: "15:00", end: "15:30", capacity: 2 },
					{ start: "15:30", end: "16:00", capacity: 2 },
					{ start: "16:00", end: "16:30", capacity: 2 },
					{ start: "16:30", end: "17:00", capacity: 2 },
					{ start: "17:00", end: "17:30", capacity: 2 },
					{ start: "17:30", end: "18:00", capacity: 2 }
				]
			},
			isDefault: true
		});
	}

	console.log('Database seeded successfully!');
	console.log(`Created ${offices.length} offices with schedules and slots for 21 days`);
}

module.exports = { seedIfEmpty };