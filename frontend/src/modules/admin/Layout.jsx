import React, { useMemo } from 'react'
import { Layout, Menu } from 'antd'
import { BankOutlined, CalendarOutlined, ScheduleOutlined } from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Header, Sider, Content } = Layout

export default function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const selectedKey = useMemo(() => {
    if (location.pathname.includes('/admin/templates')) return 'templates'
    if (location.pathname.includes('/admin/overrides')) return 'overrides'
    return 'offices'
  }, [location.pathname])

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ height: 48, color: '#fff', display: 'flex', alignItems: 'center', padding: '0 16px', fontWeight: 600 }}>Админка</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} onClick={(e) => navigate(`/admin/${e.key}`)}
          items={[
            { key: 'offices', icon: <BankOutlined />, label: 'Офисы' },
            { key: 'templates', icon: <ScheduleOutlined />, label: 'Шаблоны' },
            { key: 'overrides', icon: <CalendarOutlined />, label: 'Исключения' },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Управление расписанием</div>
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