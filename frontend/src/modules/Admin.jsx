import React, { useEffect, useMemo, useState } from 'react'
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
  { key: '1', label: 'Пн' },
  { key: '2', label: 'Вт' },
  { key: '3', label: 'Ср' },
  { key: '4', label: 'Чт' },
  { key: '5', label: 'Пт' },
  { key: '6', label: 'Сб' },
  { key: '0', label: 'Вс' },
]

function halfHourSlots(start, end) {
  const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m }
  const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
  const res = []
  let s = toMin(start), e = toMin(end)
  for (let t=s; t<e; t+=30) res.push({ start: toTime(t), end: toTime(t+30) })
  return res
}

export function Admin() {
  const api = useApi()
  const [offices, setOffices] = useState([])
  const [officeId, setOfficeId] = useState('')

  // Create office form
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')

  // Template builder (typical week)
  const [tplName, setTplName] = useState('Типовой график')
  const [weekdays, setWeekdays] = useState({ '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '0': [] })
  const [rangeStart, setRangeStart] = useState(() => new Date().toISOString().slice(0,10))
  const [rangeEnd, setRangeEnd] = useState(() => new Date(Date.now()+6*86400000).toISOString().slice(0,10))

  // Day editor modal
  const [dayModalOpen, setDayModalOpen] = useState(false)
  const [dayDate, setDayDate] = useState(() => new Date().toISOString().slice(0,10))
  const [daySlots, setDaySlots] = useState([])
  const [periodStart, setPeriodStart] = useState('09:00')
  const [periodEnd, setPeriodEnd] = useState('18:00')

  useEffect(() => {
    api.get('/offices').then(r => setOffices(r.data.data))
  }, [api])

  const refreshOffices = async () => {
    const r = await api.get('/offices'); setOffices(r.data.data)
  }

  const createOffice = async () => {
    if (!name || !city || !address) return
    await api.post('/offices', { name, city, address })
    await refreshOffices()
    setName(''); setCity(''); setAddress('')
  }

  const startEditOffice = (o) => setOfficeId(o.id)
  const saveOfficeEdit = async (o) => {
    await api.put(`/offices/${o.id}`, { name: o.name, city: o.city, address: o.address })
    await refreshOffices()
  }
  const deleteOffice = async (id) => {
    if (!confirm('Удалить офис?')) return
    await api.delete(`/offices/${id}`)
    if (officeId === id) setOfficeId('')
    await refreshOffices()
  }

  const addSlotToDayKey = (dayKey) => {
    const copy = { ...weekdays }
    copy[dayKey] = [ ...(copy[dayKey] || []), { start: '09:00', end: '09:30' } ]
    setWeekdays(copy)
  }
  const updateSlotInDayKey = (dayKey, idx, field, value) => {
    const copy = { ...weekdays }
    copy[dayKey] = copy[dayKey].map((s,i) => i===idx ? { ...s, [field]: value } : s)
    setWeekdays(copy)
  }
  const removeSlotFromDayKey = (dayKey, idx) => {
    const copy = { ...weekdays }
    copy[dayKey] = copy[dayKey].filter((_,i)=>i!==idx)
    setWeekdays(copy)
  }
  const fillDayKeyByPeriod = (dayKey) => {
    const slots = halfHourSlots(periodStart, periodEnd)
    const copy = { ...weekdays }
    copy[dayKey] = slots
    setWeekdays(copy)
  }
  const clearDayKey = (dayKey) => {
    const copy = { ...weekdays }
    copy[dayKey] = []
    setWeekdays(copy)
  }

  const saveTemplate = async () => {
    await api.post('/templates', { name: tplName, weekdays, office_id: officeId || null })
    alert('Шаблон сохранен')
  }

  const applyTemplate = async () => {
    // find last created template for simplicity by name
    // In a real app you'd select template explicitly
    const tpls = await api.get('/templates')
    const tpl = (tpls.data.data || []).filter(t => t.name === tplName).pop()
    if (!tpl) return alert('Сначала сохраните шаблон')
    if (!officeId) return alert('Выберите офис')
    await api.post(`/templates/${tpl.id}/apply`, { office_id: officeId, start_date: rangeStart, end_date: rangeEnd })
    alert('Шаблон применен на диапазон')
  }

  const openDayEditor = async () => {
    if (!officeId) return alert('Выберите офис')
    const r = await api.get('/slots/all', { params: { office_id: officeId, date: dayDate } })
    setDaySlots(r.data.data || [])
    setDayModalOpen(true)
  }
  const addRowDay = () => setDaySlots([...daySlots, { start: '09:00', end: '09:30' }])
  const updateRowDay = (idx, field, value) => setDaySlots(daySlots.map((s,i)=> i===idx ? { ...s, [field]: value } : s))
  const removeRowDay = (idx) => setDaySlots(daySlots.filter((_,i)=> i!==idx))
  const fillDayByPeriod = () => setDaySlots(halfHourSlots(periodStart, periodEnd))
  const clearDay = () => setDaySlots([])
  const saveDay = async () => {
    if (!officeId) return
    await api.post('/slots/bulk', { office_id: officeId, date: dayDate, slots: daySlots })
    setDayModalOpen(false)
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial' }}>
      <h2>Админка</h2>

      <section style={{ marginTop: 12 }}>
        <h3>Выбор офиса</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={officeId} onChange={e=>setOfficeId(e.target.value)}>
            <option value="">— офис —</option>
            {offices.map(o => <option key={o.id} value={o.id}>{o.name} • {o.city}</option>)}
          </select>
          <span style={{ color:'#999' }}>или создайте новый:</span>
          <input placeholder="Название" value={name} onChange={e=>setName(e.target.value)} />
          <input placeholder="Город" value={city} onChange={e=>setCity(e.target.value)} />
          <input placeholder="Адрес" value={address} onChange={e=>setAddress(e.target.value)} />
          <button onClick={createOffice}>Создать</button>
        </div>
        <div style={{ marginTop: 8 }}>
          {offices.map(o => (
            <div key={o.id} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 2fr auto auto', gap:8, alignItems:'center', padding:'6px 0', borderBottom:'1px dashed #eee' }}>
              <input value={o.name} onChange={e=>{ o.name=e.target.value; setOffices([...offices]) }} />
              <input value={o.city} onChange={e=>{ o.city=e.target.value; setOffices([...offices]) }} />
              <input value={o.address} onChange={e=>{ o.address=e.target.value; setOffices([...offices]) }} />
              <button onClick={()=>saveOfficeEdit(o)}>Сохранить</button>
              <button onClick={()=>deleteOffice(o.id)} style={{ background:'#fee', color:'#900' }}>Удалить</button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Типовой график (шаблон недели)</h3>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input placeholder="Название шаблона" value={tplName} onChange={e=>setTplName(e.target.value)} />
          <span style={{ color:'#999' }}>Быстрое заполнение периода:</span>
          <input type="time" value={periodStart} onChange={e=>setPeriodStart(e.target.value)} />
          <span>—</span>
          <input type="time" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)} />
          <span style={{ color:'#999' }}>(получатся 30-минутные слоты)</span>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(280px, 1fr))', gap:12, marginTop:12 }}>
          {DOW.map(d => (
            <div key={d.key} style={{ border:'1px solid #eee', borderRadius:6, padding:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <strong>{d.label}</strong>
                <div>
                  <button onClick={()=>fillDayKeyByPeriod(d.key)} style={{ marginRight:8 }}>Заполнить периодом</button>
                  <button onClick={()=>clearDayKey(d.key)}>Очистить</button>
                </div>
              </div>
              <div style={{ marginTop:8 }}>
                {(weekdays[d.key]||[]).map((s, idx) => (
                  <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6 }}>
                    <input type="time" value={s.start} onChange={e=>updateSlotInDayKey(d.key, idx, 'start', e.target.value)} />
                    <span>—</span>
                    <input type="time" value={s.end} onChange={e=>updateSlotInDayKey(d.key, idx, 'end', e.target.value)} />
                    <button onClick={()=>removeSlotFromDayKey(d.key, idx)} style={{ marginLeft:6 }}>Удалить</button>
                  </div>
                ))}
                <button onClick={()=>addSlotToDayKey(d.key)}>Добавить слот</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop:12, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={saveTemplate}>Сохранить шаблон</button>
          <span style={{ color:'#999' }}>Применить к офису на диапазон:</span>
          <input type="date" value={rangeStart} onChange={e=>setRangeStart(e.target.value)} />
          <input type="date" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)} />
          <button onClick={applyTemplate}>Применить</button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Отдельный день (исключение)</h3>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input type="date" value={dayDate} onChange={e=>setDayDate(e.target.value)} />
          <button onClick={openDayEditor}>Редактировать день</button>
        </div>
      </section>

      {dayModalOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:8, padding:16, width: 'min(720px, 92vw)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ margin:0 }}>День {dayDate}</h3>
              <button onClick={()=>setDayModalOpen(false)}>✕</button>
            </div>
            <div style={{ marginTop:8, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <span>Быстрое заполнение:</span>
              <input type="time" value={periodStart} onChange={e=>setPeriodStart(e.target.value)} />
              <span>—</span>
              <input type="time" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)} />
              <button onClick={fillDayByPeriod}>Заполнить</button>
              <button onClick={clearDay}>Очистить</button>
            </div>
            <div style={{ marginTop:12 }}>
              {daySlots.map((s, idx) => (
                <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6 }}>
                  <input type="time" value={s.start} onChange={e=>updateRowDay(idx, 'start', e.target.value)} />
                  <span>—</span>
                  <input type="time" value={s.end} onChange={e=>updateRowDay(idx, 'end', e.target.value)} />
                  <button onClick={()=>removeRowDay(idx)} style={{ marginLeft:6 }}>Удалить</button>
                </div>
              ))}
              <button onClick={addRowDay}>Добавить слот</button>
            </div>
            <div style={{ marginTop:12, display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={()=>setDayModalOpen(false)} style={{ background:'#eee', color:'#333' }}>Отмена</button>
              <button onClick={saveDay}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}