import React from 'react'
import { Typography, Space, Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

const { Title } = Typography

/**
 * Единый компонент заголовка для страниц админки
 * @param {string} title - Заголовок страницы
 * @param {string} icon - Иконка для заголовка (опционально)
 * @param {React.ReactNode} extra - Дополнительные элементы справа (кнопки и т.д.)
 * @param {function} onRefresh - Функция обновления данных (опционально)
 * @param {boolean} loading - Состояние загрузки
 */
export default function PageHeader({
  title,
  icon,
  extra,
  onRefresh,
  loading = false
}) {
  return (
    <div style={{
      marginBottom: '24px',
      padding: '20px 0',
      borderBottom: '1px solid #f0f0f0'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {icon && <span style={{ fontSize: '24px', color: '#1890ff' }}>{icon}</span>}
          <Title level={3} style={{
            margin: 0,
            fontWeight: 600,
            color: '#262626'
          }}>
            {title}
          </Title>
        </div>

        <Space>
          {onRefresh && (
            <Button
              icon={<ReloadOutlined />}
              onClick={onRefresh}
              loading={loading}
            >
              Обновить
            </Button>
          )}
          {extra}
        </Space>
      </div>
    </div>
  )
}
