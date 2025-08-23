import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

function useBitrixContext() {
  const [token, setToken] = useState(null)
  const [domain, setDomain] = useState(null)
  const [leadId, setLeadId] = useState(undefined)

  useEffect(() => {
    if (window.BX24 && window.BX24.getAuth) {
      try {
        const auth = window.BX24.getAuth()
        setToken(auth?.access_token || null)
        setDomain(auth?.domain || null)
        // TODO: set leadId from widget context if available
      } catch {}
    } else {
      setToken(import.meta.env.VITE_DEV_BITRIX_TOKEN || null)
      setDomain(import.meta.env.VITE_DEV_BITRIX_DOMAIN || null)
    }
  }, [])

  return { token, domain, leadId }
}

function startOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay() // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day // shift to Monday
  d.setDate(d.getDate() + diff)
  d.setHours(0,0,0,0)
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toISODate(date) { return new Date(date).toISOString().slice(0,10) }

function timeToMinutes(t) { const [h,m] = t.split(':').map(Number); return h*60+m }
function minutesToTime(mins) { const h = Math.floor(mins/60).toString().padStart(2,'0'); const m = (mins%60).toString().padStart(2,'0'); return `${h}:${m}` }

function mergeTimeRange(allSlotsWeek) {
  let min = Infinity, max = -Infinity
  for (const daySlots of allSlotsWeek) {
    for (const s of daySlots) {
      min = Math.min(min, timeToMinutes(s.start))
      max = Math.max(max, timeToMinutes(s.end))
    }
  }
  if (!isFinite(min) || !isFinite(max)) { min = 9*60; max = 18*60 } // default 09:00-18:00
  // expand to full half-hour grid
  min = Math.floor(min/30)*30
  max = Math.ceil(max/30)*30
  const times = []
  for (let t=min; t<max; t+=30) times.push(minutesToTime(t))
  return times
}

export function App() {
  const { token, domain, leadId } = useBitrixContext()
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' })
    instance.interceptors.request.use((config) => {
      if (token) config.headers.Authorization = `Bearer ${token}`
      if (domain) config.headers['X-Bitrix-Domain'] = domain
      return config
    })
    return instance
  }, [token, domain])

  const [offices, setOffices] = useState([])
  const [officeId, setOfficeId] = useState('')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [loading, setLoading] = useState(false)

  // Data for week view
  const [allSlotsWeek, setAllSlotsWeek] = useState([[],[],[],[],[],[],[]])
  const [availableWeek, setAvailableWeek] = useState([[],[],[],[],[],[],[]])

  useEffect(() => {
    api.get('/offices').then(r => setOffices(r.data.data)).catch(console.error)
  }, [api])

  async function loadWeek() {
    if (!officeId) { setAllSlotsWeek([[],[],[],[],[],[],[]]); setAvailableWeek([[],[],[],[],[],[],[]]); return }
    setLoading(true)
    try {
      const days = [...Array(7)].map((_,i) => toISODate(addDays(weekStart,i)))
      const [allSlots, available] = await Promise.all([
        Promise.all(days.map(d => api.get('/slots/all', { params: { office_id: officeId, date: d } }).then(r=>r.data.data)) ),
        Promise.all(days.map(d => api.get('/slots', { params: { office_id: officeId, date: d } }).then(r=>r.data.data)) ),
      ])
      setAllSlotsWeek(allSlots)
      setAvailableWeek(available)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadWeek() }, [api, officeId, weekStart])

  const times = useMemo(() => mergeTimeRange(allSlotsWeek), [allSlotsWeek])

  const daysLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
  const dayHeaderBadge = (dayIdx) => {
    const all = allSlotsWeek[dayIdx] || []
    const avail = availableWeek[dayIdx] || []
    if (all.length === 0) return <span style={{ color:'#999', fontSize:12 }}>Нет расписания</span>
    if (avail.length === 0) return <span style={{ color:'#c00', fontSize:12 }}>Все занято</span>
    return <span style={{ color:'#0a0', fontSize:12 }}>Доступно</span>
  }

  const isSlotAvailable = (dayIdx, start, end) => {
    const list = availableWeek[dayIdx] || []
    return list.find(s => s.start === start && s.end === end)
  }

  const findSlotByTime = (dayIdx, time) => {
    const list = allSlotsWeek[dayIdx] || []
    return list.find(s => s.start === time)
  }

  const createAppointment = async (dayIdx, slot) => {
    if (!officeId) return
    const date = toISODate(addDays(weekStart, dayIdx))
    await api.post('/appointments', {
      office_id: officeId,
      date,
      time_slot: `${slot.start}-${slot.end}`,
      lead_id: leadId,
    })
    await loadWeek()
  }

  const goToday = () => setWeekStart(startOfWeek(new Date()))
  const prevWeek = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek = () => setWeekStart(addDays(weekStart, 7))

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial', padding: 16 }}>
      <h2 style={{ margin: '8px 0' }}>Запись на встречу</h2>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label>Офис</label><br />
          <select value={officeId} onChange={e=>setOfficeId(e.target.value)}>
            <option value="">— выберите офис —</option>
            {offices.map(o => <option key={o.id} value={o.id}>{o.name} • {o.city}</option>)}
          </select>
        </div>
        <div>
          <label>Неделя</label><br />
          <button onClick={prevWeek}>{'←'}</button>
          <button onClick={goToday} style={{ margin: '0 8px' }}>Сегодня</button>
          <button onClick={nextWeek}>{'→'}</button>
          <span style={{ marginLeft: 8, color:'#555' }}>
            {toISODate(weekStart)} — {toISODate(addDays(weekStart,6))}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {loading && <div>Загрузка…</div>}
        <div style={{ overflowX: 'auto', border: '1px solid #eee' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 80 }}></th>
                {daysLabels.map((d, idx) => (
                  <th key={idx} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>
                    {d} {toISODate(addDays(weekStart, idx))}<br/>
                    {dayHeaderBadge(idx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map(t => (
                <tr key={t}>
                  <td style={{ padding: 6, borderRight:'1px solid #f0f0f0', color:'#666', width:80 }}>{t}</td>
                  {daysLabels.map((_, idx) => {
                    const slot = findSlotByTime(idx, t)
                    if (!slot) {
                      return <td key={idx} style={{ padding: 6, height: 36, borderBottom:'1px solid #fafafa' }}>—</td>
                    }
                    const available = isSlotAvailable(idx, slot.start, slot.end)
                    return (
                      <td key={idx} style={{ padding: 6, height: 36, borderBottom:'1px solid #fafafa' }}>
                        {available ? (
                          <button onClick={() => createAppointment(idx, slot)} style={{ padding:'4px 8px' }}>
                            Записать ({available.free}/{available.capacity})
                          </button>
                        ) : (
                          <span style={{ color:'#999' }}>Занято</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}