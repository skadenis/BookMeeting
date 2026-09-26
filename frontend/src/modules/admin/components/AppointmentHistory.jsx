import React, { useEffect, useState } from 'react'
import { Timeline, Typography, Spin, Empty, Tag } from 'antd'
import dayjs from 'dayjs'
import api from '../../../api/client'

// Журнал встречи: кто и что менял. Раньше фоновые изменения (синхронизация по
// стадии лида, авто-истечение) не журналировались вовсе, и нельзя было
// понять, отменил ли встречу оператор или шахматка сама.

const ACTION_LABELS = {
  created: 'Запись в сетке',
  created_from_crm: 'Назначена в Битриксе мимо сетки — заведена в сетку',
  created_from_crm_overbooked: 'Назначена в Битриксе в полный слот — заведена сверх мест',
  updated_from_crm: 'Изменена в карточке Битрикса',
  rescheduled: 'Перенос',
  cancelled_by_rebooking: 'Отменена перезаписью на другой слот',
  no_show_by_rebooking: 'Не пришёл: после начала встречи записан на другой слот',
  cancelled_after_start: 'Не пришёл: оператор отменил после начала встречи',
  repair_no_show: 'Исправление истории: не пришёл (стадия 3 в день встречи)',
  repair_cancelled: 'Исправление истории: отказ в карточке до начала встречи',
  status_confirmed: 'Подтверждена',
  status_cancelled: 'Отменена',
  status_pending: 'Возвращена в «ожидает»',
  sync_pending: 'Стадия лида: «Встреча назначена»',
  sync_confirmed: 'Стадия лида: «Встреча подтверждена»',
  sync_no_show: 'Не пришёл',
  sync_completed: 'Пришёл',
  sync_cancelled: 'Лид ушёл со стадий встречи — отменена',
  restored_completed: 'Пришёл (после отметки «не пришёл»)',
  restored_pending: 'Возвращена из неявки',
  restored_confirmed: 'Возвращена из неявки',
  expired_no_show: 'Время прошло — не пришёл',
  visit_completed: 'Пришёл: заведена сделка «Офис»',
  visit_after_cancel: 'Пришёл, хотя встреча была отменена',
  reconcile_no_show: 'Сверка: не пришёл',
  reconcile_completed: 'Сверка: пришёл',
  reconcile_cancelled: 'Сверка: отменена',
  reconcile_confirmed: 'Сверка: подтверждена',
  reconcile_pending: 'Сверка: ожидает',
}

const COLOR = { completed: 'green', no_show: 'volcano', cancelled: 'red', confirmed: 'blue', pending: 'gold' }

function describeChange(row) {
  const b = row.before || {}
  const a = row.after || {}
  const parts = []
  if (b.status && a.status && b.status !== a.status) parts.push(`${b.status} → ${a.status}`)
  if (b.date && a.date && b.date !== a.date) parts.push(`${b.date} → ${a.date}`)
  if (b.timeSlot && a.timeSlot && b.timeSlot !== a.timeSlot) parts.push(`${b.timeSlot} → ${a.timeSlot}`)
  if (!row.before && a.date) parts.push(`${a.date} ${a.timeSlot || ''}`.trim())
  return parts.join(' · ')
}

export default function AppointmentHistory({ appointmentId }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!appointmentId) return
    let cancelled = false
    setRows(null)
    setError(null)
    api.get(`/admin/appointments/${appointmentId}/history`)
      .then((r) => { if (!cancelled) setRows(r.data.data || []) })
      .catch(() => { if (!cancelled) setError('Не удалось загрузить журнал') })
    return () => { cancelled = true }
  }, [appointmentId])

  if (error) return <Typography.Text type="danger">{error}</Typography.Text>
  if (!rows) return <Spin size="small" />
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Журнал пуст (запись старше 26.08.2026, когда журнал заработал)" />
  }

  return (
    <Timeline
      items={rows.map((row) => ({
        color: COLOR[row.after?.status] || 'gray',
        children: (
          <div>
            <div style={{ fontWeight: 600 }}>{ACTION_LABELS[row.action] || row.action}</div>
            <div style={{ fontSize: 12, color: '#666' }}>
              {dayjs(row.at).format('DD.MM.YYYY HH:mm:ss')} · {row.who}
              {row.bitrixStatus ? <Tag style={{ marginLeft: 6 }}>стадия {row.bitrixStatus}</Tag> : null}
            </div>
            {describeChange(row) ? <div style={{ fontSize: 12 }}>{describeChange(row)}</div> : null}
          </div>
        ),
      }))}
    />
  )
}
