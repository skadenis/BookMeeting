import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, Modal, Form, Input, TimePicker, Card, message } from 'antd'
import dayjs from 'dayjs'
import api from '../../api/client'

function useApi() { return api }

const DOW = [
  { key:'1', label:'Пн' },{ key:'2', label:'Вт' },{ key:'3', label:'Ср' },{ key:'4', label:'Чт' },{ key:'5', label:'Пт' },{ key:'6', label:'Сб' },{ key:'0', label:'Вс' }
]

function halfHourSlots(start, end) {
  const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m }
  const toTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
  const res = []
  let s = toMin(start), e = toMin(end)
  for (let t=s; t<e; t+=30) res.push({ start: toTime(t), end: toTime(t+30), capacity: 1 })
  return res
}

export default function TemplatesManager() {
  const api = useApi()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('Новый шаблон')
  const [period, setPeriod] = useState([dayjs('09:00','HH:mm'), dayjs('18:00','HH:mm')])
  const [weekdays, setWeekdays] = useState({ '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '0': [] })

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/templates')
      setData(r?.data?.data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setName('Новый шаблон')
    setWeekdays({ '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '0': [] })
    setEditorOpen(true)
  }
  const openEdit = (tpl) => {
    setEditing(tpl)
    setName(tpl.name)
    setWeekdays(tpl.weekdays || { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '0': [] })
    setEditorOpen(true)
  }
  const remove = async (tpl) => {
    Modal.confirm({
      title: 'Удалить шаблон?',
      content: `Вы уверены, что хотите удалить "${tpl.name}"?`,
      okText: 'Да, удалить', cancelText: 'Нет', okButtonProps: { danger: true },
      onOk: async () => { await api.delete(`/templates/${tpl.id}`); message.success('Удалено'); load() }
    })
  }

  const save = async () => {
    if (editing) {
      await api.put(`/templates/${editing.id}`, { name, weekdays })
      message.success('Сохранено')
    } else {
      await api.post('/templates', { name, weekdays })
      message.success('Создано')
    }
    setEditorOpen(false)
    await load()
  }

  const fill = (key) => {
    if (!period?.[0] || !period?.[1]) return
    const slots = halfHourSlots(period[0].format('HH:mm'), period[1].format('HH:mm'))
    setWeekdays({ ...weekdays, [key]: slots })
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Шаблоны расписания</h3>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={openCreate}>Добавить шаблон</Button>
        <Button onClick={load}>Обновить</Button>
      </Space>
      <Table rowKey="id" dataSource={data} loading={loading} pagination={false}
        columns={[
          { title: 'Название', dataIndex: 'name' },
          { title: 'Дней заполнено', render:(_,r)=> Object.values(r.weekdays||{}).filter(a=>a&&a.length).length },
          { title: 'Действия', render:(_,r)=> (
            <Space>
              <Button onClick={()=>openEdit(r)}>Редактировать</Button>
              <Button danger onClick={()=>remove(r)}>Удалить</Button>
            </Space>
          ) },
        ]}
      />

      <Modal open={editorOpen} onCancel={()=>setEditorOpen(false)} onOk={save} okText={editing ? 'Сохранить' : 'Создать'} width={920} title={editing ? 'Редактирование шаблона' : 'Новый шаблон'}>
        <Space direction="vertical" size={12} style={{ width:'100%' }}>
          <Form layout="vertical">
            <Form.Item label="Название">
              <Input value={name} onChange={e=>setName(e.target.value)} />
            </Form.Item>
            <Form.Item label="Быстрое заполнение периода">
              <Space>
                <TimePicker.RangePicker value={period} onChange={setPeriod} format="HH:mm" minuteStep={30} />
                <span style={{ color:'#999' }}>(30-минутные слоты)</span>
              </Space>
            </Form.Item>
          </Form>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(260px, 1fr))', gap:12 }}>
            {DOW.map(d => (
              <Card key={d.key} title={d.label} extra={<Button onClick={()=>fill(d.key)}>Заполнить</Button>}>
                <div style={{ color:'#999' }}>Слотов: {(weekdays[d.key]||[]).length}</div>
              </Card>
            ))}
          </div>
        </Space>
      </Modal>
    </div>
  )
}


