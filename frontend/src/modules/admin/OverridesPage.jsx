import React, { useEffect, useMemo, useState } from 'react'
import { DatePicker, TimePicker, Button, Space, Select, message, Card } from 'antd'
import dayjs from 'dayjs'
import axios from 'axios'

function useApi() {
  const api = useMemo(() => axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' }), [])
  api.interceptors.request.use((config) => {
    config.headers['Authorization'] = 'Bearer dev'
    config.headers['X-Bitrix-Domain'] = 'dev'
    return config
  })
  return api
}

function halfHourSlots(start, end) {
  const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m }
  const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
  const res = []
  let s = toMin(start), e = toMin(end)
  for (let t=s; t<e; t+=30) res.push({ start: toTime(t), end: toTime(t+30) })
  return res
}

export default function OverridesPage() {
  const api = useApi()
  const [offices, setOffices] = useState([])
  const [officeId, setOfficeId] = useState('')
  const [date, setDate] = useState(dayjs())
  const [period, setPeriod] = useState([dayjs('09:00','HH:mm'), dayjs('18:00','HH:mm')])
  const [rows, setRows] = useState([])

  useEffect(() => { api.get('/offices').then(r=>setOffices(r.data.data)) }, [api])

  const loadDay = async () => {
    if (!officeId || !date) return
    const r = await api.get('/slots/all', { params: { office_id: officeId, date: date.format('YYYY-MM-DD') } })
    setRows(r.data.data || [])
  }

  const fill = () => {
    if (!period?.[0] || !period?.[1]) return
    setRows(halfHourSlots(period[0].format('HH:mm'), period[1].format('HH:mm')))
  }

  const addRow = () => setRows([ ...rows, { start:'09:00', end:'09:30' } ])
  const updateRow = (idx, field, value) => setRows(rows.map((s,i)=> i===idx ? { ...s, [field]: value } : s))
  const removeRow = (idx) => setRows(rows.filter((_,i)=> i!==idx))

  const save = async () => {
    if (!officeId || !date) return
    await api.post('/slots/bulk', { office_id: officeId, date: date.format('YYYY-MM-DD'), slots: rows })
    message.success('Сохранено')
  }

  return (
    <div>
      <h3 style={{ marginTop:0 }}>Исключения (день)</h3>
      <Space wrap>
        <Select value={officeId} onChange={setOfficeId} placeholder="Офис" style={{ width: 320 }}
          options={offices.map(o=>({ value:o.id, label:`${o.name} • ${o.city}` }))}
        />
        <DatePicker value={date} onChange={setDate} />
        <TimePicker.RangePicker value={period} onChange={setPeriod} format="HH:mm" minuteStep={30} />
        <Button onClick={loadDay}>Загрузить</Button>
        <Button onClick={fill}>Заполнить периодом</Button>
        <Button onClick={addRow}>Добавить слот</Button>
        <Button type="primary" onClick={save}>Сохранить</Button>
      </Space>

      <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'repeat(2, minmax(280px, 1fr))', gap:12 }}>
        {rows.map((s, idx) => (
          <Card key={idx} title={`Слот ${idx+1}`} extra={<Button danger onClick={()=>removeRow(idx)}>Удалить</Button>}>
            <Space>
              <TimePicker value={dayjs(s.start,'HH:mm')} format="HH:mm" minuteStep={30} onChange={(v)=>updateRow(idx, 'start', v.format('HH:mm'))} />
              <span>—</span>
              <TimePicker value={dayjs(s.end,'HH:mm')} format="HH:mm" minuteStep={30} onChange={(v)=>updateRow(idx, 'end', v.format('HH:mm'))} />
            </Space>
          </Card>
        ))}
      </div>
    </div>
  )
}