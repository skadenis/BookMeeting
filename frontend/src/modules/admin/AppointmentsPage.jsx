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
  TimePicker
} from 'antd'
import {
  CalendarOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  ReloadOutlined,
  EditOutlined
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

  const statsData = [
    {
      title: 'Всего встреч',
      value: statistics.total,
      color: '#1677ff'
    },
    {
      title: 'Ожидают подтверждения',
      value: statistics.pending,
      color: '#faad14'
    },
    {
      title: 'Подтверждены',
      value: statistics.confirmed,
      color: '#52c41a'
    },
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

  return (
    <div>
      <PageHeader
        title="Управление встречами"
        icon={<CalendarOutlined />}
        onRefresh={loadAppointments}
        loading={loading}
      />

      <StatsSection stats={statsData} />

      <FilterSection title="Фильтры">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Период</div>
          <RangePicker
            value={filters.dateRange}
            onChange={(dates) => handleFilterChange('dateRange', dates)}
            format="DD.MM.YYYY"
            style={{ width: 240 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Статус</div>
          <Select
            placeholder="Все статусы"
            value={filters.status}
            onChange={(value) => handleFilterChange('status', value)}
            style={{ width: 180 }}
            allowClear
          >
            <Select.Option value="pending">Ожидает подтверждения</Select.Option>
            <Select.Option value="confirmed">Подтверждена</Select.Option>
            <Select.Option value="cancelled">Отменена</Select.Option>
            <Select.Option value="rescheduled">Перенесена</Select.Option>
          </Select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Офис</div>
          <Select
            placeholder="Все офисы"
            value={filters.office}
            onChange={(value) => handleFilterChange('office', value)}
            style={{ width: 220 }}
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

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Поиск</div>
          <Search
            placeholder="Поиск по лиду, сделке..."
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
        </div>

        <Button
          icon={<ReloadOutlined />}
          onClick={resetFilters}
          style={{ alignSelf: 'flex-end' }}
        >
          Сбросить
        </Button>
      </FilterSection>

      <PageTable
        columns={columns}
        dataSource={appointments}
        loading={loading}
        pagination={pagination}
        onChange={handleTableChange}
        scroll={{ x: 1000 }}
      />

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
    </div>
  )
}
