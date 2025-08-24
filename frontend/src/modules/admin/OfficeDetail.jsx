import React, { useEffect, useMemo, useState } from 'react'
import { Tabs, Card, Space, Button, DatePicker, Typography, message, Skeleton, Select, Input } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import axios from 'axios'

function useApi() {
  const api = useMemo(() => axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'
  }), [])
  api.interceptors.request.use((config) => {
    config.headers['Authorization'] = 'Bearer dev'
    config.headers['X-Bitrix-Domain'] = 'dev'
    return config
  })
  return api
}

function toLocalISO(date) { return dayjs(date).format('YYYY-MM-DD') }

export default function OfficeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  dayjs.locale('ru')

  // Debug: log available variables
  console.log('🎯 OfficeDetail component loaded:', { id, api: !!api })
  const [office, setOffice] = useState(null)
  const [editOffice, setEditOffice] = useState({ name: '', city: '', address: '' })
  const [loading, setLoading] = useState(true)

  // Templates
  const [templates, setTemplates] = useState([])
  const [selectedTplId, setSelectedTplId] = useState(undefined)
  const [applyRange, setApplyRange] = useState([dayjs().startOf('week'), dayjs().startOf('week').add(6,'day')])

  // Exceptions removed

  // Calendar preview
  const [previewStart, setPreviewStart] = useState(dayjs().startOf('week'))
  const [previewDays, setPreviewDays] = useState([])
  const [editSlot, setEditSlot] = useState(null)
  const [editCapacity, setEditCapacity] = useState(1)
  const [dayEditModal, setDayEditModal] = useState(null)
  const [apiTestResult, setApiTestResult] = useState(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      try {
        const off = await api.get('/offices')
        const o = (off?.data?.data || []).find(x => String(x.id) === String(id))
        if (!o) { message.error('Офис не найден'); navigate('/admin'); return }
        if (!mounted) return
        setOffice(o)
        setEditOffice({ name: o.name || '', city: o.city || '', address: o.address || '' })
        // load templates for quick apply
        const t = await api.get('/templates')
        if (!mounted) return
        setTemplates(t?.data?.data || [])
      } finally { setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [api, id, navigate])

  // removed inline template methods

  // day editor removed

  const loadPreview = async () => {
    const days = [...Array(7)].map((_,i) => toLocalISO(dayjs(previewStart).add(i,'day')))
    const lists = await Promise.all(days.map(d => api.get('/slots/all', { params: { office_id: id, date: d } }).then(r=>r?.data?.data||[])))
    setPreviewDays(lists)
  }

  // exceptions list removed

  useEffect(() => { if (office) { loadPreview() } }, [office, previewStart])

  if (loading) return <Skeleton active />

  const prevWeek = () => setPreviewStart(dayjs(previewStart).subtract(7,'day'))
  const nextWeek = () => setPreviewStart(dayjs(previewStart).add(7,'day'))
  const goToday = () => setPreviewStart(dayjs().startOf('week'))
  const onPickWeek = (v) => setPreviewStart(v ? dayjs(v).startOf('week') : dayjs().startOf('week'))
  const weekLabel = `${dayjs(previewStart).locale('ru').format('D MMMM YYYY')} — ${dayjs(previewStart).add(6,'day').locale('ru').format('D MMMM YYYY')}`

  const applyExistingTemplate = async () => {
    if (!selectedTplId) return message.error('Выберите шаблон')
    if (!applyRange?.[0] || !applyRange?.[1]) return message.error('Укажите диапазон дат')
    const start = applyRange[0].format('YYYY-MM-DD')
    const end = applyRange[1].format('YYYY-MM-DD')
    await api.post(`/templates/${selectedTplId}/apply`, { office_id: id, start_date: start, end_date: end })
    message.success('Шаблон применен')
    await loadPreview()
  }

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop:0 }}>{office?.name} <span style={{ color:'#999', fontWeight:400 }}>• {office?.city}</span></Typography.Title>
      <Tabs
        defaultActiveKey="calendar"
        items={[
          {
            key:'office', label:'Офис', children: (
              <Space direction="vertical" size={12} style={{ width:'100%' }}>
                <Card>
                  <Space direction="vertical" size={12} style={{ width:'100%' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(220px, 1fr))', gap:12 }}>
                      <div>
                        <div style={{ fontWeight:500, marginBottom:6 }}>Название</div>
                        <Input value={editOffice.name} onChange={(e)=>setEditOffice({ ...editOffice, name: e.target.value })} />
                      </div>
                      <div>
                        <div style={{ fontWeight:500, marginBottom:6 }}>Город</div>
                        <Input value={editOffice.city} onChange={(e)=>setEditOffice({ ...editOffice, city: e.target.value })} />
                      </div>
                      <div>
                        <div style={{ fontWeight:500, marginBottom:6 }}>Адрес</div>
                        <Input value={editOffice.address} onChange={(e)=>setEditOffice({ ...editOffice, address: e.target.value })} />
                      </div>
                    </div>
                    <Space>
                      <Button type="primary" onClick={async()=>{
                        await api.put(`/offices/${id}`, { name: editOffice.name, city: editOffice.city, address: editOffice.address })
                        message.success('Сохранено')
                        setOffice({ ...office, ...editOffice })
                      }}>Сохранить</Button>
                    </Space>
                  </Space>
                </Card>
              </Space>
            )
          },
          // Hours tab removed; templates managed in /admin/templates
          // Exceptions tab removed
          {
            key:'calendar', label:'Календарь', children: (
              <Space direction="vertical" size={12} style={{ width:'100%' }}>
                <Card>
                  <Space direction="vertical" size={8} style={{ width:'100%' }}>
                    <Space wrap>
                      <Button onClick={prevWeek}>← Неделя</Button>
                      <Button onClick={goToday}>Сегодня</Button>
                      <Button onClick={nextWeek}>Неделя →</Button>
                      <DatePicker picker="week" value={previewStart} onChange={onPickWeek} />
                      <span style={{ color:'#666' }}>{weekLabel}</span>
                    </Space>
                    <Space wrap>
                                        <Select
                    placeholder="Выберите шаблон"
                    value={selectedTplId}
                    onChange={setSelectedTplId}
                    style={{ minWidth: 280 }}
                    options={(templates||[]).map(t => ({ value: t.id, label: t.name }))}
                  />
                  <DatePicker.RangePicker value={applyRange} onChange={setApplyRange} />
                  <Button type="primary" onClick={applyExistingTemplate}>Применить шаблон к диапазону</Button>
                  <Button onClick={async () => {
                    console.log('🔍 API TEST BUTTON CLICKED')
                    try {
                      console.log('📡 Testing API connection...')
                      const result = await api.get('/test-connection?test=frontend')
                      console.log('✅ API test result:', result.data)
                      setApiTestResult(result.data)
                      message.success('API соединение работает!')
                    } catch (err) {
                      console.error('❌ API test failed:', err)
                      setApiTestResult({ error: err.message, stack: err.stack })
                      message.error('Ошибка соединения с API')
                    }
                  }}>🔍 Проверить API</Button>
                  <Button onClick={async () => {
                    console.log('🧪 DIRECT TEST BUTTON CLICKED')
                    try {
                      console.log('📡 Testing direct close-day call...')
                      const result = await api.post('/slots/close-day', {
                        office_id: 'e870c5a7-3cc4-442f-8619-d7e3e048989b',
                        date: '2025-08-30'
                      })
                      console.log('✅ Direct test result:', result.data)
                      message.success('Direct test successful!')
                    } catch (err) {
                      console.error('❌ Direct test failed:', err)
                      message.error('Direct test failed')
                    }
                  }}>🧪 Тест close-day</Button>
                  {apiTestResult && (
                    <div style={{
                      padding: 8,
                      background: '#f0f8ff',
                      borderRadius: 4,
                      fontSize: 12,
                      border: '1px solid #1890ff'
                    }}>
                      <strong>API Test:</strong> {JSON.stringify(apiTestResult, null, 2)}
                    </div>
                  )}
                    </Space>
                  </Space>
                </Card>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7, minmax(160px, 1fr))', borderLeft:'1px solid #eee', borderTop:'1px solid #eee' }}>
                  {[0,1,2,3,4,5,6].map((i) => {
                    const dd = dayjs(previewStart).add(i,'day').locale('ru')
                    const dow = dd.format('dddd').replace(/^./, c => c.toUpperCase())
                    const full = dd.format('D MMMM YYYY')
                    const dateISO = toLocalISO(dd)
                    const daySlots = previewDays[i] || []
                    const hasSlots = daySlots.length > 0
                    return (
                      <div key={`h-${i}`} style={{ position:'sticky', top:0, background:'#fafafa', padding:8, borderRight:'1px solid #eee', borderBottom:'1px solid #eee' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{dow}</div>
                        <div style={{ color:'#666', marginBottom: 6, fontSize: 12 }}>{full}</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {hasSlots ? (
                            <>
                              <Button size="small" danger type="text" onClick={async () => {
                                console.log('🔴 CLOSE DAY BUTTON CLICKED:', { id, dateISO })
                                try {
                                  console.log('📡 Sending POST to /slots/close-day')
                                  await api.post('/slots/close-day', {
                                    office_id: id,
                                    date: dateISO
                                  })
                                  console.log('✅ Request successful')
                                  message.success('День закрыт')
                                  await loadPreview()
                                } catch (err) {
                                  console.error('❌ Request failed:', err)
                                  message.error('Ошибка закрытия дня')
                                }
                              }}>Закрыть</Button>
                              <Button size="small" type="text" onClick={() => setDayEditModal({ date: dateISO, dateLabel: full })}>Изменить</Button>
                            </>
                          ) : (
                            <Button size="small" type="primary" ghost onClick={() => setDayEditModal({ date: dateISO, dateLabel: full })}>Открыть</Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {(() => {
                    const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m }
                    const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
                    let minStart = Infinity, maxEnd = -Infinity
                    ;(previewDays||[]).forEach(day => (day||[]).forEach(s => { minStart = Math.min(minStart, toMin(s.start)); maxEnd = Math.max(maxEnd, toMin(s.end)) }))
                    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || minStart>=maxEnd) return null
                    const rows = []
                    for (let t=minStart; t<maxEnd; t+=30) rows.push(toTime(t))
                    return rows.map((t) => (
                      <React.Fragment key={`row-${t}`}>
                        {[0,1,2,3,4,5,6].map((i) => {
                          const slot = (previewDays[i]||[]).find(s => s.start === t)
                          const has = !!slot
                          const free = Number(slot?.free ?? 0)
                          const cap = Number(slot?.capacity ?? 0)
                          const bg = has ? (free > 0 ? '#f6ffed' : '#fff1f0') : '#fafafa'
                          const fg = has ? (free > 0 ? '#389e0d' : '#cf1322') : '#999'
                          const baseStyle = { borderRight:'1px solid #eee', borderBottom:'1px solid #eee', padding:6, background: bg, color: fg }
                          return <div key={`${i}-${t}`} style={baseStyle} onClick={() => {
                            if (!has) return
                            setEditSlot({ ...slot, date: toLocalISO(dayjs(previewStart).add(i,'day')), office_id: id })
                            setEditCapacity(cap || 1)
                          }}>{has ? `${slot.start} • ${free}/${cap}` : '—'}</div>
                        })}
                      </React.Fragment>
                    ))
                  })()}
                </div>
              </Space>
            )
          }
        ]}
      />
      {editSlot && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:8, padding:16, width:360 }}>
            <div style={{ fontWeight:600, marginBottom:12 }}>Изменить вместимость</div>
            <div style={{ marginBottom:12, color:'#666' }}>{dayjs(editSlot.date).locale('ru').format('dddd, D MMMM YYYY')} • {editSlot.start}—{editSlot.end}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span>Вместимость:</span>
              <Input type="number" min={1} value={editCapacity} onChange={(e)=>setEditCapacity(Math.max(1, Number(e.target.value)||1))} style={{ width:100 }} />
            </div>
            <div style={{ marginTop:16, display:'flex', justifyContent:'flex-end', gap:8 }}>
              <Button onClick={()=>setEditSlot(null)}>Отмена</Button>
              <Button type="primary" onClick={async()=>{
                console.log('🔴 SAVE CAPACITY BUTTON CLICKED:', { editSlot, editCapacity, id })
                try {
                  console.log('📡 Sending capacity update:', `/slots/all?office_id=${id}&date=${editSlot.date}&update_slot_id=${editSlot.id}&new_capacity=${editCapacity}`)
                  await api.get(`/slots/all?office_id=${id}&date=${editSlot.date}&update_slot_id=${editSlot.id}&new_capacity=${editCapacity}`)
                  console.log('✅ Capacity update successful')
                  message.success('Вместимость обновлена')
                  setEditSlot(null)
                  await loadPreview()
                } catch (err) {
                  console.error('❌ Capacity update failed:', err)
                  message.error('Ошибка обновления вместимости')
                }
              }}>Сохранить</Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Day Edit Modal */}
      {dayEditModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:8, padding:24, width:480 }}>
            <div style={{ fontWeight:600, marginBottom:16 }}>Редактировать день</div>
            <div style={{ marginBottom:16, color:'#666' }}>{dayEditModal.dateLabel}</div>
            
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>Быстрые действия:</div>
                <Space wrap>
                  <Button onClick={async () => {
                    if (!selectedTplId) {
                      message.warning('Выберите шаблон')
                      return
                    }
                    try {
                      // Use GET request with query params for template application
                      await api.get(`/templates/${selectedTplId}/apply?office_id=${id}&date=${dayEditModal.date}`)
                      message.success('День открыт по шаблону')
                      setDayEditModal(null)
                      await loadPreview()
                    } catch (err) {
                      message.error('Ошибка применения шаблона')
                    }
                  }}>Открыть по шаблону</Button>
                  
                  <Input placeholder="16:00" style={{ width: 80 }} disabled />
                  <span style={{ color: '#999' }}>Закрытие с времени (в разработке)</span>
                </Space>
                
                <Space wrap style={{ marginTop: 8 }}>
                  <Input placeholder="10:00" style={{ width: 80 }} disabled />
                  <span style={{ color: '#999' }}>Открытие с времени (в разработке)</span>
                </Space>
              </div>
              
              <div style={{ marginTop: 16, padding: 12, background: '#fff3cd', borderRadius: 6, fontSize: 13, color: '#856404' }}>
                🚧 <strong>Функция в разработке</strong><br/>
                Пока используйте кнопку "Применить шаблон к диапазону" выше для управления расписанием офиса. 
                Кастомные правки отдельных дней будут доступны в ближайших обновлениях.
              </div>
            </Space>
            
            <div style={{ marginTop:20, display:'flex', justifyContent:'flex-end', gap:8 }}>
              <Button onClick={()=>setDayEditModal(null)}>Отмена</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


