import React, { useEffect, useState } from 'react'
import { Form, InputNumber, Button, message, Card, Typography } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import api from '../../api/client'
import PageHeader from './components/PageHeader'

const { Text } = Typography

export default function SettingsPage() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [settings, setSettings] = useState({})

  const loadSettings = async () => {
    setLoading(true)
    try {
      const response = await api.get('/admin/settings')
      const data = response.data.data || {}
      setSettings(data)
      form.setFieldsValue(data)
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error)
      message.error('Не удалось загрузить настройки')
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async (values) => {
    setSaveLoading(true)
    try {
      await api.put('/admin/settings', values)
      setSettings(values)
      message.success('Настройки сохранены')
    } catch (error) {
      console.error('Ошибка сохранения настроек:', error)
      message.error('Не удалось сохранить настройки')
    } finally {
      setSaveLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  return (
    <div>
      <PageHeader
        title="Настройки системы"
        icon={<SettingOutlined />}
        onRefresh={loadSettings}
        loading={loading}
      />

      <Card title="Настройки записи операторов" style={{ maxWidth: 600 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={saveSettings}
          initialValues={{
            max_booking_days: 7
          }}
        >
          <Form.Item
            name="max_booking_days"
            label="Максимальный период записи"
            rules={[
              { required: true, message: 'Укажите максимальный период записи' },
              { type: 'number', min: 1, max: 365, message: 'Период должен быть от 1 до 365 дней' }
            ]}
            help={
              <Text type="secondary" style={{ fontSize: '12px' }}>
                На сколько дней вперед от текущей даты операторы могут записывать клиентов. 
                Например, если указать 7 дней, то оператор сможет записать клиента максимум на неделю вперед.
              </Text>
            }
          >
            <InputNumber
              min={1}
              max={365}
              addonAfter="дней"
              placeholder="7"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={saveLoading}
            >
              Сохранить настройки
            </Button>
          </Form.Item>
        </Form>

        {settings.max_booking_days && (
          <div style={{ 
            marginTop: '16px', 
            padding: '12px', 
            background: '#f6ffed', 
            border: '1px solid #b7eb8f', 
            borderRadius: '6px' 
          }}>
            <Text style={{ color: '#52c41a', fontSize: '14px' }}>
              <strong>Текущие настройки:</strong> Операторы могут записывать клиентов максимум на {settings.max_booking_days} {
                settings.max_booking_days === 1 ? 'день' : 
                settings.max_booking_days < 5 ? 'дня' : 'дней'
              } вперед от текущей даты.
            </Text>
          </div>
        )}
      </Card>
    </div>
  )
}
