import React, { useEffect, useMemo, useState } from 'react'
import { Tabs, Card, Space, Button, DatePicker, Typography, message, Skeleton, Select, Input, Modal, Form, TimePicker, Divider, Tag, Tooltip, Dropdown } from 'antd'
import { MoreOutlined, DeleteOutlined, EnvironmentOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import api from '../../api/client'
import PageHeader from './components/PageHeader'

function useApi() { return api }

function toLocalISO(date) { return dayjs(date).format('YYYY-MM-DD') }

export default function OfficeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  dayjs.locale('ru')

  // Debug: log available variables
  console.log('🎯 OfficeDetail component loaded:', { id, api: !!api })
  const [office, setOffice] = useState(null)
  const [editOffice, setEditOffice] = useState({ city: '', address: '', bitrixOfficeId: '' })
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

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
  const [modalTplId, setModalTplId] = useState(undefined)
  const [closeAfter, setCloseAfter] = useState('')
  const [openFrom, setOpenFrom] = useState('')

  // Bulk selection state for slots in preview calendar
  const [selectedSlots, setSelectedSlots] = useState([]) // [{date,start,end,slotId}]
  const isSlotSelected = (dateISO, start, end, slotId) => selectedSlots.some(s => (s.slotId ? s.slotId===slotId : (s.date===dateISO && s.start===start && s.end===end)))
  const toggleSelectSlot = (dateISO, start, end, slotId, additive) => {
    setSelectedSlots(prev => {
      const exists = prev.some(s => (s.slotId ? s.slotId===slotId : (s.date===dateISO && s.start===start && s.end===end)))
      if (additive) {
        if (exists) return prev.filter(s => !(s.slotId ? s.slotId===slotId : (s.date===dateISO && s.start===start && s.end===end)))
        return [...prev, { date: dateISO, start, end, slotId }]
      }
      return exists ? [] : [{ date: dateISO, start, end, slotId }]
    })
  }

  // Reset bulk selection on ESC when no modal is open
  useEffect(() => {
    const onKeyDown = (e) => {
      const isEsc = e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape'
      if (!isEsc) return
      if (!editSlot && !dayEditModal && !deleteOpen) {
        setSelectedSlots([])
      }
    }
    // Capture phase to bypass stopPropagation inside nested components
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [editSlot, dayEditModal, deleteOpen])


  useEffect(() => {
    if (dayEditModal) {
      setModalTplId(selectedTplId)
    }
  }, [dayEditModal, selectedTplId])

  const load = async () => {
    setLoading(true)
    try {
      const off = await api.get('/admin/offices')
      const o = (off?.data?.data || []).find(x => String(x.id) === String(id))
      if (!o) { message.error('Офис не найден'); navigate('/admin'); return }
      setOffice(o)
      setEditOffice({ city: o.city || '', address: o.address || '', bitrixOfficeId: o.bitrixOfficeId ? String(o.bitrixOfficeId) : '' })
      // load templates for quick apply
      const t = await api.get('/admin/templates')
      setTemplates(t?.data?.data || [])
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
  }, [id])

  // removed inline template methods

  // day editor removed

  const loadPreview = async () => {
    const days = [...Array(7)].map((_,i) => toLocalISO(dayjs(previewStart).add(i,'day')))
    const lists = await Promise.all(days.map(d => api.get('/admin/slots/all', { params: { office_id: id, date: d } }).then(r=>r?.data?.data||[])))
    setPreviewDays(lists)
  }

  // exceptions list removed

  useEffect(() => { if (office) { loadPreview() } }, [office, previewStart])

  // Websocket live updates for admin preview
  useEffect(() => {
    let ws
    try {
      const base = '/api'
      let url
      if (base.startsWith('http')) {
        const u = new URL(base.replace(/\/$/, ''))
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
        u.pathname = (u.pathname.replace(/\/$/, '')) + '/ws'
        url = u.toString()
      } else {
        const loc = window.location
        url = `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${base.replace(/\/$/, '')}/ws`
      }
      ws = new WebSocket(url)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'slots.updated') {
            if (id && String(msg.office_id) === String(id)) {
              loadPreview()
            }
          } else if (msg.type === 'appointment.updated') {
            const apptOfficeId = msg?.appointment?.office_id || msg?.office_id
            if (id && apptOfficeId && String(apptOfficeId) === String(id)) {
              loadPreview()
            }
          } else if (msg.type === 'time.tick') {
            if (id) loadPreview()
          }
        } catch {}
      }
    } catch {}
    return () => { try { ws && ws.close() } catch {} }
  }, [id, previewStart])

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
    await api.post(`/admin/templates/${selectedTplId}/apply`, { office_id: id, start_date: start, end_date: end })
    message.success('Шаблон применен')
    await loadPreview()
  }

  return (
    <div>
      <PageHeader
        title={`${office?.city || 'Офис'} • ${office?.address || 'Адрес не указан'}`}
        icon={<EnvironmentOutlined />}
        onRefresh={load}
        loading={loading}
      />
      <Tabs
        defaultActiveKey="calendar"
        items={[
          {
            key:'office', label:'Офис', children: (
              <Space direction="vertical" size={12} style={{ width:'100%' }}>
                <Card>
                  <div style={{ display:'grid', gridTemplateColumns:'10fr 2fr', gap:16, alignItems:'start' }}>
                    <div>
                    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                      <div>
                        <div style={{ fontWeight:500, marginBottom:6 }}>Город</div>
                        <Input value={editOffice.city} onChange={(e)=>setEditOffice({ ...editOffice, city: e.target.value })} />
                      </div>
                      <div>
                        <div style={{ fontWeight:500, marginBottom:6 }}>Адрес</div>
                        <Input value={editOffice.address} onChange={(e)=>setEditOffice({ ...editOffice, address: e.target.value })} />
                      </div>
                      <div>
                        <div style={{ fontWeight:500, marginBottom:6 }}>Примечание</div>
                        <Input.TextArea 
                          value={editOffice.addressNote||''}
                          onChange={(e)=>setEditOffice({ ...editOffice, addressNote: e.target.value })}
                          autoSize={{ minRows: 4, maxRows: 8 }}
                          placeholder="Например: вход со двора; 3 этаж, офис 305; паспорт при входе; парковка во дворе"
                        />
                        <div style={{ marginTop:4, fontSize:12, color:'#8c8c8c' }}>
                          Добавьте инструкции: как пройти, к кому обратиться на ресепшене, где парковка и т.п.
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight:500, marginBottom:6 }}>Bitrix Office ID</div>
                        <Input 
                          value={editOffice.bitrixOfficeId}
                          placeholder="например, 12345"
                          onChange={(e)=>{
                            const v = e.target.value.replace(/[^0-9]/g, '')
                            setEditOffice({ ...editOffice, bitrixOfficeId: v })
                          }} 
                        />
                      </div>
                    </div>
                    <div style={{ marginTop:12, display:'flex', justifyContent:'flex-start', gap:12, flexWrap:'wrap' }}>
                      <Button type="primary" size="large" onClick={async()=>{
                        await api.put(`/admin/offices/${id}`, { 
                          city: editOffice.city, 
                          address: editOffice.address,
                          addressNote: editOffice.addressNote || undefined,
                          bitrixOfficeId: editOffice.bitrixOfficeId ? Number(editOffice.bitrixOfficeId) : undefined
                        })
                        message.success('Сохранено')
                        setOffice({ ...office, ...editOffice, bitrixOfficeId: editOffice.bitrixOfficeId ? Number(editOffice.bitrixOfficeId) : null })
                      }}>Сохранить</Button>
                    </div>
                    </div>
                    <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'flex-start' }}>
                      <Dropdown
                        placement="bottomRight"
                        trigger={["click"]}
                        menu={{
                          items: [
                            {
                              key: 'delete',
                              label: (
                                <span style={{ color: '#ff4d4f', display:'flex', alignItems:'center', gap:8 }}>
                                  <DeleteOutlined />Удалить офис
                                </span>
                              ),
                            },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'delete') { setDeleteConfirm(''); setDeleteOpen(true) }
                          },
                        }}
                      >
                        <Button size="middle" type="default" icon={<MoreOutlined />}>Действия</Button>
                      </Dropdown>
                    </div>
                  </div>
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

                    </Space>
                  </Space>
                </Card>

                {/* Панель управления выбранными слотами */}
                {selectedSlots.length > 0 && (
                  <Card 
                    size="small" 
                    style={{ 
                      background: '#e6f4ff', 
                      border: '1px solid #91caff' 
                    }}
                  >
                    <Space>
                      <span style={{ fontWeight: 500 }}>
                        Выбрано слотов: {selectedSlots.length}
                      </span>
                      <Button 
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => {
                          Modal.confirm({
                            title: 'Удалить выбранные слоты?',
                            icon: <ExclamationCircleOutlined />,
                            content: (
                              <div>
                                <p>Вы уверены, что хотите <strong>удалить {selectedSlots.length} выбранных слотов</strong>?</p>
                                <p style={{ color: '#ff4d4f', fontSize: '12px' }}>
                                  ⚠️ Все записи в этих слотах будут отменены.
                                </p>
                              </div>
                            ),
                            okText: 'Да, удалить',
                            okButtonProps: { danger: true },
                            cancelText: 'Отмена',
                            onOk: async () => {
                              try {
                                const ids = Array.from(new Set(
                                  (selectedSlots || [])
                                    .map(s => s.slotId)
                                    .filter(Boolean)
                                ))
                                if (ids.length === 0) {
                                  message.info('Нет выбранных слотов для удаления')
                                  return
                                }
                                const results = await Promise.allSettled(
                                  ids.map(id => api.delete(`/admin/slots/${id}`).catch(() => null))
                                )
                                const ok = results.filter(r => r.status === 'fulfilled').length
                                const failed = ids.length - ok
                                setSelectedSlots([])
                                await loadPreview()
                                if (failed === 0) {
                                  message.success(`Удалено ${ok} слота(ов)`)                 
                                } else if (ok > 0) {
                                  message.warning(`Удалено ${ok}, ошибок: ${failed}`)
                                } else {
                                  message.error('Не удалось удалить слоты')
                                }
                              } catch (error) {
                                console.error('Ошибка удаления слотов:', error)
                                message.error('Не удалось удалить слоты')
                              }
                            }
                          })
                        }}
                      >
                        Удалить выбранные
                      </Button>
                      <Button 
                        size="small"
                        onClick={() => setSelectedSlots([])}
                      >
                        Снять выделение
                      </Button>
                    </Space>
                  </Card>
                )}

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
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {hasSlots ? (
                            <>
                              <button 
                                style={{ 
                                  border: 'none', 
                                  background: '#ff4d4f', 
                                  color: 'white', 
                                  padding: '4px 8px', 
                                  borderRadius: 4, 
                                  fontSize: 11, 
                                  cursor: 'pointer',
                                  fontWeight: 500,
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => e.target.style.background = '#ff7875'}
                                onMouseLeave={(e) => e.target.style.background = '#ff4d4f'}
                                onClick={async () => {
                                  console.log('🔴 CLOSE DAY BUTTON CLICKED:', { id, dateISO })
                                  try {
                                    console.log('📡 Sending POST to /slots/close-day')
                                    await api.post('/admin/slots/close-day', {
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
                                }}
                              >
                                Закрыть
                              </button>
                              <button 
                                style={{ 
                                  border: '1px solid #d9d9d9', 
                                  background: 'white', 
                                  color: '#595959', 
                                  padding: '4px 8px', 
                                  borderRadius: 4, 
                                  fontSize: 11, 
                                  cursor: 'pointer',
                                  fontWeight: 500,
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                  e.target.style.borderColor = '#40a9ff'
                                  e.target.style.color = '#40a9ff'
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.borderColor = '#d9d9d9'
                                  e.target.style.color = '#595959'
                                }}
                                onClick={() => setDayEditModal({ date: dateISO, dateLabel: full })}
                              >
                                Изменить
                              </button>
                              {/* Очистить = закрыть: кнопка удалена как дублирующая */}
                            </>
                          ) : (
                            <button 
                              style={{ 
                                border: '1px solid #1890ff', 
                                background: '#1890ff', 
                                color: 'white', 
                                padding: '4px 8px', 
                                borderRadius: 4, 
                                fontSize: 11, 
                                cursor: 'pointer',
                                fontWeight: 500,
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={(e) => e.target.style.background = '#40a9ff'}
                              onMouseLeave={(e) => e.target.style.background = '#1890ff'}
                              onClick={() => setDayEditModal({ date: dateISO, dateLabel: full })}
                            >
                              Открыть
                            </button>
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
                          const isBreak = has && cap === 0
                          const dateISO = toLocalISO(dayjs(previewStart).add(i,'day'))
                          const selected = has && isSlotSelected(dateISO, slot?.start, slot?.end, slot?.id)
                          const bg = selected ? '#e6f4ff' : (has ? (isBreak ? '#fff2e8' : (free > 0 ? '#f6ffed' : '#fff1f0')) : '#fafafa')
                          const fg = has ? (isBreak ? '#d46b08' : (free > 0 ? '#389e0d' : '#cf1322')) : '#999'
                          const baseStyle = { borderRight:'1px solid #eee', borderBottom:'1px solid #eee', padding:6, background: bg, color: fg, cursor: has ? 'pointer' : 'default', boxShadow: selected ? 'inset 0 0 0 2px #1677ff' : 'none' }
                          return <div key={`${i}-${t}`} style={baseStyle} onClick={() => {
                            if (!has) return
                            const additive = (window.event && (window.event.metaKey || window.event.ctrlKey))
                            const dateISO2 = toLocalISO(dayjs(previewStart).add(i,'day'))
                            if (additive) {
                              toggleSelectSlot(dateISO2, slot.start, slot.end, slot.id, true)
                              return
                            }
                            // normal click: open editor and reset selection
                            setSelectedSlots([])
                            setEditSlot({ ...slot, date: dateISO2, office_id: id })
                            setEditCapacity(cap || 1)
                          }}>{has ? (isBreak ? `${slot.start} • Перерыв` : `${slot.start} • ${free}/${cap}`) : '—'}</div>
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
      {selectedSlots.length > 0 && (
        <div style={{ position:'sticky', bottom:16, zIndex:3, display:'flex', gap:12, alignItems:'center', background:'#fff', padding:'8px 12px', border:'1px solid #e6f4ff', boxShadow:'0 8px 24px rgba(0,0,0,0.08)', borderRadius:8 }}>
          <div style={{ fontWeight:600 }}>Выбрано: {selectedSlots.length}</div>
          <div style={{ color:'#555' }}>Изменить максимальную вместимость:</div>
          <Input type="number" min={0} style={{ width:160 }} placeholder="например, 2 (0 — перерыв)" value={editCapacity} onChange={(e)=>setEditCapacity(Math.max(0, Number(e.target.value)||0))} />
          <Button type="primary" onClick={async()=>{
            try {
              // Prefer precise id-based updates if available
              const hasIds = selectedSlots.every(s => s.slotId)
              if (hasIds) {
                await Promise.all(selectedSlots.map(s => api.get('/admin/slots/all', { params: { office_id: id, date: s.date, update_slot_id: s.slotId, new_capacity: editCapacity } })))
              } else {
                await Promise.all(selectedSlots.map(s => api.get('/admin/slots/all', { params: { office_id: id, date: s.date, update_slot_id: s.slotId, new_capacity: editCapacity } })))
              }
              message.success('Изменения применены к выбранным слотам')
              setSelectedSlots([])
              await loadPreview()
            } catch (e) { message.error('Не удалось применить массовое изменение') }
          }}>Применить</Button>
          <Button onClick={()=>setSelectedSlots([])}>Сбросить</Button>
        </div>
      )}
      {editSlot && (
        <Modal
          open
          title={<div><div style={{ fontWeight: 600 }}>Изменить вместимость</div><div style={{ color:'#666', fontSize: 12 }}>{dayjs(editSlot.date).locale('ru').format('dddd, D MMMM YYYY')} • {editSlot.start}—{editSlot.end}</div></div>}
          onCancel={()=>setEditSlot(null)}
          footer={null}
          width={400}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card size="small">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>Вместимость:</div>
                <Input 
                  type="number" 
                  min={0} 
                  value={editCapacity} 
                  onChange={(e)=>setEditCapacity(Math.max(0, Number(e.target.value)||0))} 
                  style={{ width: 100 }} 
                />
                {editCapacity === 0 && (
                  <div style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 500 }}>
                    Обеденный перерыв
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                💡 Установите 0 для создания обеденного перерыва или технической паузы
              </div>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button onClick={()=>setEditSlot(null)}>Отмена</Button>
                <Button type="primary" onClick={async()=>{
                  console.log('🔴 SAVE CAPACITY BUTTON CLICKED:', { editSlot, editCapacity, id })
                  try {
                    console.log('📡 Sending capacity update:', `/slots/all?office_id=${id}&date=${editSlot.date}&update_slot_id=${editSlot.id}&new_capacity=${editCapacity}`)
                    await api.get(`/admin/slots/all?office_id=${id}&date=${editSlot.date}&update_slot_id=${editSlot.id}&new_capacity=${editCapacity}`)
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
            </Card>
          </div>
        </Modal>
      )}
      
      {/* Day Edit Modal */}
      {dayEditModal && (
        <Modal
          open
          title={<div><div style={{ fontWeight: 600 }}>Редактировать день</div><div style={{ color:'#666', fontSize: 12 }}>{dayEditModal.dateLabel}</div></div>}
          onCancel={()=>setDayEditModal(null)}
          footer={null}
          width={600}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Открыть по шаблону */}
            <Card size="small">
              <div style={{ marginBottom: 12, fontWeight: 500 }}>Открыть по шаблону</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Select
                    placeholder="Выберите шаблон"
                    value={modalTplId}
                    onChange={setModalTplId}
                    style={{ width: '100%' }}
                    options={(templates||[]).map(t => ({ value: t.id, label: t.name }))}
                  />
                </div>
                <Button type="primary" onClick={async () => {
                  if (!modalTplId) return message.warning('Выберите шаблон')
                  try {
                                            await api.post('/admin/slots/open-day', { office_id: id, date: dayEditModal.date, template_id: modalTplId })
                    message.success('День открыт по шаблону')
                    setDayEditModal(null)
                    await loadPreview()
                  } catch (err) {
                    message.error('Ошибка открытия по шаблону')
                  }
                }}>Открыть</Button>
              </div>
            </Card>

            {/* Точечные изменения */}
            <Card size="small">
              <div style={{ marginBottom: 12, fontWeight: 500 }}>Точечные изменения</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>Закрыть с времени</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <TimePicker 
                      format="HH:mm" 
                      minuteStep={30} 
                      placeholder="16:00" 
                      style={{ flex: 1 }}
                      onChange={(v)=>setCloseAfter(v? v.format('HH:mm'): '')} 
                    />
                    <Button size="small" onClick={async () => {
                      if (!closeAfter) return message.warning('Укажите время')
                      try {
                        await api.post('/admin/slots/close-early', { office_id: id, date: dayEditModal.date, close_after: closeAfter, template_id: modalTplId })
                        message.success('Закрыто с указанного времени')
                        setDayEditModal(null)
                        setCloseAfter('')
                        await loadPreview()
                      } catch (err) {
                        message.error('Ошибка закрытия с времени')
                      }
                    }}>Применить</Button>
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>Открыть с времени</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <TimePicker 
                      format="HH:mm" 
                      minuteStep={30} 
                      placeholder="10:00" 
                      style={{ flex: 1 }}
                      onChange={(v)=>setOpenFrom(v? v.format('HH:mm'): '')} 
                    />
                    <Button size="small" onClick={async () => {
                      if (!openFrom) return message.warning('Укажите время')
                      try {
                        await api.post('/admin/slots/open-late', { office_id: id, date: dayEditModal.date, open_from: openFrom, template_id: modalTplId })
                        message.success('Открыто с указанного времени')
                        setDayEditModal(null)
                        setOpenFrom('')
                        await loadPreview()
                      } catch (err) {
                        message.error('Ошибка открытия с времени')
                      }
                    }}>Применить</Button>
                  </div>
                </div>
                <div style={{ gridColumn: '1 / span 2' }}>
                  <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>Очистить промежуток</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <TimePicker 
                      format="HH:mm" 
                      minuteStep={30} 
                      placeholder="с" 
                      onChange={(v)=>setOpenFrom(v? v.format('HH:mm'): '')}
                    />
                    <span>—</span>
                    <TimePicker 
                      format="HH:mm" 
                      minuteStep={30} 
                      placeholder="до" 
                      onChange={(v)=>setCloseAfter(v? v.format('HH:mm'): '')}
                    />
                    <Button size="small" danger onClick={async () => {
                      if (!openFrom || !closeAfter) return message.warning('Укажите оба времени');
                      try {
                        await api.post('/admin/slots/clear-interval', { office_id: id, date: dayEditModal.date, from: openFrom, to: closeAfter })
                        message.success('Промежуток очищен')
                        setDayEditModal(null)
                        setOpenFrom('');
                        setCloseAfter('');
                        await loadPreview()
                      } catch (err) {
                        message.error('Ошибка очистки промежутка')
                      }
                    }}>Очистить</Button>
                  </div>
                </div>
              </div>
            </Card>

            {/* Окно работы */}
            <Card size="small">
              <div style={{ marginBottom: 12, fontWeight: 500 }}>Окно работы</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>Открыть с</div>
                  <TimePicker 
                    format="HH:mm" 
                    minuteStep={30} 
                    placeholder="10:00" 
                    style={{ width: '100%' }}
                    onChange={(v)=>setOpenFrom(v? v.format('HH:mm'): '')} 
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>Закрыть с</div>
                  <TimePicker 
                    format="HH:mm" 
                    minuteStep={30} 
                    placeholder="22:00" 
                    style={{ width: '100%' }}
                    onChange={(v)=>setCloseAfter(v? v.format('HH:mm'): '')} 
                  />
                </div>
                <Tooltip title="Пересоздаёт слоты по шаблону и применяет окно. Недостающие интервалы будут дозаполнены.">
                  <Button type="primary" onClick={async () => {
                    try {
                      await api.post('/admin/slots/set-window', { office_id: id, date: dayEditModal.date, template_id: modalTplId, open_from: openFrom||undefined, close_after: closeAfter||undefined })
                      message.success('Окно применено')
                      setDayEditModal(null)
                      await loadPreview()
                    } catch (err) {
                      message.error('Ошибка применения окна')
                    }
                  }}>Применить окно</Button>
                </Tooltip>
              </div>
              <div style={{ marginTop: 12, padding: 8, background: '#f6f8fa', borderRadius: 4, fontSize: 12, color: '#666' }}>
                💡 <strong>Окно работы</strong> — самое быстрое действие. Остальные — для точечных правок.
              </div>
            </Card>
          </div>
        </Modal>
      )}
      {/* Delete office modal */}
      <Modal
        open={deleteOpen}
        onCancel={()=>setDeleteOpen(false)}
        onOk={async ()=>{
          try {
            await api.delete(`/admin/offices/${id}`)
            message.success('Офис удалён')
            setDeleteOpen(false)
            navigate('/admin')
          } catch (e) {
            message.error('Не удалось удалить офис')
          }
        }}
        okButtonProps={{ danger: true, disabled: (deleteConfirm.trim() !== (`${office?.city||''} • ${office?.address||''}`)) }}
        title="Удалить офис"
      >
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <Typography.Text>Это действие необратимо. Для подтверждения введите адрес офиса:</Typography.Text>
          <Typography.Text code>{office?.city} • {office?.address}</Typography.Text>
          <Input placeholder="Точный адрес офиса" value={deleteConfirm} onChange={(e)=>setDeleteConfirm(e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}


