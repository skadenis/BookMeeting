import React, { useEffect, useState } from 'react'
import { 
  Card, 
  Table, 
  DatePicker, 
  Space, 
  Button, 
  Tag, 
  Statistic, 
  Row, 
  Col, 
  Select, 
  Input,
  message,
  Tooltip,
  Modal
} from 'antd'
import { 
  CalendarOutlined, 
  ClockCircleOutlined, 
  EnvironmentOutlined, 
  UserOutlined,
  FilterOutlined,
  ReloadOutlined,
  EyeOutlined,
  EditOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/client'

const { RangePicker } = DatePicker
const { Search } = Input

function useApi() { return api }

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
  const [filters, setFilters] = useState({
    dateRange: [dayjs().startOf('week'), dayjs().endOf('week')],
    status: '',
    office: '',
    search: ''
  })

  useEffect(() => {
    loadAppointments()
    loadOffices()
  }, [filters])

  const loadAppointments = async () => {
    setLoading(true)
    try {
      const params = {}
      
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
    } catch (error) {
      message.error('Не удалось обновить статус встречи')
    }
  }

  const getStatistics = () => {
    const total = appointments.length
    const pending = appointments.filter(a => a.status === 'pending').length
    const confirmed = appointments.filter(a => a.status === 'confirmed').length
    const cancelled = appointments.filter(a => a.status === 'cancelled').length
    const rescheduled = appointments.filter(a => a.status === 'rescheduled').length

    return { total, pending, confirmed, cancelled, rescheduled }
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters({
      dateRange: [dayjs().startOf('week'), dayjs().endOf('week')],
      status: '',
      office: '',
      search: ''
    })
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
      dataIndex: 'office',
      key: 'office',
      render: (office) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {office?.city || 'Город не указан'}
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {office?.address || 'Адрес не указан'}
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
      render: (_, record) => (
        <Space>
          <Tooltip title="Просмотр">
            <Button 
              size="small" 
              icon={<EyeOutlined />} 
              onClick={() => showAppointmentDetails(record)}
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

  const showAppointmentDetails = (appointment) => {
    Modal.info({
      title: 'Детали встречи',
      width: 600,
      content: (
        <div>
          <Row gutter={16}>
            <Col span={12}>
              <p><strong>Дата:</strong> {dayjs(appointment.date).format('DD.MM.YYYY dddd')}</p>
              <p><strong>Время:</strong> {appointment.timeSlot}</p>
              <p><strong>Статус:</strong> <Tag color={STATUS_COLORS[appointment.status]}>{STATUS_LABELS[appointment.status]}</Tag></p>
            </Col>
            <Col span={12}>
              <p><strong>Офис:</strong> {appointment.office?.city}, {appointment.office?.address}</p>
              <p><strong>Создано:</strong> {dayjs(appointment.createdAt).format('DD.MM.YYYY HH:mm')}</p>
              {appointment.bitrix_lead_id && (
                <p><strong>ID лида в Битрикс:</strong> {appointment.bitrix_lead_id}</p>
              )}
            </Col>
          </Row>
        </div>
      )
    })
  }

  const stats = getStatistics()

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, marginBottom: '16px' }}>
          <CalendarOutlined style={{ marginRight: '8px' }} />
          Управление встречами
        </h2>
        
        {/* Статистика */}
        <Row gutter={16} style={{ marginBottom: '24px' }}>
          <Col span={4}>
            <Card size="small">
              <Statistic 
                title="Всего встреч" 
                value={stats.total} 
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic 
                title="Ожидают подтверждения" 
                value={stats.pending} 
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic 
                title="Подтверждены" 
                value={stats.confirmed} 
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic 
                title="Отменены" 
                value={stats.cancelled} 
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic 
                title="Перенесены" 
                value={stats.rescheduled} 
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
        </Row>

        {/* Фильтры */}
        <Card size="small" style={{ marginBottom: '16px' }}>
          <Space wrap style={{ width: '100%' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Период</div>
              <RangePicker
                value={filters.dateRange}
                onChange={(dates) => handleFilterChange('dateRange', dates)}
                format="DD.MM.YYYY"
              />
            </div>
            
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Статус</div>
              <Select
                placeholder="Все статусы"
                value={filters.status}
                onChange={(value) => handleFilterChange('status', value)}
                style={{ width: 150 }}
                allowClear
              >
                <Select.Option value="pending">Ожидает подтверждения</Select.Option>
                <Select.Option value="confirmed">Подтверждена</Select.Option>
                <Select.Option value="cancelled">Отменена</Select.Option>
                <Select.Option value="rescheduled">Перенесена</Select.Option>
              </Select>
            </div>
            
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Офис</div>
              <Select
                placeholder="Все офисы"
                value={filters.office}
                onChange={(value) => handleFilterChange('office', value)}
                style={{ width: 200 }}
                allowClear
              >
                {offices.map(office => (
                  <Select.Option key={office.id} value={office.id}>
                    {office.city} - {office.address}
                  </Select.Option>
                ))}
              </Select>
            </div>
            
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Поиск</div>
              <Search
                placeholder="Поиск по лиду, сделке..."
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                style={{ width: 200 }}
                allowClear
              />
            </div>
            
            <Button 
              icon={<ReloadOutlined />} 
              onClick={resetFilters}
            >
              Сбросить
            </Button>
          </Space>
        </Card>
      </div>

      {/* Таблица встреч */}
      <Card>
        <Table
          columns={columns}
          dataSource={appointments}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} из ${total} встреч`
          }}
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  )
}
