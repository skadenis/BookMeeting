import React, { useEffect, useMemo, useState } from 'react'
import { Card, List, Tag, Button, Space, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import axios from 'axios'

function useApi() {
  const api = useMemo(() => axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' }), [])
  api.interceptors.request.use((config) => {
    config.headers['Authorization'] = 'Bearer dev'
    config.headers['X-Bitrix-Domain'] = 'dev'
    return config
  })
  return api
}

function toISODate(date) { return new Date(date).toISOString().slice(0,10) }

export default function Dashboard() {
  const api = useApi()
  const navigate = useNavigate()
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(false)
  const [todayMap, setTodayMap] = useState({})

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const r = await api.get('/offices')
        const list = r?.data?.data || []
        setOffices(list)
        const today = toISODate(new Date())
        const slots = await Promise.all(list.map(o => api.get('/slots/all', { params: { office_id: o.id, date: today } }).then(rr => rr?.data?.data || []).catch(()=>[])))
        const map = {}
        list.forEach((o, idx) => { map[o.id] = slots[idx] || [] })
        setTodayMap(map)
      } finally { setLoading(false) }
    }
    load()
  }, [api])

  const renderToday = (officeId) => {
    const list = todayMap[officeId] || []
    if (!list.length) return <Tag>Нет расписания</Tag>
    const byTime = (a,b) => a.start.localeCompare(b.start)
    const sorted = list.slice().sort(byTime)
    return (
      <Space size={6}>
        <Tag color="green">{sorted[0].start} — {sorted[sorted.length-1].end}</Tag>
        <Tag color="blue">{sorted.length} слотов</Tag>
      </Space>
    )
  }

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>Офисы</Typography.Title>
      <List
        loading={loading}
        grid={{ gutter: 12, column: 2 }}
        dataSource={offices}
        renderItem={(o) => (
          <List.Item key={o.id}>
            <Card
              title={<span>{o.name} <span style={{ color:'#999', fontWeight:400 }}>• {o.city}</span></span>}
              extra={<Button type="link" onClick={() => navigate(`/admin/offices/${o.id}`)}>Открыть</Button>}
            >
              <Space direction="vertical" size={6}>
                <div>
                  <Typography.Text type="secondary">Сегодня</Typography.Text>
                </div>
                <div>{renderToday(o.id)}</div>
              </Space>
            </Card>
          </List.Item>
        )}
      />
    </div>
  )
}


