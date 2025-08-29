import React, { useEffect, useMemo, useState, useRef } from 'react'
import { Button, Space, Input, DatePicker, TimePicker, Select, message, Card, Typography, Divider, Row, Col, Tag, Tooltip, Modal, Form, Switch } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, ClockCircleOutlined, UserOutlined, CoffeeOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/client'
import { useNavigate, useParams } from 'react-router-dom'

const { Title, Text } = Typography
const { TextArea } = Input

function useApi() { return api }

const DOW = [
  { key: '1', label: 'Понедельник', short: 'Пн' },
  { key: '2', label: 'Вторник', short: 'Вт' },
  { key: '3', label: 'Среда', short: 'Ср' },
  { key: '4', label: 'Четверг', short: 'Чт' },
  { key: '5', label: 'Пятница', short: 'Пт' },
  { key: '6', label: 'Суббота', short: 'Сб' },
  { key: '0', label: 'Воскресенье', short: 'Вс' }
]

const SLOT_TYPES = [
  { value: 'regular', label: 'Обычный', icon: <UserOutlined />, color: 'blue' },
  { value: 'break', label: 'Перерыв', icon: <CoffeeOutlined />, color: 'orange' },
  { value: 'peak', label: 'Пиковый', icon: <ClockCircleOutlined />, color: 'green' }
]

// Длительность слота теперь управляется через состояние

function generateTimeSlots(start, end, duration = 30) {
  const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m }
  const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
  const res = []
  let s = toMin(start), e = toMin(end)
  for (let t=s; t<e; t+=duration) res.push({ start: toTime(t), end: toTime(t+duration) })
  return res
}

