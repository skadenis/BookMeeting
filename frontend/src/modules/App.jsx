import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Layout, Row, Col, Card, Button, Select, Tag, Space } from 'antd'

const { Header, Content } = Layout

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

const daysLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']

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
      // Ensure ordering by time for stable visual
      const byTime = (a,b) => a.start.localeCompare(b.start)
      setAllSlotsWeek(allSlots.map(list => (list||[]).slice().sort(byTime)))
      setAvailableWeek(available.map(list => (list||[]).slice().sort(byTime)))
    } finally { setLoading(false) }
  }

  useEffect(() => { loadWeek() }, [api, officeId, weekStart])

  const dayHeaderBadge = (dayIdx) => {
    const all = allSlotsWeek[dayIdx] || []
    const avail = availableWeek[dayIdx] || []
    if (all.length === 0) return <Tag color="default">Нет расписания</Tag>
    if (avail.length === 0) return <Tag color="error">Все занято</Tag>
    return <Tag color="success">Доступно</Tag>
  }

  const findAvailability = (dayIdx, slot) => {
    const list = availableWeek[dayIdx] || []
    return list.find(s => s.start === slot.start && s.end === slot.end)
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
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 16px' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ fontWeight: 600 }}>Запись на встречу</div>
          <Select value={officeId} onChange={setOfficeId} placeholder="Выберите офис" style={{ minWidth: 260 }}
            options={offices.map(o => ({ value:o.id, label:`${o.name} • ${o.city}` }))}
          />
          <Space>
            <Button onClick={prevWeek}>←</Button>
            <Button onClick={goToday}>Сегодня</Button>
            <Button onClick={nextWeek}>→</Button>
          </Space>
          <div style={{ color:'#666' }}>{toISODate(weekStart)} — {toISODate(addDays(weekStart,6))}</div>
        </div>
      </Header>
      <Content style={{ margin: 16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7, minmax(180px, 1fr))', gap:12 }}>
          {daysLabels.map((label, idx) => (
            <Card key={idx} loading={loading} title={<span>{label} {toISODate(addDays(weekStart, idx))} {dayHeaderBadge(idx)}</span>}>
              {(allSlotsWeek[idx]||[]).length === 0 ? (
                <div style={{ color:'#999' }}>Нет слотов</div>
              ) : (
                (allSlotsWeek[idx]||[]).map((slot) => {
                  const a = findAvailability(idx, slot)
                  return (
                    <div key={`${slot.start}-${slot.end}`} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0', borderBottom:'1px dashed #f0f0f0' }}>
                      <div style={{ color:'#555' }}>{slot.start}–{slot.end}</div>
                      {a ? (
                        <Button size="small" type="primary" onClick={() => createAppointment(idx, slot)}>
                          Записать ({a.free}/{a.capacity})
                        </Button>
                      ) : (
                        <Tag color="default">Занято</Tag>
                      )}
                    </div>
                  )
                })
              )}
            </Card>
          ))}
        </div>
      </Content>
    </Layout>
  )
}