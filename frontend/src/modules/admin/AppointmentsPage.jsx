import React, { useEffect, useState } from 'react'
import {
  DatePicker,
  Button,
  Tag,
  Select,
  Input,
  message,
  Tooltip,
  Modal,
  Space,
  Form,
  TimePicker,
  List,
  Checkbox,
  Divider,
  Row,
  Col,
  Card,
  Statistic,
  Typography
} from 'antd'
import {
  CalendarOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  ReloadOutlined,
  EditOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  BarChartOutlined,
  FilterOutlined,
  TableOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/client'
import PageHeader from './components/PageHeader'
import { FilterSection } from './components/PageSection'
import PageTable from './components/PageTable'
import StatsSection from './components/StatsSection'

const { RangePicker } = DatePicker
const { Search } = Input

function useApi() { return api }

const TIME_SLOTS = [
  '09:00-09:30', '09:30-10:00', '10:00-10:30', '10:30-11:00',
  '11:00-11:30', '11:30-12:00', '12:00-12:30', '12:30-13:00',
  '13:00-13:30', '13:30-14:00', '14:00-14:30', '14:30-15:00',
  '15:00-15:30', '15:30-16:00', '16:00-16:30', '16:30-17:00',
  '17:00-17:30', '17:30-18:00'
]

const STATUS_COLORS = {
  pending: 'gold',
  confirmed: 'green',
  cancelled: 'red',
  rescheduled: 'blue'
}

const STATUS_LABELS = {
  pending: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  cancelled: 'Отменена',
  rescheduled: 'Перенесена'
}

export default function AppointmentsPage() {
  const api = useApi()
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(false)
  const [offices, setOffices] = useState([])
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0,
    showSizeChanger: true,
    showQuickJumper: true,
    showTotal: (total, range) => `${range[0]}-${range[1]} из ${total} встреч`
  })
  const [filters, setFilters] = useState({
    dateRange: [dayjs().startOf('week'), dayjs().endOf('week')],
    status: '',
    office: '',
    search: ''
  })

  useEffect(() => {
    loadAppointments()
    loadStatistics()
    loadOffices()
  }, [filters])

  // Функция для обновления данных (вызывается кнопкой "Обновить")
  const handleRefresh = () => {
    loadAppointments()
    loadStatistics()
    loadOffices()
  }

  const loadAppointments = async (page = pagination.current, pageSize = pagination.pageSize) => {
    setLoading(true)
    try {
      const params = {
        page,
        pageSize
      }

      if (filters.dateRange && filters.dateRange.length === 2) {
        params.start_date = filters.dateRange[0].format('YYYY-MM-DD')
        params.end_date = filters.dateRange[1].format('YYYY-MM-DD')
      }

      if (filters.status) {
        params.status = filters.status
      }

      if (filters.office) {
        params.office_id = filters.office
      }

      if (filters.search) {
        params.search = filters.search
      }

      const response = await api.get('/admin/appointments', { params })

      setAppointments(response.data.data || [])
      setPagination(prev => ({
        ...prev,
        current: page,
        pageSize,
        total: response.data.meta?.total || 0
      }))
    } catch (error) {
      console.error('Ошибка загрузки встреч:', error)
      message.error('Не удалось загрузить встречи')
    } finally {
      setLoading(false)
    }
  }

  const loadOffices = async () => {
    try {
      const response = await api.get('/admin/offices')
      setOffices(response.data.data || [])
    } catch (error) {
      console.error('Ошибка загрузки офисов:', error)
    }
  }

  const updateAppointmentStatus = async (id, status) => {
    try {
      await api.put(`/admin/appointments/${id}`, { status })
      message.success('Статус встречи обновлен')
      loadAppointments()
      loadStatistics()
    } catch (error) {
      message.error('Не удалось обновить статус встречи')
    }
  }

  const [statistics, setStatistics] = useState({
    total: 0,
    pending: 0,
    confirmed: 0,
    cancelled: 0,
    rescheduled: 0
  })

  // Состояние для модального окна редактирования
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState(null)
  const [editForm] = Form.useForm()

  const loadStatistics = async () => {
    try {
      const params = {}

      if (filters.dateRange && filters.dateRange.length === 2) {
        params.start_date = filters.dateRange[0].format('YYYY-MM-DD')
        params.end_date = filters.dateRange[1].format('YYYY-MM-DD')
      }

      const response = await api.get('/admin/appointments/stats/overview', { params })
      setStatistics(response.data.data || {
        total: 0,
        pending: 0,
        confirmed: 0,
        cancelled: 0,
        rescheduled: 0
      })
    } catch (error) {
      console.error('Ошибка загрузки статистики:', error)
      // В случае ошибки оставляем предыдущую статистику
    }
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPagination(prev => ({ ...prev, current: 1 })) // Сбрасываем на первую страницу при изменении фильтров
  }

  const resetFilters = () => {
    setFilters({
      dateRange: [dayjs().startOf('week'), dayjs().endOf('week')],
      status: '',
      office: '',
      search: ''
    })
    setPagination(prev => ({ ...prev, current: 1 }))
  }

  const handleTableChange = (paginationInfo, filters, sorter) => {
    setPagination(prev => ({
      ...prev,
      current: paginationInfo.current,
      pageSize: paginationInfo.pageSize
    }))
    loadAppointments(paginationInfo.current, paginationInfo.pageSize)
  }

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'date',
      key: 'date',
      render: (date) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {dayjs(date).format('DD.MM.YYYY')}
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {dayjs(date).format('dddd')}
          </div>
        </div>
      ),
      sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix(),
      defaultSortOrder: 'ascend'
    },
    {
      title: 'Время',
      dataIndex: 'timeSlot',
      key: 'timeSlot',
      render: (timeSlot) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ClockCircleOutlined style={{ color: '#1677ff' }} />
          {timeSlot}
        </div>
      )
    },
    {
      title: 'Офис',
      dataIndex: 'Office',
      key: 'office',
      render: (office) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <EnvironmentOutlined style={{ color: '#1677ff' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>
              {office?.city || 'Город не указан'}
            </div>
            <div style={{ fontSize: '12px', color: '#666', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {office?.address || 'Адрес не указан'}
              {office?.addressNote && (
                <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                  {office.addressNote}
                </div>
              )}
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>
          {STATUS_LABELS[status] || status}
        </Tag>
      ),
      filters: [
        { text: 'Ожидает подтверждения', value: 'pending' },
        { text: 'Подтверждена', value: 'confirmed' },
        { text: 'Отменена', value: 'cancelled' },
        { text: 'Перенесена', value: 'rescheduled' }
      ],
      onFilter: (value, record) => record.status === value
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title="Просмотр">
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => showAppointmentDetails(record)}
            />
          </Tooltip>
          <Tooltip title="Редактировать">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditModal(record)}
            />
          </Tooltip>
          {record.status === 'pending' && (
            <>
              <Button 
                size="small" 
                type="primary" 
                onClick={() => updateAppointmentStatus(record.id, 'confirmed')}
              >
                Подтвердить
              </Button>
              <Button 
                size="small" 
                danger 
                onClick={() => updateAppointmentStatus(record.id, 'cancelled')}
              >
                Отменить
              </Button>
            </>
          )}
        </Space>
      )
    }
  ]

  const [detailsModalVisible, setDetailsModalVisible] = useState(false)
  const [viewingAppointment, setViewingAppointment] = useState(null)

  const showAppointmentDetails = (appointment) => {
    setViewingAppointment(appointment)
    setDetailsModalVisible(true)
  }

  const handleDetailsEdit = () => {
    setDetailsModalVisible(false)
    openEditModal(viewingAppointment)
  }

  const openEditModal = (appointment) => {
    setEditingAppointment(appointment)
    editForm.setFieldsValue({
      date: dayjs(appointment.date),
      timeSlot: appointment.timeSlot,
      status: appointment.status
    })
    setEditModalVisible(true)
  }

  const handleEditSave = async () => {
    try {
      const values = await editForm.validateFields()
      // Проверяем, изменялись ли дата или время
      const isDateChanged = values.date.format('YYYY-MM-DD') !== editingAppointment.date
      const isTimeChanged = values.timeSlot !== editingAppointment.timeSlot
      const isStatusChanged = values.status !== editingAppointment.status

      const updateData = {
        date: values.date.format('YYYY-MM-DD'),
        time_slot: values.timeSlot
      }

      // Если статус был изменен вручную, передаем его
      if (isStatusChanged) {
        updateData.status = values.status
      }
      // Если статус не был изменен, но изменилась дата или время,
      // не передаем статус - пусть бэкенд установит rescheduled автоматически

      await api.put(`/admin/appointments/${editingAppointment.id}`, updateData)
      message.success('Встреча обновлена')
      setEditModalVisible(false)
      loadAppointments()
      loadStatistics()
    } catch (error) {
      message.error('Не удалось обновить встречу')
    }
  }

  // Функции для синхронизации с Bitrix24
  const handleSyncWithBitrix = async () => {
    try {
      setSyncLoading(true)

      // Устанавливаем таймаут для запроса (2 минуты)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000)

      // Запрашиваем данные через наш бэкенд
      const response = await api.get('/admin/appointments/sync/bitrix24', {
        signal: controller.signal,
        timeout: 120000
      })

      clearTimeout(timeoutId)

      const syncData = response.data.data
      setBitrixLeads(syncData.allLeads || [])

      // Объединяем новые и обновляемые встречи для отображения
      const allChanges = [
        ...(syncData.toCreate || []).map(group => ({ ...group, actionType: 'create' })),
        ...(syncData.toUpdate || []).map(group => ({ ...group, actionType: 'update' }))
      ]
      setMissingAppointments(allChanges)

      setSyncModalVisible(true)
    } catch (error) {
      console.error('Ошибка при синхронизации с Bitrix24:', error)

      if (error.name === 'AbortError') {
        message.error('Запрос прерван по таймауту. Попробуйте еще раз.')
      } else if (error.response?.status === 502) {
        message.error('Сервер недоступен. Попробуйте позже.')
      } else if (error.response?.status === 500) {
        message.error('Внутренняя ошибка сервера. Проверьте логи.')
      } else {
        message.error('Не удалось получить данные из Bitrix24')
      }
    } finally {
      setSyncLoading(false)
    }
  }

  const handleImportSelected = async () => {
    if (selectedLeads.length === 0) {
      message.warning('Выберите встречи для синхронизации')
      return
    }

    try {
      setSyncLoading(true)

      // Разделяем выбранные лиды на новые и существующие
      const toCreate = []
      const toUpdate = []

      // Получаем офисы для сопоставления
      const officesResponse = await api.get('/admin/offices')
      const offices = officesResponse.data.data || []
      const officeMap = offices.reduce((acc, office) => {
        acc[office.bitrixOfficeId] = office.id
        return acc
      }, {})

      for (const leadId of selectedLeads) {
        const lead = bitrixLeads.find(l => l.ID === leadId)
        if (lead) {
          const officeId = officeMap[lead.UF_CRM_1675255265]

          // Ищем, есть ли уже такая встреча в нашей системе
          const existingAppointment = missingAppointments
            .flatMap(group => group.leads)
            .find(app => app.bitrix_lead_id === leadId && app.id)

          if (existingAppointment) {
            // Обновляем существующую встречу
            toUpdate.push({
              id: existingAppointment.id,
              date: dayjs(lead.UF_CRM_1655460588).format('YYYY-MM-DD'),
              timeSlot: lead.UF_CRM_1657019494,
              status: lead.STATUS_ID === '37' ? 'confirmed' : 'pending'
            })
          } else if (officeId) {
            // Создаем новую встречу
            toCreate.push({
              bitrix_lead_id: lead.ID,
              office_id: officeId,
              date: dayjs(lead.UF_CRM_1655460588).format('YYYY-MM-DD'),
              timeSlot: lead.UF_CRM_1657019494,
              status: lead.STATUS_ID === '37' ? 'confirmed' : 'pending'
            })
          }
        }
      }

      console.log(`Importing: ${toCreate.length} to create, ${toUpdate.length} to update`)

      // Выполняем операции по частям, чтобы избежать таймаутов
      let createdCount = 0
      let updatedCount = 0

      if (toCreate.length > 0) {
        const createResponse = await api.post('/admin/appointments/bulk', { appointments: toCreate })
        createdCount = createResponse.data.data?.length || 0
        console.log(`Created ${createdCount} appointments`)
      }

      if (toUpdate.length > 0) {
        const updateResponse = await api.put('/admin/appointments/bulk', { appointments: toUpdate })
        updatedCount = updateResponse.data.data?.length || 0
        console.log(`Updated ${updatedCount} appointments`)
      }

      const totalProcessed = createdCount + updatedCount
      message.success(`Синхронизировано ${totalProcessed} встреч (${createdCount} создано, ${updatedCount} обновлено)`)
      setSyncModalVisible(false)
      setSelectedLeads([])
      loadAppointments()
      loadStatistics()

    } catch (error) {
      console.error('Ошибка при синхронизации:', error)

      if (error.response?.status === 502) {
        message.error('Сервер недоступен при обработке данных. Попробуйте с меньшим количеством записей.')
      } else if (error.response?.status === 500) {
        message.error('Ошибка сервера при обработке данных. Проверьте логи.')
      } else {
        message.error('Не удалось синхронизировать встречи')
      }
    } finally {
      setSyncLoading(false)
    }
  }

  // Основные показатели для быстрого просмотра
  const keyStatsData = [
    {
      title: 'Записано',
      value: statistics.pending,
      color: '#faad14',
      suffix: 'ожидают подтверждения'
    },
    {
      title: 'Подтверждено',
      value: statistics.confirmed,
      color: '#52c41a',
      suffix: 'активных встреч'
    }
  ]

  // Полная статистика для детального просмотра
  const fullStatsData = [
    {
      title: 'Всего',
      value: statistics.total,
      color: '#1677ff'
    },
    ...keyStatsData,
    {
      title: 'Отменены',
      value: statistics.cancelled,
      color: '#ff4d4f'
    },
    {
      title: 'Перенесены',
      value: statistics.rescheduled,
      color: '#722ed1'
    }
  ]

  const [showDetailedStats, setShowDetailedStats] = useState(false)
  const [showTable, setShowTable] = useState(true)

  // Состояния для синхронизации с Bitrix24
  const [syncModalVisible, setSyncModalVisible] = useState(false)
  const [bitrixLeads, setBitrixLeads] = useState([])
  const [missingAppointments, setMissingAppointments] = useState([])
  const [syncLoading, setSyncLoading] = useState(false)
  const [selectedLeads, setSelectedLeads] = useState([])


  const { Title, Text } = Typography

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      {/* Header Section */}
      <Card
        style={{
          marginBottom: '24px',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          border: 'none',
          borderRadius: '20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)'
            }}>
              <CalendarOutlined style={{ fontSize: '28px', color: 'white' }} />
            </div>
            <div>
              <Title level={2} style={{ margin: 0, color: '#1a1a1a' }}>
                Управление встречами
              </Title>
              <Text type="secondary" style={{ fontSize: '14px' }}>
                Синхронизация и управление записями клиентов
              </Text>
            </div>
          </div>

          <Space size="middle">
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={handleSyncWithBitrix}
              loading={syncLoading}
              style={{
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                border: 'none',
                boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
                fontWeight: '600'
              }}
            >
              Синхронизировать с Bitrix24
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={loading}
              style={{
                height: '44px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.8)',
                border: '1px solid rgba(102, 126, 234, 0.3)',
                color: '#667eea',
                fontWeight: '600'
              }}
            >
              Обновить
            </Button>
          </Space>
        </div>
      </Card>

      {/* Statistics Section */}
      <div style={{ marginBottom: '24px' }}>
        <StatsSection stats={showDetailedStats ? fullStatsData : keyStatsData} />
      </div>

      {/* Control Buttons */}
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <Button
          type={showTable ? "default" : "primary"}
          onClick={() => setShowTable(!showTable)}
          style={{
            borderRadius: '12px',
            height: '40px',
            background: showTable ? 'rgba(255, 255, 255, 0.9)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: showTable ? '1px solid #d9d9d9' : 'none',
            color: showTable ? '#666' : 'white',
            fontWeight: '500',
            transition: 'all 0.3s ease'
          }}
          icon={<EyeOutlined />}
        >
          {showTable ? 'Скрыть таблицу' : 'Показать таблицу'}
        </Button>

        <Button
          type="text"
          onClick={() => setShowDetailedStats(!showDetailedStats)}
          style={{
            borderRadius: '12px',
            height: '40px',
            color: '#667eea',
            fontWeight: '500',
            border: '1px solid rgba(102, 126, 234, 0.2)',
            background: 'rgba(255, 255, 255, 0.8)',
            transition: 'all 0.3s ease'
          }}
          icon={<BarChartOutlined />}
        >
          {showDetailedStats ? 'Показать основное' : 'Показать все статусы'}
        </Button>
      </div>

      {showTable && (
        <>
          {/* Filters Section */}
          <Card
            style={{
              marginBottom: '24px',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(10px)',
              border: 'none',
              borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
            }}
            title={
              <Space>
                <FilterOutlined style={{ color: '#667eea' }} />
                <span style={{ fontWeight: '600', color: '#1a1a1a' }}>Фильтры и поиск</span>
              </Space>
            }
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '20px',
              alignItems: 'end'
            }}>
              <div>
                <Text style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '500' }}>
                  📅 Период
                </Text>
                <RangePicker
                  value={filters.dateRange}
                  onChange={(dates) => handleFilterChange('dateRange', dates)}
                  format="DD.MM.YYYY"
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '12px',
                    border: '1px solid rgba(102, 126, 234, 0.3)'
                  }}
                  placeholder={['Дата начала', 'Дата окончания']}
                />
              </div>

              <div>
                <Text style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '500' }}>
                  📊 Статус
                </Text>
                <Select
                  placeholder="Все статусы"
                  value={filters.status}
                  onChange={(value) => handleFilterChange('status', value)}
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '12px',
                    border: '1px solid rgba(102, 126, 234, 0.3)'
                  }}
                  allowClear
                >
                  <Select.Option value="pending">
                    <Tag color="gold">Ожидает подтверждения</Tag>
                  </Select.Option>
                  <Select.Option value="confirmed">
                    <Tag color="green">Подтверждена</Tag>
                  </Select.Option>
                  <Select.Option value="cancelled">
                    <Tag color="red">Отменена</Tag>
                  </Select.Option>
                  <Select.Option value="rescheduled">
                    <Tag color="purple">Перенесена</Tag>
                  </Select.Option>
                </Select>
              </div>

              <div>
                <Text style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '500' }}>
                  🏢 Офис
                </Text>
                <Select
                  placeholder="Все офисы"
                  value={filters.office}
                  onChange={(value) => handleFilterChange('office', value)}
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '12px',
                    border: '1px solid rgba(102, 126, 234, 0.3)'
                  }}
                  allowClear
                  showSearch
                  filterOption={(input, option) =>
                    (option?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                >
                  {offices.map(office => (
                    <Select.Option key={office.id} value={office.id}>
                      {office.city} - {office.address}
                    </Select.Option>
                  ))}
                </Select>
              </div>

              <div>
                <Text style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '500' }}>
                  🔍 Поиск
                </Text>
                <Search
                  placeholder="Поиск по лиду, сделке..."
                  value={filters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                  style={{
                    width: '100%',
                    height: '44px',
                    borderRadius: '12px',
                    border: '1px solid rgba(102, 126, 234, 0.3)'
                  }}
                  allowClear
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={resetFilters}
                  style={{
                    height: '44px',
                    borderRadius: '12px',
                    border: '1px solid rgba(102, 126, 234, 0.3)',
                    color: '#667eea',
                    fontWeight: '500'
                  }}
                >
                  Сбросить фильтры
                </Button>
              </div>
            </div>
          </Card>

          {/* Appointments Table */}
          <Card
            style={{
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(10px)',
              border: 'none',
              borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden'
            }}
            title={
              <Space>
                <TableOutlined style={{ color: '#667eea' }} />
                <span style={{ fontWeight: '600', color: '#1a1a1a' }}>Список встреч</span>
                <Tag color="blue" style={{ borderRadius: '12px' }}>
                  {appointments.length} записей
                </Tag>
              </Space>
            }
          >
            <PageTable
              columns={columns}
              dataSource={appointments}
              loading={loading}
              pagination={pagination}
              onChange={handleTableChange}
              scroll={{ x: 1000 }}
              bordered={false}
            />
          </Card>
        </>
      )}

      {/* Модальное окно просмотра деталей встречи */}
      <Modal
        title="Детали встречи"
        open={detailsModalVisible}
        onCancel={() => setDetailsModalVisible(false)}
        onOk={handleDetailsEdit}
        width={600}
        okText="Редактировать"
        cancelText="Закрыть"
      >
        {viewingAppointment && (
          <div>
            <Row gutter={16}>
              <Col span={12}>
                <p><strong>Дата:</strong> {dayjs(viewingAppointment.date).format('DD.MM.YYYY dddd')}</p>
                <p><strong>Время:</strong> {viewingAppointment.timeSlot}</p>
                <p><strong>Статус:</strong> <Tag color={STATUS_COLORS[viewingAppointment.status]}>{STATUS_LABELS[viewingAppointment.status]}</Tag></p>
              </Col>
              <Col span={12}>
                <p><strong>Офис:</strong> {viewingAppointment.Office?.city}, {viewingAppointment.Office?.address}</p>
                <p><strong>Создано:</strong> {dayjs(viewingAppointment.createdAt).format('DD.MM.YYYY HH:mm')}</p>
                {viewingAppointment.bitrix_lead_id && (
                  <p><strong>ID лида в Битрикс:</strong> {viewingAppointment.bitrix_lead_id}</p>
                )}
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* Модальное окно редактирования встречи */}
      <Modal
        title="Редактирование встречи"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleEditSave}
        width={500}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form
          form={editForm}
          layout="vertical"
          initialValues={{
            status: 'pending'
          }}
        >
          <Form.Item
            name="date"
            label="Дата встречи"
            rules={[{ required: true, message: 'Выберите дату' }]}
          >
            <DatePicker
              format="DD.MM.YYYY"
              disabledDate={(current) => current && current < dayjs().startOf('day')}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            name="timeSlot"
            label="Время встречи"
            rules={[{ required: true, message: 'Выберите время' }]}
          >
            <Select placeholder="Выберите время">
              {TIME_SLOTS.map(slot => (
                <Select.Option key={slot} value={slot}>
                  {slot}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="Статус"
            rules={[{ required: true, message: 'Выберите статус' }]}
          >
            <Select>
              <Select.Option value="pending">Ожидает подтверждения</Select.Option>
              <Select.Option value="confirmed">Подтверждена</Select.Option>
              <Select.Option value="cancelled">Отменена</Select.Option>
              <Select.Option value="rescheduled">Перенесена</Select.Option>
            </Select>
          </Form.Item>

          {editingAppointment && (
            <div style={{ marginTop: 16, padding: 12, backgroundColor: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4 }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#52c41a' }}>
                <strong>Внимание:</strong> При изменении даты или времени без ручного изменения статуса, статус автоматически установится как "Перенесена".
              </p>
            </div>
          )}
        </Form>
      </Modal>

      {/* Модальное окно синхронизации с Bitrix24 */}
      <Modal
        title={
          <div style={{
            padding: '16px 24px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            margin: '-24px -24px 20px -24px',
            borderRadius: '16px 16px 0 0'
          }}>
            <Space align="center">
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <SyncOutlined style={{ fontSize: '24px', color: 'white' }} />
              </div>
              <div>
                <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
                  Синхронизация с Bitrix24
                </div>
                {syncLoading && (
                  <div style={{ fontSize: '14px', opacity: 0.9 }}>
                    Загрузка данных...
                  </div>
                )}
                {!syncLoading && bitrixLeads.length > 0 && (
                  <div style={{ fontSize: '14px', opacity: 0.9 }}>
                    {bitrixLeads.length} лидов получено из Bitrix24
                  </div>
                )}
              </div>
            </Space>
          </div>
        }
        open={syncModalVisible}
        onCancel={() => setSyncModalVisible(false)}
        width={900}
        footer={
          <div style={{
            padding: '16px 24px',
            background: '#fafafa',
            borderRadius: '0 0 16px 16px',
            margin: '0 -24px -24px -24px'
          }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <Button
                  onClick={() => setSelectedLeads(bitrixLeads.map(lead => lead.ID))}
                  style={{ borderRadius: '8px' }}
                >
                  Выбрать все
                </Button>
                <Button
                  onClick={() => setSelectedLeads([])}
                  style={{ borderRadius: '8px' }}
                >
                  Снять все
                </Button>
              </Space>
              <Space>
                <Button
                  onClick={() => setSyncModalVisible(false)}
                  style={{ borderRadius: '8px' }}
                >
                  Отмена
                </Button>
                <Button
                  type="primary"
                  onClick={handleImportSelected}
                  loading={syncLoading}
                  disabled={selectedLeads.length === 0}
                  style={{
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    border: 'none',
                    fontWeight: '600'
                  }}
                >
                  Импортировать выбранные ({selectedLeads.length})
                </Button>
              </Space>
            </Space>
          </div>
        }
        bodyStyle={{ padding: '0' }}
        style={{ borderRadius: '16px', overflow: 'hidden' }}
      >
        <div style={{ padding: '24px' }}>
          {syncLoading && (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <SyncOutlined spin style={{ fontSize: '48px', color: '#667eea', marginBottom: '16px' }} />
              <div style={{ fontSize: '16px', fontWeight: '500', color: '#1a1a1a' }}>
                Получение данных из Bitrix24...
              </div>
              <div style={{ color: '#666', marginTop: '8px' }}>
                Пожалуйста, подождите
              </div>
            </div>
          )}

          {!syncLoading && missingAppointments.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <CheckCircleOutlined style={{ fontSize: '64px', color: '#52c41a', marginBottom: '20px' }} />
              <div style={{ fontSize: '18px', fontWeight: '600', color: '#1a1a1a', marginBottom: '8px' }}>
                Все данные синхронизированы!
              </div>
              <div style={{ color: '#666', fontSize: '14px' }}>
                В Bitrix24 нет новых встреч для импорта
              </div>
            </div>
          )}

            {!syncLoading && missingAppointments.length > 0 && (
              <div>
                <div style={{
                  marginBottom: '20px',
                  padding: '16px',
                  background: 'linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%)',
                  borderRadius: '12px',
                  border: '1px solid #faad14'
                }}>
                  <Space align="start">
                    <WarningOutlined style={{ color: '#faad14', fontSize: '20px' }} />
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a', marginBottom: '4px' }}>
                        Найдено {missingAppointments.reduce((sum, group) => sum + group.count, 0)} изменений
                      </div>
                      <div style={{ color: '#666', fontSize: '14px' }}>
                        Новых встреч: {missingAppointments.filter(g => g.actionType === 'create').reduce((sum, group) => sum + group.count, 0)} |
                        Обновлений: {missingAppointments.filter(g => g.actionType === 'update').reduce((sum, group) => sum + group.count, 0)}
                      </div>
                    </div>
                  </Space>
                </div>

                <List
                  dataSource={missingAppointments}
                  renderItem={(group) => (
                    <List.Item style={{
                      padding: '16px',
                      marginBottom: '12px',
                      background: 'rgba(255, 255, 255, 0.8)',
                      borderRadius: '12px',
                      border: '1px solid rgba(102, 126, 234, 0.1)'
                    }}>
                      <div style={{ width: '100%' }}>
                        <div style={{
                          fontWeight: '600',
                          marginBottom: '12px',
                          color: '#1a1a1a',
                          fontSize: '16px'
                        }}>
                          {(() => {
                            const office = offices.find(o => o.bitrixOfficeId === group.officeId)
                            return office ? `${office.city} • ${office.address}` : `Офис ID: ${group.officeId}`
                          })()}
                          <Tag
                            color={group.actionType === 'create' ? 'green' : 'orange'}
                            style={{
                              marginLeft: '12px',
                              borderRadius: '12px',
                              fontSize: '12px'
                            }}
                          >
                            {group.actionType === 'create' ? 'Новые' : 'Обновить'} ({group.count})
                          </Tag>
                        </div>

                        <List
                          size="small"
                          dataSource={group.leads}
                          renderItem={(lead) => (
                            <List.Item style={{
                              padding: '8px 0',
                              border: 'none'
                            }}>
                              <Checkbox
                                checked={selectedLeads.includes(lead.ID)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLeads([...selectedLeads, lead.ID])
                                  } else {
                                    setSelectedLeads(selectedLeads.filter(id => id !== lead.ID))
                                  }
                                }}
                                style={{ marginRight: '12px' }}
                              />
                              <div style={{ flex: 1 }}>
                                <div style={{
                                  fontWeight: '500',
                                  color: '#1a1a1a',
                                  marginBottom: '4px'
                                }}>
                                  <span style={{ color: '#667eea' }}>Лид #{lead.ID}</span> •
                                  {dayjs(lead.UF_CRM_1655460588).format('DD.MM.YYYY')} •
                                  {lead.UF_CRM_1657019494}
                                </div>
                                <div style={{ color: '#666', fontSize: '12px' }}>
                                  Сотрудник ID: {lead.UF_CRM_1725445029}
                                  {group.actionType === 'update' && lead.currentStatus && (
                                    <span style={{ marginLeft: '12px', color: '#faad14' }}>
                                      Изменение: {lead.currentStatus} → {lead.status === '37' ? 'confirmed' : 'pending'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </List.Item>
                          )}
                        />
                      </div>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
