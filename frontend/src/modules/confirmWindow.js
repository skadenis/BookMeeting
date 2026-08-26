// Зеркало backend/src/lib/confirmWindow.js + backend/src/lib/time.js.
// Правило подтверждения должно совпадать с серверным, иначе кнопка и сервер
// снова начнут противоречить друг другу. Меняешь здесь — меняй и там.

export const BUSINESS_TZ = 'Europe/Minsk'
export const CONFIRM_WINDOW_HOURS = 24

// Время встречи считается настенным временем офиса, а не машины оператора:
// у оператора часовой пояс может быть выставлен неверно, и раньше это молча
// сдвигало окно подтверждения.
function offsetMinutesAt(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})

  const asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  )
  return (asIfUTC - instant.getTime()) / 60000
}

export function parseBusinessDateTime(dateValue, timeValue) {
  const date = String(dateValue || '').slice(0, 10)
  const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dm) return null

  const tm = String(timeValue || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!tm) return null

  const hour = Number(tm[1])
  const minute = Number(tm[2])
  if (hour > 23 || minute > 59) return null

  const naive = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hour, minute)
  let ts = naive - offsetMinutesAt(new Date(naive)) * 60000
  ts = naive - offsetMinutesAt(new Date(ts)) * 60000
  const result = new Date(ts)
  return Number.isNaN(result.getTime()) ? null : result
}

export function slotStart(timeSlot) { return String(timeSlot || '').split('-')[0] }
export function slotEnd(timeSlot) {
  const parts = String(timeSlot || '').split('-')
  return parts.length > 1 ? parts[1] : parts[0]
}

// Текущая дата в зоне офиса — зеркало businessToday() из backend/src/lib/time.js.
// Нужна там, где раньше сравнивали с локальной датой браузера оператора.
export function businessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function appointmentStart(appt) {
  return parseBusinessDateTime(appt?.date, slotStart(appt?.timeSlot))
}
export function appointmentEnd(appt) {
  return parseBusinessDateTime(appt?.date, slotEnd(appt?.timeSlot)) || appointmentStart(appt)
}

export function isAppointmentFinished(appt, now = new Date()) {
  const end = appointmentEnd(appt)
  return end ? now.getTime() >= end.getTime() : false
}

// Окно открыто с (начало − 24ч) и до конца встречи — ровно пока карточка
// встречи видна оператору.
export function evaluateConfirmWindow(appt, now = new Date()) {
  const start = appointmentStart(appt)
  const end = appointmentEnd(appt)

  if (!start) return { allowed: false, reason: 'invalid_time', hoursUntil: null, opensAt: null }

  const opensAt = new Date(start.getTime() - CONFIRM_WINDOW_HOURS * 3600 * 1000)
  const hoursUntil = (start.getTime() - now.getTime()) / 3600000

  if (now.getTime() < opensAt.getTime()) return { allowed: false, reason: 'too_early', hoursUntil, opensAt }
  if (end && now.getTime() >= end.getTime()) return { allowed: false, reason: 'finished', hoursUntil, opensAt }
  return { allowed: true, reason: 'ok', hoursUntil, opensAt }
}

// Разные причины — разные подсказки. Раньше на все случаи показывался один
// текст про «более 24 часов», в том числе когда встреча уже прошла или время
// вообще не разобралось, и по жалобам оператора нельзя было понять причину.
export function confirmBlockedHint(verdict, formatDateTime) {
  switch (verdict.reason) {
    case 'too_early':
      return verdict.opensAt
        ? `До встречи ещё ${formatHours(verdict.hoursUntil)}. Подтвердить можно будет с ${formatDateTime(verdict.opensAt)}`
        : `Подтвердить встречу можно не раньше чем за ${CONFIRM_WINDOW_HOURS} часа до начала`
    case 'finished':
      return 'Встреча уже завершилась — подтвердить её нельзя'
    case 'invalid_time':
      return 'Не удалось определить время встречи. Обратитесь в поддержку'
    default:
      return 'Подтвердить встречу сейчас нельзя'
  }
}

function formatHours(hours) {
  if (hours === null || !Number.isFinite(hours)) return ''
  const total = Math.max(0, Math.round(hours * 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return `${d} ${plural(d, 'день', 'дня', 'дней')} ${h % 24} ${plural(h % 24, 'час', 'часа', 'часов')}`
  }
  if (h === 0) return `${m} ${plural(m, 'минута', 'минуты', 'минут')}`
  return `${h} ${plural(h, 'час', 'часа', 'часов')} ${m} ${plural(m, 'минута', 'минуты', 'минут')}`
}

function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
