import React from 'react'
import { Table } from 'antd'

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
  scroll = { x: 'max-content' },
  rowKey = 'id',
  size = 'small',
  ...props
}) {
  return (
    <Table
      columns={columns}
      dataSource={dataSource}
      rowKey={rowKey}
      loading={loading}
      pagination={pagination}
      onChange={onChange}
      scroll={scroll}
      size={size}
      bordered={bordered}
      style={{
        background: '#fff',
        borderRadius: '6px'
      }}
      {...props}
    />
  )
}
