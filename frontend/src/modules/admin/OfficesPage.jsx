import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, Form, Input, message, Modal, Typography } from 'antd'
import { EnvironmentOutlined } from '@ant-design/icons'
import api from '../../api/client'
import PageHeader from './components/PageHeader'
import PageTable from './components/PageTable'

function useApi() { return api }

export default function OfficesPage() {
  const api = useApi()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const [deleteModal, setDeleteModal] = useState({ open: false, office: null, confirm: '' })

  const load = async () => {
    setLoading(true)
    try { 
      const r = await api.get('/offices')
      setData(r.data.data) 
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const onCreate = async (values) => {
    await api.post('/offices', {
      city: values.city,
      address: values.address,
      addressNote: values.addressNote,
      bitrixOfficeId: values.bitrixOfficeId ? Number(String(values.bitrixOfficeId).replace(/\D/g, '')) : undefined,
    });
    message.success('Офис создан');
    form.resetFields();
    load()
  }
  const onSave = async (record) => {
    await api.put(`/offices/${record.id}`, {
      city: record.city,
      address: record.address,
      addressNote: record.addressNote,
      bitrixOfficeId: record.bitrixOfficeId ? Number(String(record.bitrixOfficeId).replace(/\D/g, '')) : undefined,
    });
    message.success('Сохранено'); load()
  }
  const onDelete = async (record) => {
    await api.delete(`/offices/${record.id}`); message.success('Удалено'); load()
  }

  return (
    <div>
      <PageHeader
        title="Офисы"
        icon={<EnvironmentOutlined />}
        onRefresh={load}
        loading={loading}
      />

      <Form form={form} layout="inline" onFinish={onCreate} style={{ marginBottom: 16 }}>
        <Form.Item name="city" rules={[{ required:true, message:'Укажите город' }]}>
          <Input placeholder="Город" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name="address" rules={[{ required:true, message:'Укажите адрес' }]}>
          <Input placeholder="Адрес" style={{ width: 250 }} />
        </Form.Item>
        <Form.Item name="addressNote">
          <Input placeholder="Примечание (как проехать и т.д.)" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="bitrixOfficeId">
          <Input placeholder="Bitrix Office ID" inputMode="numeric" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">Создать</Button>
        </Form.Item>
      </Form>

      <PageTable
        dataSource={data}
        loading={loading}
        pagination={false}
        columns={[
          {
            title: 'Город',
            dataIndex: 'city',
            render: (v, record) => (
              <Input
                value={record.city}
                onChange={e => { record.city = e.target.value; setData([...data]) }}
                style={{ width: 150 }}
              />
            ),
            width: 170
          },
          {
            title: 'Адрес',
            dataIndex: 'address',
            render: (v, record) => (
              <Input
                value={record.address}
                onChange={e => { record.address = e.target.value; setData([...data]) }}
                style={{ width: 250 }}
              />
            ),
            width: 270
          },
          {
            title: 'Примечание',
            dataIndex: 'addressNote',
            render: (v, record) => (
              <Input
                value={record.addressNote || ''}
                onChange={e => { record.addressNote = e.target.value; setData([...data]) }}
                style={{ width: 200 }}
              />
            ),
            width: 220
          },
          {
            title: 'Bitrix Office ID',
            dataIndex: 'bitrixOfficeId',
            render: (v, record) => (
              <Input
                value={record.bitrixOfficeId ?? ''}
                onChange={e => { record.bitrixOfficeId = e.target.value.replace(/[^0-9]/g, ''); setData([...data]) }}
                style={{ width: 120 }}
              />
            ),
            width: 140
          },
          {
            title: 'Действия',
            render: (_, record) => (
              <Space>
                <Button onClick={() => onSave(record)} type="primary">Сохранить</Button>
                <Button danger onClick={() => setDeleteModal({ open: true, office: record, confirm: '' })}>Удалить</Button>
              </Space>
            ),
            width: 200,
            fixed: 'right'
          },
        ]}
        scroll={{ x: 1000 }}
      />

      <Modal
        open={deleteModal.open}
        onCancel={()=>setDeleteModal({ open:false, office:null, confirm:'' })}
        onOk={async()=>{ if (deleteModal.office) { await onDelete(deleteModal.office); setDeleteModal({ open:false, office:null, confirm:'' }) } }}
        okButtonProps={{ danger:true, disabled:!(deleteModal.office && deleteModal.confirm.trim() === `${deleteModal.office.city} • ${deleteModal.office.address}`) }}
        title="Удалить офис"
      >
        {deleteModal.office && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <Typography.Text>Это действие необратимо. Для подтверждения введите адрес офиса точно как ниже:</Typography.Text>
            <Typography.Text code>{deleteModal.office.city} • {deleteModal.office.address}</Typography.Text>
            <Input
              placeholder="Введите точный адрес офиса"
              value={deleteModal.confirm}
              onChange={(e)=>setDeleteModal({ ...deleteModal, confirm: e.target.value })}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}