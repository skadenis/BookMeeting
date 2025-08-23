import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './modules/App.jsx'
import { Admin } from './modules/Admin.jsx'

function Root() {
  const path = window.location.pathname
  if (path.startsWith('/admin')) return <Admin />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)