export default function TemplateEditPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { id } = useParams()
  const isFirstRender = useRef(true)
  
  // Базовые настройки
  const [baseStartTime, setBaseStartTime] = useState(dayjs('09:00', 'HH:mm'))
  const [baseEndTime, setBaseEndTime] = useState(dayjs('18:00', 'HH:mm'))
  const [slotDuration, setSlotDuration] = useState(30)
  const [defaultCapacity, setDefaultCapacity] = useState(1)
  const [templateName, setTemplateName] = useState('')
  const [description, setDescription] = useState('')
  
  // Дневные профили
  const [weekdays, setWeekdays] = useState({})
  
  // Упрощено: без режимов дней
  
  // Редактирование слотов
  const [editSlot, setEditSlot] = useState(null)
  const [editCapacity, setEditCapacity] = useState(1)
  // Bulk selection state
  const [selectedCells, setSelectedCells] = useState([]) // [{ dayKey, timeSlot }]
  const [bulkCapacity, setBulkCapacity] = useState(1)
  
  // Загрузка данных
  const [loading, setLoading] = useState(false)

  // Reset bulk selection on ESC
  useEffect(() => {
    const onKeyDown = (e) => {
      const isEsc = e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape'
      if (!isEsc) return
      if (!editSlot) setSelectedCells([])
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [editSlot])

  useEffect(() => { 
    if (id) {
      loadTemplate()
    } else {
      initializeNewTemplate()
    }
  }, [id])

  // Инициализируем дни недели только при первом рендере
  useEffect(() => {
    console.log('🔍 useEffect triggered - isFirstRender:', isFirstRender.current)
    console.log('🔍 DOW:', DOW)
    
    if (isFirstRender.current) {
      const newWeekdays = {}
      
      DOW.forEach(d => {
        newWeekdays[d.key] = {
          start: baseStartTime.format('HH:mm'),
          end: baseEndTime.format('HH:mm'),
          capacity: defaultCapacity,
          specialSlots: []
        }
        
      })
      
      console.log('🔍 Setting initial weekdays:', newWeekdays)
      
      setWeekdays(newWeekdays)
      isFirstRender.current = false
    }
  }, [baseStartTime, baseEndTime, defaultCapacity])

  const loadTemplate = async () => {
    setLoading(true)
    try {
      console.log('🔍 Loading template with ID:', id)
      console.log('🔍 API base URL:', import.meta.env.VITE_API_BASE_URL || '/api')
      
      const response = await api.get(`/admin/templates/${id}`)
      console.log('✅ Template loaded successfully:', response.data)
      
      const template = response.data.data
      
      setTemplateName(template.name)
      setDescription(template.description || '')
      setBaseStartTime(dayjs(template.baseStartTime || '09:00', 'HH:mm'))
      setBaseEndTime(dayjs(template.baseEndTime || '18:00', 'HH:mm'))
      setSlotDuration(template.slotDuration || 30)
      setDefaultCapacity(template.defaultCapacity || 1)
      
      // Загружаем дни недели из шаблона
      if (template.weekdays && Object.keys(template.weekdays).length > 0) {
        // Проверяем, нужно ли конвертировать старый формат
        const firstDay = Object.values(template.weekdays)[0]
        if (firstDay && Array.isArray(firstDay)) {
          // Старый формат: конвертируем в новый и восстанавливаем specialSlots
          const newWeekdays = {}
          for (const [dayKey, slots] of Object.entries(template.weekdays)) {
            if (Array.isArray(slots) && slots.length > 0) {
              // Восстанавливаем базовые настройки дня
              const baseCapacity = slots[0].capacity || template.defaultCapacity || 1
              newWeekdays[dayKey] = {
                start: slots[0].start,
                end: slots[slots.length - 1].end,
                capacity: baseCapacity,
                specialSlots: []
              }
              
              // Восстанавливаем specialSlots из слотов с нестандартной вместимостью
              const specialSlots = []
              slots.forEach(slot => {
                if (slot.capacity !== baseCapacity) {
                  specialSlots.push({
                    start: slot.start,
                    end: slot.end,
                    capacity: slot.capacity,
                    type: slot.capacity === 0 ? 'break' : 'custom'
                  })
                }
              })
              
              if (specialSlots.length > 0) {
                newWeekdays[dayKey].specialSlots = specialSlots
                console.log(`🔍 Восстановлены specialSlots для дня ${dayKey}:`, specialSlots)
              }
            }
          }
          setWeekdays(newWeekdays)
        } else {
          // Новый формат: используем как есть
          setWeekdays(template.weekdays)
        }
      } else {
        // Если дней нет, создаем базовые
        const newWeekdays = {}
        DOW.forEach(d => {
          newWeekdays[d.key] = {
            start: template.baseStartTime || '09:00',
            end: template.baseEndTime || '18:00',
            capacity: template.defaultCapacity || 1,
            specialSlots: []
          }
        })
        setWeekdays(newWeekdays)
      }
      
      console.log('📥 Загруженные weekdays:', weekdays)
    } catch (error) {
      console.error('❌ Error loading template:', error)
      console.error('❌ Error response:', error.response)
      message.error('Ошибка загрузки шаблона')
      navigate('/admin/templates')
    } finally {
      setLoading(false)
    }
  }

  const initializeNewTemplate = () => {
    setTemplateName('Новый шаблон')
    setDescription('')
    setBaseStartTime(dayjs('09:00', 'HH:mm'))
    setBaseEndTime(dayjs('18:00', 'HH:mm'))
    setSlotDuration(30)
    setDefaultCapacity(1)
    
    const newWeekdays = {}
    DOW.forEach(d => {
      newWeekdays[d.key] = {
        start: '09:00',
        end: '18:00',
        capacity: 1,
        specialSlots: []
      }
    })
    setWeekdays(newWeekdays)
    isFirstRender.current = true
  }

  const updateSlotCapacity = (dayKey, timeSlot, newCapacity) => {
    const copy = { ...weekdays }
    if (!copy[dayKey]) return
    
    // Изменяем ВМЕСТИМОСТЬ ТОЛЬКО конкретного слота. 0 означает перерыв, но не закрытие дня
    let hasSpecialSlot = false
    // Рассчитываем конец слота для потенциальной корректировки окна дня
    const startMin = dayjs(timeSlot, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
    const endMin = startMin + slotDuration
    const endSlot = dayjs('00:00', 'HH:mm').add(endMin, 'minute').format('HH:mm')
    if (copy[dayKey].specialSlots && Array.isArray(copy[dayKey].specialSlots)) {
      copy[dayKey].specialSlots.forEach(slot => {
        if (slot.start === timeSlot) {
          slot.capacity = newCapacity
          slot.type = newCapacity === 0 ? 'break' : (slot.type || 'custom')
          hasSpecialSlot = true
        }
      })
    }
    
    // Если специального слота нет, создаем его
    if (!hasSpecialSlot) {
      if (!copy[dayKey].specialSlots) {
        copy[dayKey].specialSlots = []
      }
      
      copy[dayKey].specialSlots.push({
        start: timeSlot,
        end: endSlot,
        capacity: newCapacity,
        type: newCapacity === 0 ? 'break' : 'custom'
      })
    }
    
    // ВАЖНО: не расширяем окно и не меняем статус дня. Спец-слот может жить поверх белого.
    
    setWeekdays(copy)
  }

  const closeEntireDay = (dayKey) => {
    const copy = { ...weekdays }
    
    if (!copy[dayKey]) return
    
    // Закрываем весь день - устанавливаем capacity = 0
    copy[dayKey] = {
      ...copy[dayKey],
      capacity: 0,
      specialSlots: []
    }
    setWeekdays(copy)
  }

  const resetDayToDefault = (dayKey) => {
    const copy = { ...weekdays }
    
    if (!copy[dayKey]) return
    
    copy[dayKey] = {
      start: baseStartTime.format('HH:mm'),
      end: baseEndTime.format('HH:mm'),
      capacity: defaultCapacity,
      specialSlots: []
    }
    setWeekdays(copy)
  }
  

  const fillWeekdayWithBase = (dayKey) => {
    const weekday = weekdays[dayKey]
    if (!weekday || !weekday.start || !weekday.end) return []
    
    const slots = generateTimeSlots(weekday.start, weekday.end, slotDuration)
    return slots.map(slot => ({
      ...slot,
      capacity: weekday.capacity || defaultCapacity
    }))
  }

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      message.error('Введите название шаблона')
      return
    }

    try {
      setLoading(true)
      
      // Конвертируем weekdays в формат, который ожидает бэкенд
      const processedWeekdays = {}
      for (const [dayKey, profile] of Object.entries(weekdays)) {
        if (profile && profile.start && profile.end) {
          // Генерируем слоты на основе профиля дня
          const slots = generateTimeSlots(profile.start, profile.end, slotDuration)
          const slotsWithCapacity = slots.map(slot => ({
            ...slot,
            capacity: profile.capacity || defaultCapacity
          }))
          
          // Применяем специальные слоты (если есть)
          if (profile.specialSlots && Array.isArray(profile.specialSlots)) {
            profile.specialSlots.forEach(special => {
              const startMin = dayjs(special.start, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
              const endMin = dayjs(special.end, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
              
              slotsWithCapacity.forEach(slot => {
                const slotStartMin = dayjs(slot.start, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                const slotEndMin = dayjs(slot.end, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                
                if (slotStartMin >= startMin && slotEndMin <= endMin) {
                  slot.capacity = special.capacity
                  slot.type = special.type
                }
              })
            })
          }
          
          processedWeekdays[dayKey] = slotsWithCapacity
        }
      }
      
      console.log('💾 Сохраняю шаблон:', {
        name: templateName,
        weekdays: processedWeekdays,
        specialSlots: Object.fromEntries(
          Object.entries(weekdays).map(([key, profile]) => [
            key, 
            profile?.specialSlots || []
          ])
        )
      })
      
      const templateData = {
        name: templateName,
        description,
        baseStartTime: baseStartTime.format('HH:mm'),
        baseEndTime: baseEndTime.format('HH:mm'),
        slotDuration: slotDuration,
        defaultCapacity,
        weekdays: processedWeekdays
      }

      if (id) {
        await api.put(`/admin/templates/${id}`, templateData)
        message.success('Шаблон обновлен')
      } else {
        await api.post('/admin/templates', templateData)
        message.success('Шаблон создан')
      }

      navigate('/admin/templates')
    } catch (error) {
      message.error('Ошибка сохранения шаблона')
    } finally {
      setLoading(false)
    }
  }

  const isCellSelected = (dayKey, timeSlot) => {
    return selectedCells.some(c => c.dayKey === dayKey && c.timeSlot === timeSlot)
  }

  const toggleSelectCell = (dayKey, timeSlot, additive) => {
    setSelectedCells((prev) => {
      const exists = prev.some(c => c.dayKey === dayKey && c.timeSlot === timeSlot)
      if (additive) {
        return exists ? prev.filter(c => !(c.dayKey === dayKey && c.timeSlot === timeSlot)) : [...prev, { dayKey, timeSlot }]
      }
      // not additive: replace with single selection
      return exists ? [] : [{ dayKey, timeSlot }]
    })
  }

  const renderChessboard = () => {
    // Находим самый длинный рабочий день для определения временных слотов
    let maxStartTime = baseStartTime
    let maxEndTime = baseEndTime
    
    Object.values(weekdays).forEach(weekday => {
      if (weekday && weekday.start && weekday.end && weekday.capacity > 0) {
        const dayStart = dayjs(weekday.start, 'HH:mm')
        const dayEnd = dayjs(weekday.end, 'HH:mm')
        
        if (dayStart.isBefore(maxStartTime)) {
          maxStartTime = dayStart
        }
        if (dayEnd.isAfter(maxEndTime)) {
          maxEndTime = dayEnd
        }
      }
    })
    
    const timeSlots = generateTimeSlots(
      maxStartTime.format('HH:mm'), 
      maxEndTime.format('HH:mm'), 
      slotDuration
    )
    
    if (!timeSlots || timeSlots.length === 0) {
      return <div>Не удалось сгенерировать слоты времени</div>
    }
    
    // Отладочная информация
    console.log('🔍 DOW length:', DOW.length)
    console.log('🔍 DOW:', DOW)
    console.log('🔍 weekdays:', weekdays)
    
    // Функции подбора эстетичных цветов
    const getGreenBgByCapacity = (cap) => {
      const maxCap = 6
      const n = Math.max(0, Math.min(Number(cap) || 0, maxCap))
      const ratio = n / maxCap
      const lightness = 94 - Math.round(ratio * 28) // 94% → 66%
      const top = Math.min(100, lightness + 4)
      return `linear-gradient(180deg, hsl(145, 45%, ${top}%) 0%, hsl(145, 55%, ${lightness}%) 100%)`
    }
    const getGreenFgByCapacity = (cap) => {
      const maxCap = 6
      const n = Math.max(0, Math.min(Number(cap) || 0, maxCap))
      return n >= 3 ? '#0b2e13' : '#134d26'
    }

    return (
      <div style={{ border: '1px solid #d9d9d9', borderRadius: '8px', overflow: 'hidden' }}>
        {/* Заголовки дней + колонка времени слева */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: `120px repeat(${DOW.length}, 1fr)`,
          background: '#fafafa',
          borderBottom: '1px solid #d9d9d9'
        }}>
          {/* Левая колонка заголовков времени */}
          <div style={{ 
            padding: '8px', 
            fontWeight: 600, 
            textAlign: 'center',
            borderRight: '1px solid #d9d9d9',
            position: 'relative',
            background: '#fafafa'
          }}>Время</div>
          {DOW.map((d, index) => {
            const weekday = weekdays[d.key]
            const isClosed = weekday?.capacity === 0
            
            console.log(`🔍 Rendering day ${d.key} (${d.short}):`, { weekday, isClosed })
            
            return (
              <div 
                key={d.key} 
                style={{ 
                  padding: '8px', 
                  fontWeight: 600, 
                  textAlign: 'center',
                  borderRight: '1px solid #d9d9d9',
                  position: 'relative',
                  background: '#fafafa',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  setEditSlot({ 
                    dayKey: d.key, 
                    timeSlot: null, 
                    currentCapacity: weekday?.capacity || defaultCapacity, 
                    isSpecialSlot: false,
                    isDayEdit: true
                  })
                  setEditCapacity(weekday?.capacity || defaultCapacity)
                }}
                title={`Кликните для редактирования дня ${d.short}`}
              >
                <div style={{ 
                  marginBottom: '4px',
                  color: '#555',
                  fontWeight: 'bold'
                }}>
                  {d.short}
                </div>
              </div>
            )
          })}
        </div>
        
        {/* Слоты времени */}
        {timeSlots.map((t, timeIndex) => (
          <React.Fragment key={timeIndex}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: `120px repeat(${DOW.length}, 1fr)`,
              borderBottom: '1px solid #d9d9d9'
            }}>
              {/* Левая колонка со временем */}
              <div style={{ padding: '8px', background: '#fafafa', borderRight: '1px solid #d9d9d9', textAlign: 'center', color: '#555', fontSize: '12px' }}>
                {t.start}
              </div>
              {/* Слоты для каждого дня */}
              {DOW.map(d => {
                const weekday = weekdays[d.key]
                if (!weekday || !weekday.start || !weekday.end) {
                  return <div key={d.key} style={{ padding: '8px', background: '#fafafa', borderRight: '1px solid #d9d9d9' }} />
                }
                
                const timeMin = dayjs(t.start, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                const dayStartMin = dayjs(weekday.start, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                const dayEndMin = dayjs(weekday.end, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                const isWithin = timeMin >= dayStartMin && timeMin < dayEndMin
                
                // Проверяем, перекрывает ли это время какой-либо специальный слот
                let coversBySpecial = false
                if (weekday.specialSlots) {
                  weekday.specialSlots.forEach(special => {
                    const specialStartMin = dayjs(special.start, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                    const specialEndMin = dayjs(special.end, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                    if (timeMin >= specialStartMin && timeMin < specialEndMin) {
                      coversBySpecial = true
                    }
                  })
                }

                if (!(isWithin || coversBySpecial)) {
                  // Время вне окна дня и без специальных слотов — позволяем кликнуть, чтобы создать его
                  return (
                    <div
                      key={d.key}
                      style={{ padding: '8px', background: '#fafafa', borderRight: '1px solid #d9d9d9', borderBottom: '1px solid #d9d9d9', color: '#999', textAlign: 'center', cursor: 'pointer' }}
                      title={'Добавить слот в это время'}
                      onClick={() => {
                        const additive = (window.event && (window.event.metaKey || window.event.ctrlKey))
                        if (additive) {
                          toggleSelectCell(d.key, t.start, true)
                          return
                        }
                        setSelectedCells([])
                        setEditSlot({ dayKey: d.key, timeSlot: t.start, currentCapacity: 0, isSpecialSlot: false })
                        setEditCapacity(defaultCapacity)
                      }}
                    >
                      
                    </div>
                  )
                }
                
                // Базовая вместимость: 0 для времени вне окна, иначе capacity дня
                let capacity = isWithin ? (typeof weekday.capacity === 'number' ? weekday.capacity : defaultCapacity) : 0
                
                // Специальные слоты перекрывают базовую вместимость (могут открыть время в выходной/за окном)
                if (weekday.specialSlots) {
                  weekday.specialSlots.forEach(special => {
                    const specialStartMin = dayjs(special.start, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                    const specialEndMin = dayjs(special.end, 'HH:mm').diff(dayjs('00:00', 'HH:mm'), 'minute')
                    if (timeMin >= specialStartMin && timeMin < specialEndMin) {
                      capacity = special.capacity
                    }
                  })
                }
                
                const isWorking = capacity > 0
                const bg = isWorking 
                  ? getGreenBgByCapacity(capacity)
                  : 'linear-gradient(180deg, hsl(0, 80%, 98%) 0%, hsl(0, 75%, 96%) 100%)'
                const fg = isWorking ? getGreenFgByCapacity(capacity) : '#a8071a'
                
                return (
                  <div 
                    key={d.key} 
                    style={{ 
                      padding: '8px', 
                      background: bg, 
                      color: fg, 
                      fontSize: '12px', 
                      textAlign: 'center',
                      cursor: 'pointer',
                      borderRight: '1px solid #d9d9d9',
                      borderBottom: '1px solid #d9d9d9',
                      fontWeight: 600,
                      boxShadow: isCellSelected(d.key, t.start) ? 'inset 0 0 0 2px #1677ff' : 'none'
                    }}
                    onClick={() => {
                      const additive = (window.event && (window.event.metaKey || window.event.ctrlKey))
                      if (additive) {
                        toggleSelectCell(d.key, t.start, true)
                        return
                      }
                      setSelectedCells([])
                      setEditSlot({ dayKey: d.key, timeSlot: t.start, currentCapacity: capacity, isSpecialSlot: false })
                      setEditCapacity(capacity)
                    }}
                    title={'Кликните для изменения'}
                  >
                    {capacity}
                  </div>
                )
              })}
            </div>
          </React.Fragment>
        ))}
      </div>
    )
  }

  if (loading) {
    return <div style={{ padding: '24px', textAlign: 'center' }}>Загрузка...</div>
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Заголовок и кнопка назад */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <Button 
          icon={<ArrowLeftOutlined />} 
          onClick={() => navigate('/admin/templates')}
          style={{ marginRight: '16px' }}
        >
          Назад к списку
        </Button>
        <Title level={3} style={{ margin: 0 }}>
          {id ? 'Редактирование шаблона' : 'Создание шаблона'}
        </Title>
      </div>

      {/* Основной контент */}
      <Row gutter={24}>
        {/* Левая колонка - настройки */}
        <Col span={12}>
          <Card title="Базовые настройки" style={{ marginBottom: '24px' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>Название шаблона:</Text>
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Введите название шаблона"
                  style={{ width: '100%', marginTop: '8px' }}
                />
              </div>
              
              <div>
                <Text strong>Описание:</Text>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Описание шаблона (необязательно)"
                  style={{ width: '100%', marginTop: '8px' }}
                />
              </div>
              
              <Row gutter={16}>
                <Col span={12}>
                  <Text strong>Время начала:</Text>
                  <TimePicker
                    value={baseStartTime}
                    onChange={setBaseStartTime}
                    format="HH:mm"
                    minuteStep={30}
                    style={{ width: '100%', marginTop: '8px' }}
                  />
                </Col>
                <Col span={12}>
                  <Text strong>Время окончания:</Text>
                  <TimePicker
                    value={baseEndTime}
                    onChange={setBaseEndTime}
                    format="HH:mm"
                    minuteStep={30}
                    style={{ width: '100%', marginTop: '8px' }}
                  />
                </Col>
              </Row>
              
              <Row gutter={16}>
                <Col span={12}>
                  <Text strong>Вместимость по умолчанию:</Text>
                  <Input
                    type="number"
                    min={1}
                    value={defaultCapacity}
                    onChange={(e) => setDefaultCapacity(Number(e.target.value) || 1)}
                    style={{ marginTop: '8px' }}
                    suffix="чел."
                  />
                </Col>
                <Col span={12}>
                  <Text strong>Длительность слота:</Text>
                  <Select
                    value={slotDuration}
                    onChange={setSlotDuration}
                    style={{ width: '100%', marginTop: '8px' }}
                    options={[
                      { value: 15, label: '15 минут' },
                      { value: 30, label: '30 минут' },
                      { value: 45, label: '45 минут' },
                      { value: 60, label: '1 час' }
                    ]}
                  />
                </Col>
              </Row>
            </Space>
          </Card>

          {/* Настройки дней недели (просто: рабочий? и время с/до) */}
          <Card title="Настройки дней недели" style={{ marginBottom: '24px' }}>
            {/* Заголовки колонок */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '35px 90px 70px 70px 80px 80px',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: '2px solid #d9d9d9',
              marginBottom: '8px',
              fontWeight: 600,
              fontSize: '11px',
              color: '#666'
            }}>
              <div style={{ textAlign: 'center' }}>День</div>
              <div>Статус</div>
              <div>Начало</div>
              <div>Конец</div>
              <div>Сотрудники</div>
              <div style={{ textAlign: 'center' }}>Действия</div>
            </div>
            
            <Space direction="vertical" style={{ width: '100%' }}>
              {DOW.map(d => {
                const wd = weekdays[d.key] || {}
                const working = (wd.capacity ?? defaultCapacity) > 0
                return (
                  <div key={d.key} style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '35px 90px 70px 70px 80px 80px',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 0',
                    borderBottom: '1px solid #f0f0f0'
                  }}>
                    {/* День недели */}
                    <div style={{ fontWeight: 600, textAlign: 'center', fontSize: '12px' }}>{d.short}</div>
                    
                    {/* Рабочий день */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Text style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>Рабочий:</Text>
                      <Switch
                        checked={working}
                        onChange={(checked) => {
                          const copy = { ...weekdays }
                          copy[d.key] = copy[d.key] || {}
                          copy[d.key].capacity = checked ? (defaultCapacity || 1) : 0
                          // При включении заполняем базовыми часами, если пусто
                          copy[d.key].start = copy[d.key].start || baseStartTime.format('HH:mm')
                          copy[d.key].end = copy[d.key].end || baseEndTime.format('HH:mm')
                          setWeekdays(copy)
                        }}
                        size="small"
                      />
                    </div>
                    
                    {/* Время начала */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Text style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>с</Text>
                      <TimePicker
                        value={wd.start ? dayjs(wd.start, 'HH:mm') : baseStartTime}
                        onChange={(val) => {
                          const copy = { ...weekdays }
                          copy[d.key] = copy[d.key] || {}
                          copy[d.key].start = (val || baseStartTime).format('HH:mm')
                          setWeekdays(copy)
                        }}
                        format="HH:mm"
                        minuteStep={30}
                        disabled={!working}
                        style={{ width: 55 }}
                        size="small"
                      />
                    </div>
                    
                    {/* Время окончания */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Text style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>до</Text>
                      <TimePicker
                        value={wd.end ? dayjs(wd.end, 'HH:mm') : baseEndTime}
                        onChange={(val) => {
                          const copy = { ...weekdays }
                          copy[d.key] = copy[d.key] || {}
                          copy[d.key].end = (val || baseEndTime).format('HH:mm')
                          setWeekdays(copy)
                        }}
                        format="HH:mm"
                        minuteStep={30}
                        disabled={!working}
                        style={{ width: 55 }}
                        size="small"
                      />
                    </div>
                    
                    {/* Количество сотрудников */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        value={wd.capacity || defaultCapacity}
                        onChange={(e) => {
                          const copy = { ...weekdays }
                          copy[d.key] = copy[d.key] || {}
                          copy[d.key].capacity = Number(e.target.value) || 0
                          setWeekdays(copy)
                        }}
                        disabled={!working}
                        style={{ width: 50 }}
                        size="small"
                        suffix="чел."
                        placeholder="0"
                      />
                    </div>
                    
                    {/* Кнопка сброса */}
                    <div style={{ textAlign: 'center' }}>
                      <Button 
                        size="small" 
                        onClick={() => resetDayToDefault(d.key)}
                        disabled={!working}
                        style={{ fontSize: '11px', padding: '0 6px' }}
                      >
                        Сброс
                      </Button>
                    </div>
                  </div>
                )
              })}
            </Space>
          </Card>
        </Col>

        {/* Правая колонка - предпросмотр */}
        <Col span={12}>
          <Card className="template-preview" title="Предварительный просмотр шаблона">
            {renderChessboard()}
          </Card>
        </Col>
      </Row>

      {/* Кнопки действий */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
        <Button onClick={() => navigate('/admin/templates')}>
          Отмена
        </Button>
        <Button type="primary" onClick={saveTemplate} loading={loading}>
          {id ? 'Обновить' : 'Создать'}
        </Button>
      </div>

      {selectedCells.length > 0 && (
        <div style={{ position:'sticky', bottom:16, zIndex:3, display:'flex', gap:12, alignItems:'center', background:'#fff', padding:'8px 12px', border:'1px solid #e6f4ff', boxShadow:'0 8px 24px rgba(0,0,0,0.08)', borderRadius:8 }}>
          <div style={{ fontWeight:600 }}>Выбрано: {selectedCells.length}</div>
          <div style={{ color:'#555' }}>Вместимость:</div>
          <Input type="number" min={0} style={{ width:160 }} placeholder="например, 2 (0 — перерыв)" value={bulkCapacity} onChange={(e)=>setBulkCapacity(Math.max(0, Number(e.target.value)||0))} />
          <Button type="primary" onClick={() => {
            try {
              selectedCells.forEach(c => updateSlotCapacity(c.dayKey, c.timeSlot, bulkCapacity))
              message.success('Изменения применены')
              setSelectedCells([])
            } catch {
              message.error('Не удалось применить изменения')
            }
          }}>Применить</Button>
          <Button onClick={()=>setSelectedCells([])}>Сбросить</Button>
        </div>
      )}

      {/* Модалка для редактирования вместимости слота или дня */}
      <Modal
        title={editSlot?.isDayEdit ? "Редактирование дня" : "Изменить вместимость слота"}
        open={!!editSlot}
        onCancel={() => setEditSlot(null)}
        footer={[
          <Button key="cancel" onClick={() => setEditSlot(null)}>
            Отмена
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            onClick={() => {
              if (editSlot) {
                if (editSlot.isDayEdit) {
                  // Переключение дня: если editCapacity == 0, закрыть день; иначе открыть и оставить часы
                  if (editCapacity === 0) {
                    closeEntireDay(editSlot.dayKey)
                  } else {
                    const copy = { ...weekdays }
                    copy[editSlot.dayKey] = copy[editSlot.dayKey] || {}
                    copy[editSlot.dayKey].capacity = editCapacity
                    if (!copy[editSlot.dayKey].start) copy[editSlot.dayKey].start = baseStartTime.format('HH:mm')
                    if (!copy[editSlot.dayKey].end) copy[editSlot.dayKey].end = baseEndTime.format('HH:mm')
                    setWeekdays(copy)
                  }
                } else {
                  // Редактируем слот
                  updateSlotCapacity(editSlot.dayKey, editSlot.timeSlot, editCapacity)
                }
                setEditSlot(null)
              }
            }}
          >
            {'Сохранить'}
          </Button>
        ]}
        width={600}
      >
        {editSlot && (
          <div>
            {editSlot.isDayEdit ? (
              // Редактирование дня
              <>
                <div style={{ marginBottom: '16px' }}>
                  <Text strong>День:</Text> {DOW.find(d => d.key === editSlot.dayKey)?.label}
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <Text strong>Вместимость по умолчанию:</Text>
                  <Input
                    type="number"
                    min={0}
                    value={editCapacity}
                    onChange={(e) => setEditCapacity(Math.max(0, Number(e.target.value) || 0))}
                    style={{ width: '100%', marginTop: '8px' }}
                  />
                  {editCapacity === 0 && (
                    <div style={{ marginTop: '8px', color: '#ff4d4f', fontSize: '12px' }}>
                      💡 Установите 0 для создания выходного дня
                    </div>
                  )}
                </div>
                <div style={{ 
                  padding: '12px', 
                  background: '#f5f5f5', 
                  borderRadius: '6px',
                  fontSize: '12px'
                }}>
                  <Text strong>Действия:</Text>
                  <ul style={{ marginTop: '8px', marginBottom: 0 }}>
                    <li><strong>Сохранить</strong> — применяет рабочий/выходной и вместимость</li>
                  </ul>
                </div>
              </>
            ) : (
              // Редактирование слота
              <>
                <div style={{ marginBottom: '16px' }}>
                  <Text strong>День:</Text> {DOW.find(d => d.key === editSlot.dayKey)?.label}
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <Text strong>Время:</Text> {editSlot.timeSlot}
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <Text strong>Текущая вместимость:</Text> {editSlot.currentCapacity}
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <Text strong>Тип слота:</Text> 
                  <Tag color={editSlot.isSpecialSlot ? 'blue' : 'default'} style={{ marginLeft: '8px' }}>
                    {editSlot.isSpecialSlot ? 'Специальный' : 'Базовый'}
                  </Tag>
                </div>
                <div>
                  <Text strong>Новая вместимость:</Text>
                  <Input
                    type="number"
                    min={0}
                    value={editCapacity}
                    onChange={(e) => setEditCapacity(Math.max(0, Number(e.target.value) || 0))}
                    style={{ width: '100%', marginTop: '8px' }}
                  />
                  {editCapacity === 0 && (
                    <div style={{ marginTop: '8px', color: '#ff4d4f', fontSize: '12px' }}>
                      💡 Установите 0 для создания обеденного перерыва или технической паузы
                    </div>
                  )}

                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
