import React, { useEffect, useMemo, useState } from 'react'
import { Button, Space, Input, DatePicker, TimePicker, Select, message, Card } from 'antd'
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

const DOW = [
  { key: '1', label: 'Пн' },{ key: '2', label: 'Вт' },{ key: '3', label: 'Ср' },{ key: '4', label: 'Чт' },{ key: '5', label: 'Пт' },{ key: '6', label: 'Сб' },{ key: '0', label: 'Вс' }
]

function halfHourSlots(start, end) {
  const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m }
  const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
  const res = []
  let s = toMin(start), e = toMin(end)
  for (let t=s; t<e; t+=30) res.push({ start: toTime(t), end: toTime(t+30) })
  return res
}

export default function TemplatesPage() {
  const api = useApi()
  const [offices, setOffices] = useState([])
  const [officeId, setOfficeId] = useState('')
  const [name, setName] = useState('Типовой график')
  const [weekdays, setWeekdays] = useState({ '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '0': [] })
  const [period, setPeriod] = useState([dayjs('09:00','HH:mm'), dayjs('18:00','HH:mm')])
  const [range, setRange] = useState([dayjs(), dayjs().add(6,'day')])

  useEffect(() => { api.get('/offices').then(r=>setOffices(r.data.data)) }, [api])

  const fill = (key) => {
    if (!period?.[0] || !period?.[1]) return
    const slots = halfHourSlots(period[0].format('HH:mm'), period[1].format('HH:mm')).map(s => ({ ...s, capacity: 1 }))
    setWeekdays({ ...weekdays, [key]: slots })
  }
  const addSlot = (key) => setWeekdays({ ...weekdays, [key]: [ ...(weekdays[key]||[]), { start:'09:00', end:'09:30', capacity: 1 } ] })
  const updateSlot = (key, idx, field, val) => setWeekdays({ ...weekdays, [key]: (weekdays[key]||[]).map((s,i)=> i===idx ? { ...s, [field]: val } : s) })
  const removeSlot = (key, idx) => setWeekdays({ ...weekdays, [key]: (weekdays[key]||[]).filter((_,i)=>i!==idx) })

  const saveTemplate = async () => {
    await api.post('/templates', { name, weekdays, office_id: officeId || null })
    message.success('Шаблон сохранен')
  }
  const applyTemplate = async () => {
    const tpls = await api.get('/templates')
    const tpl = (tpls.data.data||[]).filter(t=>t.name===name).pop()
    if (!tpl) return message.error('Сохраните шаблон')
    if (!officeId) return message.error('Выберите офис')
    await api.post(`/templates/${tpl.id}/apply`, { office_id: officeId, start_date: range[0].format('YYYY-MM-DD'), end_date: range[1].format('YYYY-MM-DD') })
    message.success('Применено')
  }

  return (
    <div>
      <h3 style={{ marginTop:0 }}>Шаблоны</h3>
      <Space wrap>
        <Input placeholder="Название" value={name} onChange={e=>setName(e.target.value)} style={{ width: 240 }} />
        <Select value={officeId} onChange={setOfficeId} placeholder="Привязать к офису (необязательно)" style={{ width: 320 }}
          options={[{ value:'', label:'— без привязки —' }, ...offices.map(o=>({ value:o.id, label:`${o.name} • ${o.city}` }))]}
        />
        <TimePicker.RangePicker value={period} onChange={setPeriod} format="HH:mm" minuteStep={30} />
        <Button onClick={saveTemplate} type="primary">Сохранить</Button>
      </Space>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(280px, 1fr))', gap:12, marginTop:12 }}>
        {DOW.map(d => (
          <Card key={d.key} title={d.label} extra={<Button onClick={()=>fill(d.key)}>Заполнить периодом</Button>}>
            {(weekdays[d.key]||[]).map((s, idx) => (
              <Space key={idx} style={{ marginBottom:8 }}>
                <TimePicker value={dayjs(s.start,'HH:mm')} format="HH:mm" minuteStep={30} onChange={(v)=>updateSlot(d.key, idx, 'start', v.format('HH:mm'))} />
                <span>—</span>
                <TimePicker value={dayjs(s.end,'HH:mm')} format="HH:mm" minuteStep={30} onChange={(v)=>updateSlot(d.key, idx, 'end', v.format('HH:mm'))} />
                <Input type="number" min={1} value={s.capacity || 1} style={{ width:90 }} onChange={(e)=>updateSlot(d.key, idx, 'capacity', Number(e.target.value)||1)} prefix="cap:" />
                <Button danger onClick={()=>removeSlot(d.key, idx)}>Удалить</Button>
              </Space>
            ))}
            <div><Button onClick={()=>addSlot(d.key)}>Добавить слот</Button></div>
          </Card>
        ))}
      </div>

      <div style={{ marginTop:12 }}>
        <Space>
          <DatePicker.RangePicker value={range} onChange={setRange} />
          <Button onClick={applyTemplate}>Применить к офису и диапазону</Button>
        </Space>
      </div>
    </div>
  )
}