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

export function Admin() {
  const api = useApi()
  const [offices, setOffices] = useState([])
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')

  const [templates, setTemplates] = useState([])
  const [tplName, setTplName] = useState('Типовой график')
  const [weekdays, setWeekdays] = useState({
    '1': [{ start: '09:00', end: '09:30' }, { start: '10:00', end: '10:30' }],
    '2': [], '3': [], '4': [], '5': [], '6': [], '0': []
  })

  const [applyOfficeId, setApplyOfficeId] = useState('')
  const [rangeStart, setRangeStart] = useState(() => new Date().toISOString().slice(0,10))
  const [rangeEnd, setRangeEnd] = useState(() => new Date(Date.now()+6*86400000).toISOString().slice(0,10))
  const [tplId, setTplId] = useState('')

  useEffect(() => {
    api.get('/offices').then(r => setOffices(r.data.data))
    api.get('/templates').then(r => setTemplates(r.data.data))
  }, [api])

  const createOffice = async () => {
    if (!name || !city || !address) return
    await api.post('/offices', { name, city, address })
    const r = await api.get('/offices'); setOffices(r.data.data)
    setName(''); setCity(''); setAddress('')
  }

  const createTemplate = async () => {
    await api.post('/templates', { name: tplName, weekdays })
    const r = await api.get('/templates'); setTemplates(r.data.data)
  }

  const applyTemplate = async () => {
    if (!tplId || !applyOfficeId) return
    await api.post(`/templates/${tplId}/apply`, { office_id: applyOfficeId, start_date: rangeStart, end_date: rangeEnd })
    alert('Шаблон применен')
  }

  const setWeekdaySlots = (weekday, value) => {
    try {
      const parsed = JSON.parse(value)
      setWeekdays({ ...weekdays, [weekday]: parsed })
    } catch {}
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial' }}>
      <h2>Админка</h2>

      <section style={{ marginTop: 16 }}>
        <h3>Офисы</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Название" value={name} onChange={e=>setName(e.target.value)} />
          <input placeholder="Город" value={city} onChange={e=>setCity(e.target.value)} />
          <input placeholder="Адрес" value={address} onChange={e=>setAddress(e.target.value)} />
          <button onClick={createOffice}>Создать</button>
        </div>
        <ul>
          {offices.map(o => <li key={o.id}>{o.name} — {o.city}, {o.address}</li>)}
        </ul>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Шаблоны недели</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input placeholder="Название шаблона" value={tplName} onChange={e=>setTplName(e.target.value)} />
          <button onClick={createTemplate}>Сохранить шаблон</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginTop: 8 }}>
          {['1','2','3','4','5','6','0'].map(d => (
            <div key={d}>
              <div style={{ fontWeight: 600 }}>День {d}</div>
              <textarea rows={4} style={{ width: '100%' }}
                value={JSON.stringify(weekdays[d] || [])}
                onChange={e=>setWeekdaySlots(d, e.target.value)}
                placeholder='[{"start":"09:00","end":"09:30"}]'
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Применить шаблон</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={tplId} onChange={e=>setTplId(e.target.value)}>
              <option value="">— шаблон —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={applyOfficeId} onChange={e=>setApplyOfficeId(e.target.value)}>
              <option value="">— офис —</option>
              {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input type="date" value={rangeStart} onChange={e=>setRangeStart(e.target.value)} />
            <input type="date" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)} />
            <button onClick={applyTemplate}>Применить</button>
          </div>
        </div>
      </section>
    </div>
  )
}