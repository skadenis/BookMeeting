import React from 'react'
import { Card, Space } from 'antd'

/**
 * Единый компонент для секций с фильтрами, действиями и т.д.
 * @param {React.ReactNode} children - Содержимое секции
 * @param {string} title - Заголовок секции (опционально)
 * @param {boolean} bordered - Показывать рамку карточки
 * @param {string} size - Размер карточки ('default' | 'small')
 */
export default function PageSection({
  children,
  title,
  bordered = true,
  size = 'small'
}) {
  return (
    <Card
      title={title}
      size={size}
      bordered={bordered}
      style={{
        marginBottom: '16px'
      }}
    >
      {children}
    </Card>
  )
}

/**
 * Единый компонент для секций с фильтрами (горизонтальная компоновка)
 * @param {React.ReactNode} children - Содержимое секции
 * @param {string} title - Заголовок секции (опционально)
 */
export function FilterSection({ children, title }) {
  return (
    <PageSection title={title}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '16px',
        alignItems: 'end'
      }}>
        {children}
      </div>
    </PageSection>
  )
}
