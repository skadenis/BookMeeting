import React from 'react'
import { Row, Col, Card, Statistic } from 'antd'

/**
 * Единый компонент для отображения статистики на страницах админки
 * @param {Array} stats - Массив объектов статистики
 * Каждый объект должен содержать: { title, value, color?, suffix?, prefix? }
 */
export default function StatsSection({ stats }) {
  return (
    <Row gutter={16} style={{ marginBottom: '24px' }}>
      {stats.map((stat, index) => (
        <Col key={index} span={Math.floor(24 / stats.length)}>
          <Card size="small">
            <Statistic
              title={stat.title}
              value={stat.value}
              valueStyle={{
                color: stat.color || '#1677ff'
              }}
              suffix={stat.suffix}
              prefix={stat.prefix}
            />
          </Card>
        </Col>
      ))}
    </Row>
  )
}
