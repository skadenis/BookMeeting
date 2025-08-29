import React, { useEffect, useMemo, useState, useRef } from 'react'
import { Button, Space, Input, DatePicker, TimePicker, Select, message, Card, Tabs, Typography, Divider, Row, Col, Tag, Tooltip, Modal } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, ClockCircleOutlined, UserOutlined, CoffeeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/client'
import { useNavigate } from 'react-router-dom'

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

function generateTimeSlots(start, end, duration = 30) {
  const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m }
  const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
  const res = []
  let s = toMin(start), e = toMin(end)
  for (let t=s; t<e; t+=duration) res.push({ start: toTime(t), end: toTime(t+duration) })
  return res
}

export default function TemplatesPage() {
  const api = useApi()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState([])
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(false)
  
  // Применение к офису - теперь для каждого шаблона отдельно
  const [templateSettings, setTemplateSettings] = useState({})

  useEffect(() => { 
    loadTemplates()
    loadOffices()
  }, [])

  const loadTemplates = async () => {
    try {
      setLoading(true)
      const response = await api.get('/admin/templates')
      setTemplates(response.data.data || [])
      
      // Инициализируем настройки для каждого шаблона
      const settings = {}
      response.data.data?.forEach(template => {
        settings[template.id] = {
          selectedOffice: '',
          dateRange: [dayjs(), dayjs().add(6, 'day')]
        }
      })
      setTemplateSettings(settings)
    } catch (error) {
      message.error('Ошибка загрузки шаблонов')
    } finally {
      setLoading(false)
    }
  }

  const loadOffices = async () => {
    try {
      const response = await api.get('/admin/offices')
      setOffices(response.data.data || [])
    } catch (error) {
      message.error('Ошибка загрузки офисов')
    }
  }

  const deleteTemplate = async (id) => {
    try {
      await api.delete(`/admin/templates/${id}`)
      message.success('Шаблон удален')
      loadTemplates()
    } catch (error) {
      message.error('Ошибка удаления шаблона')
    }
  }

  const applyTemplate = async (templateId) => {
    const settings = templateSettings[templateId]
    if (!settings?.selectedOffice) {
      message.error('Выберите офис')
      return
    }

    try {
      await api.post(`/admin/templates/${templateId}/apply`, {
        office_id: settings.selectedOffice,
        start_date: settings.dateRange[0].format('YYYY-MM-DD'),
        end_date: settings.dateRange[1].format('YYYY-MM-DD')
      })
      message.success('Шаблон применен к офису')
    } catch (error) {
      message.error('Ошибка применения шаблона')
    }
  }

  const updateTemplateSettings = (templateId, field, value) => {
    setTemplateSettings(prev => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        [field]: value
      }
    }))
  }

  const openCreateModal = () => {
    navigate('/admin/templates/new')
  }

  const editTemplate = (template) => {
    navigate(`/admin/templates/${template.id}/edit`)
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Title level={3} style={{ margin: 0 }}>Шаблоны расписания</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          Создать шаблон
        </Button>
      </div>

      {/* Список шаблонов */}
      <Row gutter={[16, 16]}>
        {templates.map(template => (
          <Col key={template.id} xs={24} sm={12} lg={8}>
            <Card
              title={template.name}
              extra={
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => editTemplate(template)}>
                    Изменить
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteTemplate(template.id)}>
                    Удалить
                  </Button>
                </Space>
              }
            >
              {template.description && (
                <Text type="secondary" style={{ display: 'block', marginBottom: '12px' }}>
                  {template.description}
                </Text>
              )}
              
              <div style={{ marginBottom: '12px' }}>
                <Text strong>Базовое время:</Text> {template.baseStartTime || '09:00'} - {template.baseEndTime || '18:00'}
              </div>
              
              <div style={{ marginBottom: '12px' }}>
                <Text strong>Слоты:</Text> {template.slotDuration || 30} мин, вместимость: {template.defaultCapacity || 1}
              </div>

              <div style={{ marginBottom: '16px' }}>
                <Text strong>Дни недели:</Text>
                <div style={{ marginTop: '8px' }}>
                  {DOW.map(d => {
                    const weekday = template.weekdays?.[d.key]
                    if (!weekday) return null
                    
                    // Проверяем формат данных
                    if (Array.isArray(weekday)) {
                      // Старый формат
                      return (
                        <Tag key={d.key} color="blue" style={{ marginBottom: '4px' }}>
                          {d.short}: {weekday[0]?.start || '00:00'}-{weekday[weekday.length - 1]?.end || '00:00'} ({weekday.length} слотов)
                        </Tag>
                      )
                    } else {
                      // Новый формат
                      return (
                        <Tag key={d.key} color="green" style={{ marginBottom: '4px' }}>
                          {d.short}: {weekday.start}-{weekday.end}
                        </Tag>
                      )
                    }
                  })}
                </div>
              </div>

              {/* Применение к офису */}
              <Divider />
              <div>
                <Text strong style={{ display: 'block', marginBottom: '8px' }}>
                  Применить к офису:
                </Text>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Select
                    placeholder="Выберите офис"
                    value={templateSettings[template.id]?.selectedOffice}
                    onChange={(value) => updateTemplateSettings(template.id, 'selectedOffice', value)}
                    style={{ width: '100%' }}
                    options={offices.map(office => ({
                      value: office.id,
                      label: `${office.address} • ${office.city}`
                    }))}
                  />
                  <DatePicker.RangePicker
                    value={templateSettings[template.id]?.dateRange}
                    onChange={(dates) => updateTemplateSettings(template.id, 'dateRange', dates)}
                    style={{ width: '100%' }}
                  />
                  <Button 
                    type="primary" 
                    size="small" 
                    onClick={() => applyTemplate(template.id)}
                    disabled={!templateSettings[template.id]?.selectedOffice}
                    style={{ width: '100%' }}
                  >
                    Применить шаблон
                  </Button>
                </Space>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}