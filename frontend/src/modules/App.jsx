import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import { Layout, Row, Col, Card, Button, Select, Tag, Space, Modal } from 'antd'

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
const fullDayLabels = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']

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
      <Header style={{ background: '#fff', padding: '0 16px', borderBottom:'1px solid #f0f0f0' }}>
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
      <Modal open={!officeId} footer={null} closable={false} centered>
        <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Выберите офис</div>
        <Select autoFocus value={officeId || undefined} onChange={setOfficeId} placeholder="Офис" style={{ width:'100%' }}
          options={offices.map(o => ({ value:o.id, label:`${o.name} • ${o.city}` }))}
        />
      </Modal>
      <Content style={{ margin: 16 }}>
        {(() => {
          const timeSet = new Set()
          ;(allSlotsWeek || []).forEach(day => (day||[]).forEach(s => timeSet.add(s.start)))
          const timeRows = Array.from(timeSet).sort((a,b)=>a.localeCompare(b))
                     return (
                           <div style={{ display:'grid', gridTemplateColumns:'120px repeat(7, minmax(180px, 1fr))', gap:0, borderLeft:'2px solid #e6f4ff', borderTop:'2px solid #e6f4ff' }}>
               <div style={{ borderRight:'1px solid #f0f0f0', padding:'8px', background:'#fafafa', fontWeight:600 }}></div>
                               {daysLabels.map((label, idx) => {
                  const d = addDays(weekStart, idx)
                  const dd = dayjs(d).locale('ru')
                  return (
                    <div key={`h-${idx}`} style={{ borderRight:'1px solid #f0f0f0', padding:'8px', background:'#fafafa', fontWeight:600 }}>
                      {fullDayLabels[dd.day()]}<div style={{ fontWeight:400, color:'#666' }}>{dd.format('D MMMM YYYY')}</div> {dayHeaderBadge(idx)}
                    </div>
                  )
                })}
               {timeRows.map((t) => (
                 <React.Fragment key={`row-${t}`}>
                   <div style={{ borderRight:'1px solid #f0f0f0', borderBottom:'1px solid #f0f0f0', padding:'8px', color:'#666' }}>{t}</div>
                   {daysLabels.map((_, idx) => {
                     const slot = (allSlotsWeek[idx]||[]).find(s => s.start === t)
                     const baseStyle = { borderRight:'1px solid #f0f0f0', borderBottom:'1px solid #f0f0f0', padding:'6px' }
                     if (!slot) return <div key={`${idx}-${t}`} style={{ ...baseStyle, textAlign:'center', color:'#ccc' }}>—</div>
                     const a = findAvailability(idx, slot)
                     return (
                       <div key={`${idx}-${t}`} style={baseStyle}>
                         {a ? (
                           <Button size="small" block onClick={() => createAppointment(idx, slot)}
                             style={{ background:'#52c41a', borderColor:'#52c41a', color:'#fff' }}>
                             {t} • {a.free}/{a.capacity}
                           </Button>
                         ) : (
                           <Button size="small" block disabled
                             style={{ background:'#ff4d4f', borderColor:'#ff4d4f', color:'#fff', opacity:1 }}>
                             {t} • 0/{(slot && slot.capacity) || 1}
                           </Button>
                         )}
                       </div>
                     )
                   })}
                 </React.Fragment>
               ))}
             </div>
           )
        })()}
      </Content>
    </Layout>
  )
}