// Единый источник правды по времени для бизнес-логики.
//
// Контейнер бэкенда запускается без TZ и потому живёт в UTC, а офисы работают
// по Минску. Раньше проверка окна подтверждения парсила "YYYY-MM-DDTHH:mm:00"
// без указания зоны — то есть трактовала минское время как UTC и считала, что
// до встречи на 3 часа больше, чем на самом деле. Здесь время встречи всегда
// разбирается как настенное время бизнес-зоны, независимо от TZ процесса.

const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Europe/Minsk';

// Смещение бизнес-зоны относительно UTC в минутах на конкретный момент.
// Считается через Intl, поэтому переживёт возможное возвращение перевода часов.
function offsetMinutesAt(instant) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: BUSINESS_TZ,
		hour12: false,
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	}).formatToParts(instant).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

	const asIfUTC = Date.UTC(
		Number(parts.year), Number(parts.month) - 1, Number(parts.day),
		Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
	);
	return (asIfUTC - instant.getTime()) / 60000;
}

// "2026-08-27" + "10:00" -> момент времени, когда в Минске 10:00 27 августа.
function parseBusinessDateTime(dateValue, timeValue) {
	const date = String(dateValue || '').slice(0, 10);
	const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!dm) return null;

	const time = String(timeValue || '').trim();
	const tm = time.match(/^(\d{1,2}):(\d{2})/);
	if (!tm) return null;

	const hour = Number(tm[1]);
	const minute = Number(tm[2]);
	if (hour > 23 || minute > 59) return null;

	const naive = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hour, minute);
	// Два прохода: первый даёт приблизительное смещение, второй уточняет его
	// на случай, если момент попал на границу перевода часов.
	let ts = naive - offsetMinutesAt(new Date(naive)) * 60000;
	ts = naive - offsetMinutesAt(new Date(ts)) * 60000;
	const result = new Date(ts);
	return Number.isNaN(result.getTime()) ? null : result;
}

function slotStart(timeSlot) { return String(timeSlot || '').split('-')[0]; }
function slotEnd(timeSlot) {
	const parts = String(timeSlot || '').split('-');
	return parts.length > 1 ? parts[1] : parts[0];
}

// Текущее настенное время бизнес-зоны в виде "YYYY-MM-DD" / "HH:mm".
function businessNowParts(now = new Date()) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: BUSINESS_TZ,
		hour12: false,
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit',
	}).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		time: `${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}`,
	};
}

function businessToday(now = new Date()) { return businessNowParts(now).date; }

module.exports = {
	BUSINESS_TZ,
	parseBusinessDateTime,
	slotStart,
	slotEnd,
	businessNowParts,
	businessToday,
};
