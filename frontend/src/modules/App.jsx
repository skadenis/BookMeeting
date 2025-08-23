import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

function useBitrixContext() {
  const [token, setToken] = useState(null)
  const [domain, setDomain] = useState(null)
  const [leadId, setLeadId] = useState(undefined)

  useEffect(() => {
    if (window.BX24 && window.BX24.getAuth) {
      try {
        const auth = window.BX24.getAuth()
        setToken(auth?.access_token || null)
        setDomain(auth?.domain || null)
      } catch {}
    } else {
      setToken(import.meta.env.VITE_DEV_BITRIX_TOKEN || null)
      setDomain(import.meta.env.VITE_DEV_BITRIX_DOMAIN || null)
    }
  }, [])

  return { token, domain, leadId }
}

export function App() {
  const { token, domain, leadId } = useBitrixContext()
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' })
    instance.interceptors.request.use((config) => {
      if (token) config.headers.Authorization = `Bearer ${token}`
      if (domain) config.headers['X-Bitrix-Domain'] = domain
      return config
    })
    return instance
  }, [token, domain])

  const [offices, setOffices] = useState([])
  const [selectedOfficeId, setSelectedOfficeId] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [slots, setSlots] = useState([])
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])

  useEffect(() => {
    api.get('/offices').then((r) => setOffices(r.data.data)).catch(console.error)
  }, [api])

  useEffect(() => {
    if (!selectedOfficeId) { setSlots([]); return }
    setLoading(true)
    api.get('/slots', { params: { office_id: selectedOfficeId, date } })
      .then((r) => setSlots(r.data.data))
      .finally(() => setLoading(false))
  }, [api, selectedOfficeId, date])

  useEffect(() => {
    api.get('/appointments', { params: { lead_id: leadId } }).then((r) => setAppointments(r.data.data)).catch(console.error)
  }, [api, leadId])

  const refreshHistory = async (id) => {
    const r = await api.get(`/appointments/${id}/history`)
    setHistory(r.data.data)
  }

  const createAppointment = async (slot) => {
    if (!selectedOfficeId) return
    await api.post('/appointments', {
      office_id: selectedOfficeId,
      date,
      time_slot: `${slot.start}-${slot.end}`,
      lead_id: leadId,
    })
    const [a, s] = await Promise.all([
      api.get('/appointments', { params: { lead_id: leadId } }),
      api.get('/slots', { params: { office_id: selectedOfficeId, date } }),
    ])
    setAppointments(a.data.data)
    setSlots(s.data.data)
  }

  const updateAppointment = async (id, data) => {
    await api.put(`/appointments/${id}`, data)
    const [a, s] = await Promise.all([
      api.get('/appointments', { params: { lead_id: leadId } }),
      selectedOfficeId ? api.get('/slots', { params: { office_id: selectedOfficeId, date } }) : Promise.resolve({ data: { data: [] } })
    ])
    setAppointments(a.data.data)
    if (selectedOfficeId) setSlots(s.data.data)
    await refreshHistory(id)
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial', padding: 16 }}>
      <h2 style={{ margin: '8px 0' }}>Управление встречами</h2>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label>Офис</label><br />
          <select value={selectedOfficeId} onChange={(e) => setSelectedOfficeId(e.target.value)}>
            <option value="">— выберите офис —</option>
            {offices.map(o => <option key={o.id} value={o.id}>{o.name} • {o.city}</option>)}
          </select>
        </div>
        <div>
          <label>Дата</label><br />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: '8px 0' }}>Доступные слоты</h3>
        {loading ? <div>Загрузка…</div> : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {slots.length === 0 && <div>Нет доступных слотов</div>}
            {slots.map(s => (
              <button key={s.id} onClick={() => createAppointment(s)} style={{ padding: '6px 10px' }}>
                {s.start}–{s.end}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <h3 style={{ margin: '8px 0' }}>Назначенные встречи</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Дата</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Время</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Офис</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>Статус</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}></th>
              </tr>
            </thead>
            <tbody>
              {appointments.map(a => (
                <tr key={a.id}>
                  <td style={{ padding: 6 }}>{a.date}</td>
                  <td style={{ padding: 6 }}>{a.timeSlot}</td>
                  <td style={{ padding: 6 }}>{a.Office?.name || a.office?.name}</td>
                  <td style={{ padding: 6 }}>{a.status}</td>
                  <td style={{ padding: 6 }}>
                    {a.status !== 'confirmed' && <button onClick={() => updateAppointment(a.id, { status: 'confirmed' })}>Подтвердить</button>}
                    {a.status !== 'cancelled' && <button onClick={() => updateAppointment(a.id, { status: 'cancelled' })} style={{ marginLeft: 8 }}>Отменить</button>}
                    <button onClick={() => refreshHistory(a.id)} style={{ marginLeft: 8 }}>История</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 style={{ margin: '8px 0' }}>История</h3>
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #eee', padding: 8 }}>
            {history.length === 0 && <div>Выберите встречу</div>}
            {history.map(h => (
              <div key={h.id} style={{ borderBottom: '1px dashed #eee', padding: '6px 0' }}>
                <div><strong>{h.action}</strong> — {new Date(h.createdAt || h.created_at).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: '#666' }}>by {h.changedBy || h.changed_by}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}