import React from 'react'
import { Table, Card } from 'antd'

/**
 * Единый компонент для таблиц на страницах админки
 * @param {Array} columns - Колонки таблицы
 * @param {Array} dataSource - Данные таблицы
 * @param {boolean} loading - Состояние загрузки
 * @param {Object} pagination - Настройки пагинации
 * @param {function} onChange - Обработчик изменения таблицы
 * @param {boolean} bordered - Показывать рамку карточки
 * @param {Object} scroll - Настройки скролла
 */
export default function PageTable({
  columns,
  dataSource,
  loading = false,
  pagination = false,
  onChange,
  bordered = false,
  scroll = { x: 800 },
  rowKey = 'id',
  ...props
}) {
  return (
    <Card bordered={bordered}>
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey={rowKey}
        loading={loading}
        pagination={pagination}
        onChange={onChange}
        scroll={scroll}
        {...props}
      />
    </Card>
  )
}
