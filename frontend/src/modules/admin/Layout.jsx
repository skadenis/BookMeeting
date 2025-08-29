import React, { useMemo } from 'react'
import { Layout, Menu, Modal, Form, Input, Button, message } from 'antd'
import { BankOutlined, ScheduleOutlined, TeamOutlined, CalendarOutlined } from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Header, Sider, Content } = Layout

export default function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const selectedKey = useMemo(() => {
    if (location.pathname.includes('/admin/users')) return 'users'
    if (location.pathname.includes('/admin/templates')) return 'templates'
    if (location.pathname.includes('/admin/appointments')) return 'appointments'
    return 'offices'
  }, [location.pathname])

  const [form] = Form.useForm()
  const [token, setToken] = React.useState(typeof window !== 'undefined' ? localStorage.getItem('admin.token') : null)

  // Auto-read admin_token from URL and persist
  React.useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const qToken = sp.get('admin_token') || sp.get('adminToken') || sp.get('token')
      if (qToken) {
        localStorage.setItem('admin.token', qToken)
        // Clean URL without token
        const url = new URL(window.location.href)
        url.searchParams.delete('admin_token')
        url.searchParams.delete('adminToken')
        url.searchParams.delete('token')
        window.history.replaceState({}, '', url.toString())
        window.location.reload()
      }
    } catch {}
  }, [])

  const doLogin = async () => {
    try {
      const values = await form.validateFields()
      const r = await fetch((import.meta.env.VITE_API_BASE_URL || '/api') + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
      })
      if (!r.ok) throw new Error('Auth failed')
      const data = await r.json()
      localStorage.setItem('admin.token', data.token)
      message.success('Вход выполнен')
      window.location.replace('/admin')
    } catch (e) {}
  }

  // Validate token on load; clear invalid token (avoids false-positive access)
  React.useEffect(() => {
    let cancelled = false
    async function validate() {
      try {
        const t = localStorage.getItem('admin.token')
        if (!t) return
        const r = await fetch((import.meta.env.VITE_API_BASE_URL || '/api') + '/auth/me', {
          headers: { Authorization: `Bearer ${t}` }
        })
        if (!r.ok) throw new Error('invalid')
        if (!cancelled) setToken(t)
      } catch {
        localStorage.removeItem('admin.token')
        if (!cancelled) setToken(null)
      }
    }
    validate()
    return () => { cancelled = true }
  }, [])

  // If not authenticated, show full-page login and do not render admin UI
  if (!token) {
    return (
      <Layout style={{ minHeight: '100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width: 360, background:'#fff', borderRadius:8, padding:24, boxShadow:'0 4px 24px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}>Вход в админку</div>
          <Form form={form} layout="vertical">
            <Form.Item name="email" label="Email" rules={[{ required:true, type:'email' }]}> 
              <Input placeholder="Введите email" />
            </Form.Item>
            <Form.Item name="password" label="Пароль" rules={[{ required:true }]}> 
              <Input.Password placeholder="••••••" />
            </Form.Item>
            <Button type="primary" style={{ width:'100%' }} onClick={doLogin}>Войти</Button>
          </Form>
        </div>
      </Layout>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ height: 48, color: '#fff', display: 'flex', alignItems: 'center', padding: '0 16px', fontWeight: 600 }}>Админка</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} onClick={(e) => navigate(`/admin/${e.key}`)}
          items={[
            { key: 'offices', icon: <BankOutlined />, label: 'Офисы' },
            { key: 'templates', icon: <ScheduleOutlined />, label: 'Шаблоны' },
            { key: 'appointments', icon: <CalendarOutlined />, label: 'Встречи' },
            { key: 'users', icon: <TeamOutlined />, label: 'Пользователи' },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, flex:1 }}>Управление расписанием</div>
          <Button onClick={()=>{ localStorage.removeItem('admin.token'); window.location.replace('/admin') }}>Выйти</Button>
        </Header>
        <Content style={{ margin: 16 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 16 }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}