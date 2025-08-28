import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from './modules/App.jsx'
import AdminLayout from './modules/admin/Layout.jsx'
import Dashboard from './modules/admin/Dashboard.jsx'
import OfficeDetail from './modules/admin/OfficeDetail.jsx'
import TemplatesPage from './modules/admin/TemplatesPage.jsx'
import TemplateEditPage from './modules/admin/TemplateEditPage.jsx'
import UsersPage from './modules/admin/UsersPage.jsx'
import 'antd/dist/reset.css'
import { ConfigProvider } from 'antd'
import ruRU from 'antd/locale/ru_RU'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import updateLocale from 'dayjs/plugin/updateLocale'

dayjs.extend(updateLocale)
dayjs.locale('ru')
dayjs.updateLocale('ru', { weekStart: 1 })

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  {
    path: '/admin', element: <AdminLayout />, children: [
      { index: true, element: <Dashboard /> },
      { path: 'offices', element: <Dashboard /> },
      { path: 'offices/:id', element: <OfficeDetail /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'templates/new', element: <TemplateEditPage /> },
      { path: 'templates/:id/edit', element: <TemplateEditPage /> },
      { path: 'users', element: <UsersPage /> },
    ]
  },
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={ruRU}>
      <RouterProvider router={router} />
    </ConfigProvider>
  </React.StrictMode>
)