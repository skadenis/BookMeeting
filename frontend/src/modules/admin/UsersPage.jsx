import React, { useEffect, useState } from 'react'
import { Table, Button, Space, Form, Input, Modal, message, Tag, Select } from 'antd'
import api from '../../api/client'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/admin/users')
      setUsers(r?.data?.data || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const onCreate = async () => {
    try {
      const values = await createForm.validateFields()
      await api.post('/admin/users', values)
      message.success('Пользователь создан')
      setCreateOpen(false)
      createForm.resetFields()
      load()
    } catch {}
  }

  const onSave = async (u) => {
    const payload = { name: u.name, role: u.role }
    if (u._password && u._password.trim()) payload.password = u._password.trim()
    await api.put(`/admin/users/${u.id}`, payload)
    message.success('Сохранено')
    load()
  }

  const onDelete = async (u) => {
    Modal.confirm({
      title: 'Удалить пользователя?',
      content: `${u.email}`,
      okText: 'Да, удалить', cancelText: 'Нет', okButtonProps: { danger: true },
      onOk: async () => { await api.delete(`/admin/users/${u.id}`); message.success('Удалён'); load() }
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ marginTop: 0 }}>Пользователи</h3>
        <Button type="primary" onClick={() => setCreateOpen(true)}>Добавить пользователя</Button>
      </div>

      <Table rowKey="id" dataSource={users} loading={loading} pagination={false}
        columns={[
          { title: 'Email', dataIndex: 'email' },
          { title: 'Имя', dataIndex: 'name', render: (v, r) => (
            <Input value={r.name} onChange={e => { r.name = e.target.value; setUsers([...users]) }} />
          ) },
          { title: 'Роль', dataIndex: 'role', render: (v, r) => (
            <Select value={r.role} onChange={val => { r.role = val; setUsers([...users]) }}
              options={[
                { value: 'admin', label: 'admin' },
                { value: 'editor', label: 'editor' },
                { value: 'viewer', label: 'viewer' },
              ]}
              style={{ width: 140 }}
            />
          ) },
          { title: 'Новый пароль', render: (_, r) => (
            <Input.Password placeholder="Оставьте пустым, чтобы не менять"
              value={r._password || ''} onChange={e => { r._password = e.target.value; setUsers([...users]) }} />
          ) },
          { title: 'Действия', render: (_, r) => (
            <Space>
              <Button type="primary" onClick={() => onSave(r)}>Сохранить</Button>
              <Button danger onClick={() => onDelete(r)}>Удалить</Button>
            </Space>
          ) },
        ]}
      />

      <Modal open={createOpen} onCancel={() => setCreateOpen(false)} onOk={onCreate} okText="Создать" title="Новый пользователь">
        <Form layout="vertical" form={createForm} initialValues={{ role: 'admin' }}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item name="name" label="Имя" rules={[{ required: true }]}>
            <Input placeholder="Имя пользователя" />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 3 }]}>
            <Input.Password placeholder="••••••" />
          </Form.Item>
          <Form.Item name="role" label="Роль">
            <Select options={[
              { value: 'admin', label: 'admin' },
              { value: 'editor', label: 'editor' },
              { value: 'viewer', label: 'viewer' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}


