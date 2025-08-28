import React, { useEffect, useMemo, useState } from 'react'
import api from '../api/client'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import { Layout, Row, Col, Card, Button, Select, Tag, Space, Modal, Typography, Divider, Tooltip, Descriptions, message, Spin } from 'antd'
import { CalendarOutlined, EnvironmentOutlined, ClockCircleOutlined, ExclamationCircleOutlined, CheckCircleOutlined } from '@ant-design/icons'

const { Header, Content } = Layout


function useBitrixContext() {
  const [token, setToken] = useState(null)
  const [domain, setDomain] = useState(null)
  const [leadId, setLeadId] = useState(undefined)

  const extractParam = (name) => {
    try {
      const sp = new URLSearchParams(window.location.search)
      if (sp.has(name)) return sp.get(name)
      // В Bitrix часть параметров может оказаться после # — достанем через regex из href
      const href = String(window.location.href || '')
      const re = new RegExp(`[?#&]${name}=([^&#]+)`) // ищем и в hash тоже
      const m = href.match(re)
      return m ? decodeURIComponent(m[1]) : null
    } catch {
      return null
    }
  }

  // 1) Сохраняем AUTH_ID/DOMAIN/lead_id из query/hash в sessionStorage и применяем
  useEffect(() => {
    try {
      const qAuth = extractParam('AUTH_ID') || extractParam('auth') || extractParam('access_token')
      const qDomain = extractParam('DOMAIN') || extractParam('domain')
      const qLead = extractParam('lead_id') || extractParam('leadId') || extractParam('LEAD_ID')
      if (qAuth) { sessionStorage.setItem('bx.AUTH_ID', qAuth); setToken(qAuth) }
      if (qDomain) { sessionStorage.setItem('bx.DOMAIN', qDomain); setDomain(qDomain) }
      const idNum = Number(qLead)
      if (Number.isFinite(idNum) && idNum > 0) { sessionStorage.setItem('bx.LEAD_ID', String(idNum)); setLeadId(idNum) }
    } catch {}
  }, [])

  // 2) Если ничего нет в query — поднимаем из sessionStorage
  useEffect(() => {
    const sAuth = sessionStorage.getItem('bx.AUTH_ID')
    const sDomain = sessionStorage.getItem('bx.DOMAIN')
    const sLead = sessionStorage.getItem('bx.LEAD_ID')
    if (sAuth && !token) setToken(sAuth)
    if (sDomain && !domain) setDomain(sDomain)
    const n = Number(sLead)
    if (!leadId && Number.isFinite(n) && n > 0) setLeadId(n)
  }, [])

  useEffect(() => {
    if (window.BX24 && window.BX24.getAuth) {
      try {
        const auth = window.BX24.getAuth()
        setToken(prev => prev || auth?.access_token || null)
        setDomain(prev => prev || auth?.domain || null)
        if (window.BX24.placement && window.BX24.placement.info) {
          window.BX24.placement.info((info) => {
            const raw = info?.options?.entityId || info?.options?.ID || info?.options?.ENTITY_ID || info?.options?.LEAD_ID
            const id = Number(raw)
            // Не перезатираем leadId, если он уже пришёл из query-параметра
            setLeadId(prev => {
              if (Number.isFinite(prev) && prev > 0) return prev
              return Number.isFinite(id) && id > 0 ? id : 135624
            })
          })
        } else {
          setLeadId(prev => (Number.isFinite(prev) && prev > 0 ? prev : 135624))
        }
      } catch {
        setLeadId(prev => (Number.isFinite(prev) && prev > 0 ? prev : 135624))
      }
    } else {
      setToken(import.meta.env.VITE_DEV_BITRIX_TOKEN || null)
      setDomain(import.meta.env.VITE_DEV_BITRIX_DOMAIN || null)
      setLeadId(prev => (Number.isFinite(prev) && prev > 0 ? prev : (Number(import.meta.env.VITE_DEV_LEAD_ID) || 135624)))

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

function toLocalISO(date) { return dayjs(date).format('YYYY-MM-DD') }

const daysLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
const fullDayLabels = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']


export function App() {
  const { token, domain, leadId } = useBitrixContext()
  const [publicOk, setPublicOk] = useState(false)
  // Read app public token from query and require it
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const t = sp.get('app_token')
      const id = sp.get('app_id')
      if (t) sessionStorage.setItem('app.publicToken', t)
      if (id) sessionStorage.setItem('app.publicId', id)
      if (t || id) {
        const url = new URL(window.location.href)
        url.searchParams.delete('app_token')
        url.searchParams.delete('app_id')
        window.history.replaceState({}, '', url.toString())
      }
      {
        // Require both id and token
        const tok = sessionStorage.getItem('app.publicToken') || import.meta.env.VITE_PUBLIC_APP_TOKEN
        const pid = sessionStorage.getItem('app.publicId') || import.meta.env.VITE_PUBLIC_APP_ID
        setPublicOk(!!tok && !!pid)
      }
    } catch { setPublicOk(!!import.meta.env.VITE_PUBLIC_APP_TOKEN && !!import.meta.env.VITE_PUBLIC_APP_ID) }
  }, [])
  console.log('App rendered with leadId:', leadId)
  const apiInstance = useMemo(() => api, [token, domain])

  const [offices, setOffices] = useState([])
  const [officeId, setOfficeId] = useState('')
  const [leadOfficeBitrixId, setLeadOfficeBitrixId] = useState(null)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [loading, setLoading] = useState(false)
  const [officesLoading, setOfficesLoading] = useState(true)
  const [leadLoading, setLeadLoading] = useState(true)

  // Data for week view
  const [allSlotsWeek, setAllSlotsWeek] = useState([[],[],[],[],[],[],[]])
  const [availableWeek, setAvailableWeek] = useState([[],[],[],[],[],[],[]])
  const [leadAppt, setLeadAppt] = useState(null)
  
  const [autoSelectAttempted, setAutoSelectAttempted] = useState(false)

  

  useEffect(() => {
    setOfficesLoading(true)
    apiInstance.get('/offices')
      .then(r => setOffices(r.data.data))
      .catch(console.error)
      .finally(() => setOfficesLoading(false))
  }, [apiInstance])

  // Auto-select office from Bitrix lead field UF_CRM_1675255265
  useEffect(() => {
    async function fetchLeadAndAutoselect() {
      try {
        if (!leadId) return
        setLeadLoading(true)
        const r = await apiInstance.get('/bitrix/lead', { params: { id: leadId } })
        const bxIdRaw = r?.data?.lead?.UF_CRM_1675255265
        const bxId = Number(bxIdRaw)
        const validBxId = Number.isFinite(bxId) && bxId > 0 ? bxId : null
        setLeadOfficeBitrixId(validBxId)
        if (validBxId && offices?.length && !officeId) {
          const matched = offices.find(o => Number(o.bitrixOfficeId) === validBxId)
          if (matched) setOfficeId(matched.id)
        }
      } catch (e) { /* silent */ }
      finally { setLeadLoading(false) }
    }
    fetchLeadAndAutoselect()
  }, [api, leadId, offices, officeId])

  // Final guard: attempt auto-select once both lead and offices are known,
  // and only then allow showing the office modal if nothing selected.
  useEffect(() => {
    const bootstrapping = officesLoading || leadLoading
    if (bootstrapping) return
    if (autoSelectAttempted) return
    if (officeId) { setAutoSelectAttempted(true); return }
    // If there is no office id in lead at all, we consider attempt done
    if (!(Number.isFinite(Number(leadOfficeBitrixId)) && Number(leadOfficeBitrixId) > 0)) {
      setAutoSelectAttempted(true)
      return
    }
    // Try to match once offices are loaded
    if (offices && offices.length > 0) {
      const matched = offices.find(o => Number(o.bitrixOfficeId) === Number(leadOfficeBitrixId))
      if (matched) setOfficeId(matched.id)
      setAutoSelectAttempted(true)
    }
  }, [officesLoading, leadLoading, officeId, leadOfficeBitrixId, offices, autoSelectAttempted])

  // When operator chooses office, push it to Bitrix lead immediately (only office field)
  useEffect(() => {
    async function syncLeadOffice() {
      try {
        if (!leadId || !officeId) return
        const selected = offices.find(o => String(o.id) === String(officeId))
        const bxId = Number(selected?.bitrixOfficeId)
        if (!Number.isFinite(bxId) || bxId <= 0) return
        if (Number(leadOfficeBitrixId || 0) === bxId) return
        await apiInstance.post('/bitrix/lead/update-office', { lead_id: leadId, office_id: officeId })
        setLeadOfficeBitrixId(bxId)
      } catch (e) { /* silent */ }
    }
    syncLeadOffice()
  }, [api, leadId, officeId, offices, leadOfficeBitrixId])

  async function loadLeadAppt() {
    if (!leadId) { setLeadAppt(null); return }
    try {
      const r = await apiInstance.get('/appointments', { params: { lead_id: leadId } })
      const items = (r.data && r.data.data) || []
      console.log('Loaded appointments for lead', leadId, ':', items)
      setLeadAppt(items[0] || null)
    } catch (e) { 
      console.error('Failed to load appointments:', e)
      setLeadAppt(null) 
    }
  }

  async function loadWeek() {
    if (!officeId) { setAllSlotsWeek([[],[],[],[],[],[],[]]); setAvailableWeek([[],[],[],[],[],[],[]]); return }
    setLoading(true)
    try {
      const days = [...Array(7)].map((_,i) => toLocalISO(addDays(weekStart,i)))
      const [allSlots, available] = await Promise.all([
        Promise.all(days.map(d => apiInstance.get('/slots/all', { params: { office_id: officeId, date: d } }).then(r=>r.data.data)) ),
        Promise.all(days.map(d => apiInstance.get('/slots', { params: { office_id: officeId, date: d } }).then(r=>r.data.data)) ),
      ])
      // Ensure ordering by time for stable visual
      const byTime = (a,b) => a.start.localeCompare(b.start)
      setAllSlotsWeek(allSlots.map(list => (list||[]).slice().sort(byTime)))
      setAvailableWeek(available.map(list => (list||[]).slice().sort(byTime)))
    } finally { setLoading(false) }
  }

  useEffect(() => { loadWeek() }, [apiInstance, officeId, weekStart])
  useEffect(() => { loadLeadAppt() }, [apiInstance, leadId])

  // Websocket live updates
  useEffect(() => {
    let ws
    try {
      const base = '/api'
      // Convert base to absolute ws URL if needed
      let url
      if (base.startsWith('http')) {
        const u = new URL(base.replace(/\/$/, ''))
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
        u.pathname = (u.pathname.replace(/\/$/, '')) + '/ws'
        url = u.toString()
      } else {
        // Assume same origin
        const loc = window.location
        url = `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${base.replace(/\/$/, '')}/ws`
      }
      ws = new WebSocket(url)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'slots.updated') {
            // If update concerns selected office and week window, refresh
            if (officeId && msg.office_id && String(msg.office_id) === String(officeId)) {
              loadWeek()
            }
          } else if (msg.type === 'appointment.updated') {
            // If appointment concerns our lead, refresh banner
            const lead = msg?.appointment?.lead_id
            if (lead && leadId && Number(lead) === Number(leadId)) {
              loadLeadAppt()
            } else {
              // Also refresh available slots since appointment affects capacity
              if (officeId) loadWeek()
            }
          } else if (msg.type === 'time.tick') {
            // Periodic time tick: refresh today to hide past slots
            if (officeId) loadWeek()
          }
        } catch {}
      }
    } catch {}
    return () => { try { ws && ws.close() } catch {} }
  }, [officeId, leadId])

  const dayHeaderBadge = (dayIdx) => {
    const all = allSlotsWeek[dayIdx] || []
    const avail = availableWeek[dayIdx] || []
    if (all.length === 0) return <Tag color="default">Нет расписания</Tag>
    if (isPastDay(dayIdx)) return <Tag color="default">Прошло</Tag>
    if (isToday(dayIdx)) {
      const futureAll = all.filter(s => !isPastSlot(dayIdx, s))
      if (futureAll.length === 0) return <Tag color="default">Прошло</Tag>
      const futureAvail = avail.filter(s => !isPastSlot(dayIdx, s))
      if (futureAvail.length === 0) return <Tag color="error">Занято</Tag>
      return <Tag color="success">Доступно</Tag>
    }
    if (avail.length === 0) return <Tag color="error">Занято</Tag>
    return <Tag color="success">Доступно</Tag>
  }

  const findAvailability = (dayIdx, slot) => {
    const list = availableWeek[dayIdx] || []
    return list.find(s => s.start === slot.start && s.end === slot.end)
  }

  const isUserBookedOnSlot = (dayIdx, slot) => {
    if (!leadAppt) return false
    const bookedOfficeId = leadAppt?.Office?.id || leadAppt?.office_id || leadAppt?.office?.id
    if (!bookedOfficeId || bookedOfficeId !== officeId) return false
    const date = toLocalISO(addDays(weekStart, dayIdx))
    const timeSlot = `${slot.start}-${slot.end}`
    return leadAppt.date === date && leadAppt.timeSlot === timeSlot
  }

  const isPastSlot = (dayIdx, slot) => {
    try {
      const dateObj = new Date(addDays(weekStart, dayIdx))
      const [hh, mm] = (slot?.start || '00:00').split(':').map(Number)
      dateObj.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
      return dateObj.getTime() < Date.now()
    } catch {
      return false
    }
  }

  const isPastDay = (dayIdx) => {
    const endOfDay = dayjs(addDays(weekStart, dayIdx)).endOf('day').toDate()
    return endOfDay.getTime() < Date.now()
  }

  const isToday = (dayIdx) => {
    return toLocalISO(addDays(weekStart, dayIdx)) === toLocalISO(new Date())
  }

  const jumpToLeadOffice = () => {
    const bookedOfficeId = leadAppt?.Office?.id || leadAppt?.office?.id || leadAppt?.office_id
    if (!bookedOfficeId) return
    setOfficeId(bookedOfficeId)
    setWeekStart(startOfWeek(leadAppt.date))
  }

  const createAppointment = async (dayIdx, slot) => {
    if (!officeId) return
    const date = toLocalISO(addDays(weekStart, dayIdx))
    try {
      const response = await apiInstance.post('/appointments', {
        office_id: officeId,
        date,
        time_slot: `${slot.start}-${slot.end}`,
        lead_id: leadId,
      })
      message.success('Встреча забронирована')
      await loadWeek()
      await loadLeadAppt()
    } catch (e) {
      console.error('Create appointment failed', e)
      message.error('Не удалось забронировать. Попробуйте ещё раз')
    }
  }

  const updateAppointmentStatus = async (id, status) => {
    await apiInstance.put(`/appointments/${id}`, { status })
    await loadWeek()
    await loadLeadAppt()
  }

  const goToday = () => setWeekStart(startOfWeek(new Date()))
  const prevWeek = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek = () => setWeekStart(addDays(weekStart, 7))

  const isAppointmentInPast = (appt) => {
    try {
      if (!appt) return false
      const [start, end] = String(appt.timeSlot||'').split('-')
      const endTime = end || start || '00:00'
      const dt = dayjs(`${appt.date} ${endTime}`, 'YYYY-MM-DD HH:mm')
      return dt.isBefore(dayjs())
    } catch { return false }
  }

  const bootstrapping = officesLoading || leadLoading

  if (!publicOk) {
    return (
      <Layout style={{ minHeight: '100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ textAlign:'center', color:'#666', fontSize:16 }}>Нет доступа.</div>
      </Layout>
    )
  }

  if (bootstrapping) {
    return (
      <Layout style={{ minHeight: '100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ textAlign:'center' }}>
          <Spin size="large" tip="Загружаем данные лида и офисы..." />
          <div style={{ marginTop: 12, color:'#666' }}>Пожалуйста, подождите</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ position:'sticky', top:0, zIndex:100, background: '#fff', padding: '0 16px', borderBottom:'1px solid #f0f0f0' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ fontWeight: 600 }}>Запись на встречу{leadId ? ` • Лид #${leadId}` : ''}</div>
          <Select value={officeId} onChange={setOfficeId} placeholder="Выберите офис" style={{ minWidth: 260 }}
            options={offices.filter(o => Number(o.bitrixOfficeId) > 0).map(o => ({ value:o.id, label: ([o.city, o.address].filter(Boolean).join(', ') || 'Адрес не указан') }))}
          />
          <Space>
            <Button onClick={prevWeek}>←</Button>
            <Button onClick={goToday}>Сегодня</Button>
            <Button onClick={nextWeek}>→</Button>
          </Space>
          <div style={{ color:'#666' }}>{toLocalISO(weekStart)} — {toLocalISO(addDays(weekStart,6))}</div>
        </div>
      </Header>
      <Modal open={!officeId && !bootstrapping && autoSelectAttempted} footer={null} closable={false} centered maskClosable={false} title={null}>
        <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Выбор офиса</div>
        <Typography.Paragraph type="secondary" style={{ marginTop:0 }}>
          Мы не смогли определить офис из данных лида автоматически. Выбор офиса нужен,
          чтобы показать доступные слоты и правильно записать клиента по адресу.
        </Typography.Paragraph>
        <Select
          autoFocus
          value={officeId || undefined}
          onChange={setOfficeId}
          placeholder="Выберите офис"
          style={{ width:'100%' }}
          options={offices.filter(o => Number(o.bitrixOfficeId) > 0).map(o => ({ value:o.id, label:[o.city, o.address].filter(Boolean).join(', ') }))}
        />
      </Modal>
      <Content style={{ margin: 16 }}>
        {leadAppt && !isAppointmentInPast(leadAppt) && (() => { const dd = dayjs(leadAppt.date).locale('ru'); return (
          <Card style={{ marginBottom: 12, borderColor:'#e6f4ff' }}>
            <Space direction="vertical" size={4} style={{ width:'100%' }}>
              <Typography.Text type="secondary">Запланирована встреча</Typography.Text>
              <Typography.Title level={4} style={{ margin:0 }}>
                <EnvironmentOutlined style={{ color:'#1677ff', marginRight:8 }} />
                <a onClick={jumpToLeadOffice} style={{ color:'#1677ff' }}>
                  {[leadAppt.Office?.city || leadAppt.office?.city, leadAppt.Office?.address || leadAppt.office?.address].filter(Boolean).join(', ') || 'Адрес не указан'}
                </a>
              </Typography.Title>
              <Space size={16} wrap style={{ marginTop: 8 }}>
                <Typography.Text><CalendarOutlined style={{ color:'#1677ff', marginRight:6 }} />{dd.format('dddd, D MMMM YYYY')}</Typography.Text>
                <Typography.Text><ClockCircleOutlined style={{ color:'#1677ff', marginRight:6 }} />{leadAppt.timeSlot}</Typography.Text>
                {isAppointmentInPast(leadAppt) ? (
                  <Tag color="default">Прошло</Tag>
                ) : (
                  <Tag color={leadAppt.status === 'pending' ? 'gold' : 'green'}>{leadAppt.status === 'pending' ? 'Ожидает подтверждения' : 'Подтверждена'}</Tag>
                )}
              </Space>
              <Divider style={{ margin:'8px 0' }} />
              <Space>
                {leadAppt.status !== 'confirmed' && <Button type="primary" size="large" onClick={() => Modal.confirm({
                  title: (<span><CheckCircleOutlined style={{ color:'#52c41a', marginRight:8 }} />Подтвердить встречу?</span>),
                  content: 'Вы уверены, что хотите подтвердить эту встречу?',
                  okText:'Да, подтвердить', cancelText:'Нет', okButtonProps:{ type:'primary' },
                  onOk: () => updateAppointmentStatus(leadAppt.id, 'confirmed')
                })}>Подтвердить</Button>}
                <Button size="large" danger onClick={() => Modal.confirm({
                  title: (<span><ExclamationCircleOutlined style={{ color:'#faad14', marginRight:8 }} />Подтвердите отмену</span>),
                  content: 'Вы уверены, что хотите отменить встречу?',
                  okText:'Да, отменить', cancelText:'Нет', okButtonProps:{ danger:true },
                  onOk: () => updateAppointmentStatus(leadAppt.id, 'cancelled')
                })}>Отменить</Button>
              </Space>
            </Space>
          </Card>
        )})()}
        {(() => {
          if (!officeId) return null
          // Build dynamic time rows from earliest start to latest end at 30-min steps
          const toMin = (t) => { const [h,m] = (t||'00:00').split(':').map(Number); return (Number.isFinite(h)?h:0)*60 + (Number.isFinite(m)?m:0) }
          const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
          let minStart = Infinity, maxEnd = -Infinity
          ;(allSlotsWeek || []).forEach(day => (day||[]).forEach(s => {
            minStart = Math.min(minStart, toMin(s.start))
            maxEnd = Math.max(maxEnd, toMin(s.end))
          }))
          if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || minStart>=maxEnd) return null
          const timeRows = []
          for (let t=minStart; t<maxEnd; t+=30) timeRows.push(toTime(t))
                     return (
                           <div style={{ display:'grid', gridTemplateColumns:'repeat(7, minmax(180px, 1fr))', gap:0, borderLeft:'2px solid #e6f4ff', borderTop:'2px solid #e6f4ff' }}>
                  {daysLabels.map((label, idx) => {
                    const d = addDays(weekStart, idx)
                    const dd = dayjs(d).locale('ru')
                    return (
                      <div key={`h-${idx}`} style={{ position:'sticky', top:64, zIndex:2, borderRight:'1px solid #f0f0f0', padding:'8px', background:'#fafafa', fontWeight:600 }}>
                        {fullDayLabels[dd.day()]}<div style={{ fontWeight:400, color:'#666' }}>{dd.format('D MMMM YYYY')}</div> {dayHeaderBadge(idx)}
                      </div>
                    )
                  })}
                  {timeRows.map((t) => (
                    <React.Fragment key={`row-${t}`}>
                      {daysLabels.map((_, idx) => {
                        const slot = (allSlotsWeek[idx]||[]).find(s => s.start === t)
                        const baseStyle = { borderRight:'1px solid #f0f0f0', borderBottom:'1px solid #f0f0f0', padding:'6px', background:'#fafafa' }
                        if (!slot) return <div key={`${idx}-${t}`} style={{ ...baseStyle, textAlign:'center', color:'#ccc' }}>—</div>
                        const a = findAvailability(idx, slot)
                        const isBooked = isUserBookedOnSlot(idx, slot)
                        const isPast = isPastSlot(idx, slot)
                        
                        return (
                          <div key={`${idx}-${t}`} style={baseStyle}>
                            {isBooked ? (
                              isPast ? (
                                <Button size="middle" block disabled
                                  style={{ background:'#d9d9d9', borderColor:'#d9d9d9', color:'#fff', opacity:1, fontSize:'13px' }}>
                                  {t} | прошло
                                </Button>
                              ) : (
                                <Button size="middle" block onClick={() => Modal.confirm({
                                  title: (<span><ExclamationCircleOutlined style={{ color:'#faad14', marginRight:8 }} />Подтвердите отмену</span>),
                                  content: 'Вы уверены, что хотите отменить встречу?',
                                  okText:'Да, отменить', cancelText:'Нет', okButtonProps:{ danger:true },
                                  onOk: () => updateAppointmentStatus(leadAppt.id, 'cancelled')
                                })}
                                  style={{ background:'#faad14', borderColor:'#faad14', color:'#fff', fontSize:'13px' }}
                                  icon={<CheckCircleOutlined />}>
                                  {t} | отменить
                                </Button>
                              )
                            ) : isPast ? (
                              <Button size="middle" block disabled
                                style={{ background:'#d9d9d9', borderColor:'#d9d9d9', color:'#fff', opacity:1, fontSize:'13px' }}>
                                {t} | прошло
                              </Button>
                            ) : a ? (
                              <Button size="middle" block onClick={() => {
                                const office = (offices||[]).find(o=>o.id===officeId)
                                const d = addDays(weekStart, idx)
                                const dd = dayjs(d).locale('ru')
                                const dateStr = dd.format('dddd, D MMMM YYYY')
                                Modal.confirm({
                                  title: (<span><CheckCircleOutlined style={{ color:'#52c41a', marginRight:8 }} />Назначить встречу?</span>),
                                  centered: true,
                                  width: 640,
                                  content: (
                                    <Descriptions column={1} bordered size="middle"
                                      labelStyle={{ width: 140, fontWeight: 500 }}
                                      contentStyle={{ fontWeight: 600 }}>
                                      <Descriptions.Item label="Офис">{office ? [office.city, office.address].filter(Boolean).join(', ') : officeId}</Descriptions.Item>
                                      {office?.addressNote ? (
                                        <Descriptions.Item label="Примечание">{office.addressNote}</Descriptions.Item>
                                      ) : null}
                                      <Descriptions.Item label="Дата">{dateStr}</Descriptions.Item>
                                      <Descriptions.Item label="Время">{`${slot.start} — ${slot.end}`}</Descriptions.Item>
                                    </Descriptions>
                                  ),
                                  okText:'Да, назначить', cancelText:'Нет', okButtonProps:{ type:'primary' },
                                  onOk: () => createAppointment(idx, slot)
                                })
                              }}
                                style={{ background:'#52c41a', borderColor:'#52c41a', color:'#fff', fontSize:'13px' }}>
                                {t} | {a.free} свободно
                              </Button>
                            ) : (
                              <Button size="middle" block disabled
                                style={{ background:'#ff4d4f', borderColor:'#ff4d4f', color:'#fff', opacity:1, fontSize:'13px' }}>
                                {t} | нет мест
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