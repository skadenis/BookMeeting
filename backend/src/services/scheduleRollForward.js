// Продление расписания вперёд.
//
// Расписание в шахматке заводит администратор руками (применяет шаблон на
// диапазон дат). На 25.09 у всех офисов оно заканчивалось 30.09, а запись
// открыта на 7 дней вперёд: с 25.09 виджет показывал «Нет расписания» на 1–2
// октября, и такие встречи операторы ставили прямо в Битриксе. У Гомеля
// пропущена обычная пятница 05.09.
//
// Задача раз в сутки дозаполняет пустые даты в окне записи по тому же дню
// недели за 4 прошлые недели: берёт самую частую раскладку слотов (время и
// вместимость) среди рабочих дней. Разовые решения — закрытый день, короткий
// день — в большинство не попадают и дальше не тиражируются. Признак
// is_customized для этого не годится: админка ставит его на любой день, к
// которому прикасалась (на проде он true у всех 212 дней с августа).
// Существующие дни не трогаются никогда. Если образца нет (воскресенье в
// регионах — там расписания нет вовсе), день остаётся пустым.

const { sequelize, models } = require('../lib/db');
const { businessToday } = require('../lib/time');
const { getMaxBookingDays } = require('./bookingGuard');

const LOOKBACK_WEEKS = 4;

function addDays(iso, n) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

const signature = (slots) => slots.map((sl) => `${sl.start}-${sl.end}x${sl.capacity}${sl.available === false ? 'c' : ''}`).join(',');

async function findSource(officeId, isoDate) {
	const candidates = [];
	for (let w = 1; w <= LOOKBACK_WEEKS; w++) {
		const date = addDays(isoDate, -7 * w);
		const schedule = await models.Schedule.findOne({ where: { office_id: officeId, date } });
		if (!schedule || schedule.isWorkingDay === false) continue;
		const slots = await models.Slot.findAll({ where: { schedule_id: schedule.id }, order: [['start', 'ASC']] });
		if (!slots.some((sl) => sl.available !== false && Number(sl.capacity) > 0)) continue;
		candidates.push({ schedule, slots, sig: signature(slots) });
	}
	if (candidates.length === 0) return null;
	// Самая частая раскладка; при равенстве — самая свежая (кандидаты идут от свежих)
	const freq = candidates.reduce((m, c) => m.set(c.sig, (m.get(c.sig) || 0) + 1), new Map());
	return candidates.slice().sort((a, b) => freq.get(b.sig) - freq.get(a.sig))[0];
}

/**
 * Дозаполнить пустые даты от сегодня до сегодня + горизонт записи + extraDays.
 * dryRun — только отчёт.
 */
async function rollForwardSchedules({ extraDays = 7, dryRun = false, today = businessToday() } = {}) {
	const horizon = (await getMaxBookingDays()) + Math.max(0, Number(extraDays) || 0);
	const offices = await models.Office.findAll();
	const report = { from: today, to: addDays(today, horizon), created: [], noSource: [], dryRun: !!dryRun };

	for (const office of offices) {
		for (let i = 0; i <= horizon; i++) {
			const date = addDays(today, i);
			const exists = await models.Schedule.findOne({ where: { office_id: office.id, date } });
			if (exists) continue;
			const source = await findSource(office.id, date);
			if (!source) {
				report.noSource.push({ officeId: office.id, city: office.city, date });
				continue;
			}
			report.created.push({ officeId: office.id, city: office.city, date, from: source.schedule.date, slots: source.slots.length, working: source.schedule.isWorkingDay !== false });
			if (dryRun) continue;
			await sequelize.transaction(async (tx) => {
				// Повторная проверка внутри транзакции: администратор мог завести
				// день, пока мы искали образец.
				const again = await models.Schedule.findOne({ where: { office_id: office.id, date }, transaction: tx });
				if (again) return;
				const schedule = await models.Schedule.create({
					office_id: office.id,
					date,
					isWorkingDay: true,
					isCustomized: false,
				}, { transaction: tx });
				for (const s of source.slots) {
					await models.Slot.create({
						schedule_id: schedule.id,
						start: s.start,
						end: s.end,
						available: s.available !== false,
						capacity: s.capacity,
					}, { transaction: tx });
				}
			});
		}
	}

	if (report.created.length) {
		console.log(`SCHEDULE_ROLLFORWARD ${dryRun ? '(проверка) ' : ''}продлено дней: ${report.created.length}`,
			report.created.map((c) => `${c.city} ${c.date}←${c.from}`).join(', '));
	}
	return report;
}

module.exports = { rollForwardSchedules };
