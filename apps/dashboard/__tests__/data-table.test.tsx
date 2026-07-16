import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type ColumnDef } from '../components/ui/data-table';

interface Row {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
}

const columns: ColumnDef<Row, any>[] = [
  { accessorKey: 'name', header: '名称' },
  { accessorKey: 'status', header: '状态', enableSorting: false },
  { accessorKey: 'updatedAt', header: '更新时间' },
];

const data: Row[] = [
  { id: '1', name: '流程甲', status: 'draft', updatedAt: '2026-07-01' },
  { id: '2', name: '流程乙', status: 'published', updatedAt: '2026-07-03' },
  { id: '3', name: '回访丙', status: 'draft', updatedAt: '2026-07-02' },
];

function cellTexts(column: number): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelectorAll('td')[column]?.textContent ?? '');
}

describe('DataTable', () => {
  it('按 columnDef 渲染表头与数据行，走全局表格样式结构', () => {
    const { container } = render(
      <DataTable columns={columns} data={data} rowKey={(r) => r.id} />,
    );
    expect(container.querySelector('.table-wrap .table-scroll table')).toBeTruthy();
    expect(screen.getByText('名称')).toBeTruthy();
    expect(cellTexts(0)).toEqual(['流程甲', '流程乙', '回访丙']);
  });

  it('点击表头循环 升序→降序→还原，禁排序列不响应', () => {
    render(<DataTable columns={columns} data={data} rowKey={(r) => r.id} />);
    const nameHeader = screen.getByText('名称').closest('th')!;
    fireEvent.click(nameHeader);
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(cellTexts(0)).toEqual(['回访丙', '流程乙', '流程甲']);
    fireEvent.click(nameHeader);
    expect(nameHeader.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(nameHeader);
    expect(nameHeader.getAttribute('aria-sort')).toBeNull();

    const statusHeader = screen.getByText('状态').closest('th')!;
    fireEvent.click(statusHeader);
    expect(statusHeader.getAttribute('aria-sort')).toBeNull();
  });

  it('initialSorting 生效（更新时间倒序）', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        initialSorting={[{ id: 'updatedAt', desc: true }]}
      />,
    );
    expect(cellTexts(2)).toEqual(['2026-07-03', '2026-07-02', '2026-07-01']);
  });

  it('globalFilter 与 columnFilters 受控过滤，无结果显示空文案', () => {
    function Harness() {
      const [keyword, setKeyword] = useState('');
      return (
        <>
          <input aria-label="搜索" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <DataTable
            columns={columns}
            data={data}
            rowKey={(r) => r.id}
            globalFilter={keyword}
            emptyText="没有匹配的流程"
          />
        </>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '流程' } });
    expect(cellTexts(0)).toEqual(['流程甲', '流程乙']);
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的流程')).toBeTruthy();
  });

  it('columnFilters 受控列筛选', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        columnFilters={[{ id: 'status', value: 'draft' }]}
      />,
    );
    expect(cellTexts(0)).toEqual(['流程甲', '回访丙']);
  });

  it('onRowClick 返回原始行数据', () => {
    const clicked: Row[] = [];
    render(
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        onRowClick={(row) => clicked.push(row)}
      />,
    );
    fireEvent.click(screen.getByText('流程乙'));
    expect(clicked[0]?.id).toBe('2');
  });
});
