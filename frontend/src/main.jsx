import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from './modules/App.jsx'
import AdminLayout from './modules/admin/Layout.jsx'
import OfficesPage from './modules/admin/OfficesPage.jsx'
import TemplatesPage from './modules/admin/TemplatesPage.jsx'
import OverridesPage from './modules/admin/OverridesPage.jsx'
import 'antd/dist/reset.css'

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  {
    path: '/admin', element: <AdminLayout />, children: [
      { index: true, element: <OfficesPage /> },
      { path: 'offices', element: <OfficesPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'overrides', element: <OverridesPage /> },
    ]
  },
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)