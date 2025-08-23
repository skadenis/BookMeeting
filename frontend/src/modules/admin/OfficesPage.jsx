import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, Form, Input, message } from 'antd'
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

export default function OfficesPage() {
  const api = useApi()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try { const r = await api.get('/offices'); setData(r.data.data) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const onCreate = async (values) => {
    await api.post('/offices', values); message.success('Офис создан'); form.resetFields(); load()
  }
  const onSave = async (record) => {
    await api.put(`/offices/${record.id}`, { name: record.name, city: record.city, address: record.address });
    message.success('Сохранено'); load()
  }
  const onDelete = async (record) => {
    await api.delete(`/offices/${record.id}`); message.success('Удалено'); load()
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Офисы</h3>
      <Form form={form} layout="inline" onFinish={onCreate} style={{ marginBottom: 12 }}>
        <Form.Item name="name" rules={[{ required:true, message:'Укажите название' }]}>
          <Input placeholder="Название" />
        </Form.Item>
        <Form.Item name="city" rules={[{ required:true, message:'Укажите город' }]}>
          <Input placeholder="Город" />
        </Form.Item>
        <Form.Item name="address" rules={[{ required:true, message:'Укажите адрес' }]}>
          <Input placeholder="Адрес" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">Создать</Button>
        </Form.Item>
      </Form>

      <Table rowKey="id" dataSource={data} loading={loading} pagination={false}
        columns={[
          { title:'Название', dataIndex:'name', render:(v,record)=> <Input value={record.name} onChange={e=>{ record.name=e.target.value; setData([...data]) }} /> },
          { title:'Город', dataIndex:'city', render:(v,record)=> <Input value={record.city} onChange={e=>{ record.city=e.target.value; setData([...data]) }} /> },
          { title:'Адрес', dataIndex:'address', render:(v,record)=> <Input value={record.address} onChange={e=>{ record.address=e.target.value; setData([...data]) }} /> },
          { title:'Действия', render:(_,record)=> (
            <Space>
              <Button onClick={()=>onSave(record)} type="primary">Сохранить</Button>
              <Button danger onClick={()=>onDelete(record)}>Удалить</Button>
            </Space>
          ) },
        ]
      />
    </div>
  )
}