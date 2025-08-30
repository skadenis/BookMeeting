import React, { useEffect, useState } from 'react'
import { DatePicker, Button, Card, Table, Tag, Space, message } from 'antd'
import { BarChartOutlined, SyncOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/client'
import PageHeader from './components/PageHeader'
import StatsSection from './components/StatsSection'

const { RangePicker } = DatePicker

const STATUS_COLORS = {
  completed: 'cyan',
  no_show: 'volcano',
  cancelled: 'red'
}

const STATUS_LABELS = {
  completed: 'Завершена успешно',
  no_show: 'Не пришел на встречу',
  cancelled: 'Отменена'
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [stats, setStats] = useState({ completed: 0, no_show: 0, cancelled: 0, total: 0 })
  const [dailyData, setDailyData] = useState([])
  const [lastSync, setLastSync] = useState(null)
  const [filters, setFilters] = useState({
    dateRange: [dayjs().subtract(30, 'days'), dayjs()]
  })

  const loadAnalytics = async () => {
    setLoading(true)
    try {
      const params = {}
      if (filters.dateRange && filters.dateRange.length === 2) {
        params.start_date = filters.dateRange[0].format('YYYY-MM-DD')
        params.end_date = filters.dateRange[1].format('YYYY-MM-DD')
      }

      const response = await api.get('/admin/sync/completed-stats', { params })
      const data = response.data.data

      setStats(data.summary || { completed: 0, no_show: 0, cancelled: 0, total: 0 })
      setDailyData(data.daily || [])
    } catch (error) {
      console.error('Ошибка загрузки аналитики:', error)
      message.error('Не удалось загрузить аналитику')
    } finally {
      setLoading(false)
    }
  }

  const runAutoSync = async () => {
    setSyncLoading(true)
    try {
      const response = await api.post('/admin/sync/auto-sync-statuses')
      const result = response.data.data
      
      message.success(result.message || 'Синхронизация завершена')
      setLastSync(dayjs())
      
      // Перезагружаем аналитику после синхронизации
      await loadAnalytics()
    } catch (error) {
      console.error('Ошибка автосинхронизации:', error)
      message.error('Не удалось выполнить синхронизацию')
    } finally {
      setSyncLoading(false)
    }
  }

  useEffect(() => {
    loadAnalytics()
  }, [filters.dateRange])

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const statsData = [
    {
      title: 'Завершено успешно',
      value: stats.completed,
      color: '#13c2c2'
    },
    {
      title: 'Не пришли',
      value: stats.no_show,
      color: '#ff4d4f'
    },
    {
      title: 'Отменены',
      value: stats.cancelled,
      color: '#faad14'
    },
    {
      title: 'Всего обработано',
      value: stats.total,
      color: '#1677ff'
    }
  ]

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'date',
      key: 'date',
      render: (date) => dayjs(date).format('DD.MM.YYYY'),
      sorter: (a, b) => dayjs(a.date).unix() - dayjs(b.date).unix()
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Tag color={STATUS_COLORS[status]}>
          {STATUS_LABELS[status]}
        </Tag>
      ),
      filters: [
        { text: 'Завершена успешно', value: 'completed' },
        { text: 'Не пришел', value: 'no_show' },
        { text: 'Отменена', value: 'cancelled' }
      ],
      onFilter: (value, record) => record.status === value
    },
    {
      title: 'Количество',
      dataIndex: 'count',
      key: 'count',
      render: (count) => <strong>{count}</strong>,
      sorter: (a, b) => a.count - b.count
    }
  ]

  return (
    <div>
      <PageHeader
        title="Аналитика встреч"
        icon={<BarChartOutlined />}
        extra={
          <Space>
            <Button
              icon={<SyncOutlined />}
              onClick={runAutoSync}
              loading={syncLoading}
              type="primary"
              size="small"
            >
              Синхронизировать статусы
            </Button>
          </Space>
        }
        onRefresh={loadAnalytics}
        loading={loading}
      />

      {lastSync && (
        <Card size="small" style={{ marginBottom: '16px', background: '#f6ffed' }}>
          <div style={{ color: '#52c41a', fontSize: '12px' }}>
            Последняя синхронизация: {lastSync.format('DD.MM.YYYY HH:mm')}
          </div>
        </Card>
      )}

      <StatsSection stats={statsData} />

      <Card style={{ marginBottom: '16px' }}>
        <Space>
          <span>Период:</span>
          <RangePicker
            value={filters.dateRange}
            onChange={(dates) => handleFilterChange('dateRange', dates)}
            format="DD.MM.YYYY"
          />
        </Space>
      </Card>

      <Card title="Детализация по дням">
        <Table
          columns={columns}
          dataSource={dailyData}
          loading={loading}
          rowKey={(record) => `${record.date}-${record.status}`}
          pagination={{ pageSize: 20 }}
          size="small"
        />
      </Card>
    </div>
  )
}
