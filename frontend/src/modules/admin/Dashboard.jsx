import React, { useEffect, useMemo, useState } from 'react'
import { Card, List, Tag, Button, Space, Typography, Modal, Form, Input, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../../api/client'

function useApi() { return api }

function toISODate(date) { return new Date(date).toISOString().slice(0,10) }

export default function Dashboard() {
  const api = useApi()
  const navigate = useNavigate()
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(false)
  const [todayMap, setTodayMap] = useState({})
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm()

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

  useEffect(() => { load() }, [api])

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
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>Офисы</Typography.Title>
        <Button type="primary" onClick={()=>{ form.resetFields(); setCreateOpen(true) }}>Добавить офис</Button>
      </div>
      {offices.some(o => !Number(o.bitrixOfficeId)) && (
        <Card style={{ marginBottom: 12, borderColor:'#fff1f0', background:'#fff2f0' }}>
          <Space direction="vertical" size={4}>
            <Typography.Text style={{ color:'#cf1322', fontWeight:600 }}>Внимание: у некоторых офисов не заполнен Bitrix Office ID.</Typography.Text>
            <Typography.Text type="secondary">Такие офисы скрыты для операторов до заполнения идентификатора.</Typography.Text>
          </Space>
        </Card>
      )}

      <List
        loading={loading}
        grid={{ gutter: 12, column: 2 }}
        dataSource={offices}
        renderItem={(o) => (
          <List.Item key={o.id}>
            <Card
              title={(o.city && o.address)
                ? <span>{o.city} <span style={{ color:'#999', fontWeight:400 }}> • {o.address}</span></span>
                : <span>{o.city || o.address || ''}</span>}
              extra={<Button type="link" onClick={() => navigate(`/admin/offices/${o.id}`)}>Открыть</Button>}
            >
              <Space direction="vertical" size={6}>
                <div>
                  <Typography.Text type="secondary">Сегодня</Typography.Text>
                </div>
                <div>{renderToday(o.id)}</div>
                {!Number(o.bitrixOfficeId) && (
                  <Tag color="error">Не заполнен Bitrix Office ID</Tag>
                )}
              </Space>
            </Card>
          </List.Item>
        )}
      />
      <Modal
        open={createOpen}
        title="Добавить офис"
        onCancel={()=>setCreateOpen(false)}
        onOk={async()=>{
          try {
            const values = await form.validateFields()
            await api.post('/offices', {
              city: values.city,
              address: values.address,
              addressNote: values.addressNote || undefined,
              bitrixOfficeId: values.bitrixOfficeId ? Number(String(values.bitrixOfficeId).replace(/[^0-9]/g,'')) : undefined,
            })
            message.success('Офис добавлен')
            setCreateOpen(false)
            await load()
          } catch (e) {}
        }}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="city" label="Город" rules={[{ required: true, message: 'Укажите город' }]}>
            <Input placeholder="например: Минск" />
          </Form.Item>
          <Form.Item name="address" label="Адрес" rules={[{ required: true, message: 'Укажите адрес' }]}>
            <Input placeholder="например: ул. Ленина 15, пом. 4Н" />
          </Form.Item>
          <Form.Item name="addressNote" label="Примечание">
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="bitrixOfficeId" label="Bitrix Office ID">
            <Input placeholder="например, 12345" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}


