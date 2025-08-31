import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { clsx } from 'clsx';
import { useState } from 'react';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    initialState: {
      pagination: {
        pageSize: 18, // Smaller page size to ensure pagination is visible
      },
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
  });

  const isFullHeight = className?.includes('h-full');

  if (isFullHeight) {
    return (
      <div className="h-full flex flex-col">
        {/* Search Input - Fixed at top */}
        <div className="flex items-center mb-4 flex-shrink-0">
          <input
            placeholder="Search games..."
            value={globalFilter ?? ''}
            onChange={event => setGlobalFilter(String(event.target.value))}
            className="max-w-sm px-3 py-2 border border-amber-300 rounded-md bg-amber-50 text-amber-900 placeholder-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent"
          />
        </div>

        {/* Table - Scrollable middle section that grows with available space */}
        <div
          className="flex-1 rounded-lg border border-amber-300 shadow-sm overflow-hidden"
          style={{ minHeight: 0 }}
        >
          <div className="h-full overflow-y-auto overflow-x-auto" style={{ maxHeight: '100%' }}>
            <table className="w-full border-collapse bg-gradient-to-b from-amber-50 to-yellow-50">
              <thead className="bg-gradient-to-r from-amber-200 to-yellow-200 sticky top-0 z-10">
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => {
                      return (
                        <th
                          key={header.id}
                          className="px-4 py-3 text-left text-sm font-semibold text-amber-800"
                        >
                          {header.isPlaceholder ? null : (
                            <div
                              className={clsx(
                                'flex items-center space-x-2',
                                header.column.getCanSort() &&
                                  'cursor-pointer select-none hover:bg-amber-300/50 rounded px-2 py-1 -mx-2 -my-1'
                              )}
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getCanSort() && (
                                <span className="text-amber-600">
                                  {{
                                    asc: '↑',
                                    desc: '↓',
                                  }[header.column.getIsSorted() as string] ?? '↕'}
                                </span>
                              )}
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map(row => (
                    <tr
                      key={row.id}
                      data-state={row.getIsSelected() && 'selected'}
                      className="border-b border-amber-200 hover:bg-gradient-to-r hover:from-amber-100 hover:to-yellow-100 transition-colors duration-200"
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-4 py-3 text-sm text-amber-700">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length} className="h-24 text-center text-amber-600">
                      No results.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination - Fixed at bottom */}
        <div className="flex items-center justify-between space-x-2 py-4 flex-shrink-0 border-t border-amber-200 bg-amber-50/50">
          <div className="text-sm text-amber-600">
            {table.getFilteredSelectedRowModel().rows.length} of{' '}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-3 py-2 text-sm bg-amber-600 text-amber-50 rounded-md hover:bg-amber-700 disabled:bg-amber-300 disabled:text-amber-500 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-amber-700">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-3 py-2 text-sm bg-amber-600 text-amber-50 rounded-md hover:bg-amber-700 disabled:bg-amber-300 disabled:text-amber-500 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Default layout for non-full-height mode
  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="flex items-center">
        <input
          placeholder="Search games..."
          value={globalFilter ?? ''}
          onChange={event => setGlobalFilter(String(event.target.value))}
          className="max-w-sm px-3 py-2 border border-amber-300 rounded-md bg-amber-50 text-amber-900 placeholder-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-amber-300 shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-96">
          <table className="w-full border-collapse bg-gradient-to-b from-amber-50 to-yellow-50">
            <thead className="bg-gradient-to-r from-amber-200 to-yellow-200 sticky top-0">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => {
                    return (
                      <th
                        key={header.id}
                        className="px-4 py-3 text-left text-sm font-semibold text-amber-800"
                      >
                        {header.isPlaceholder ? null : (
                          <div
                            className={clsx(
                              'flex items-center space-x-2',
                              header.column.getCanSort() &&
                                'cursor-pointer select-none hover:bg-amber-300/50 rounded px-2 py-1 -mx-2 -my-1'
                            )}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              <span className="text-amber-600">
                                {{
                                  asc: '↑',
                                  desc: '↓',
                                }[header.column.getIsSorted() as string] ?? '↕'}
                              </span>
                            )}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map(row => (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    className="border-b border-amber-200 hover:bg-gradient-to-r hover:from-amber-100 hover:to-yellow-100 transition-colors duration-200"
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3 text-sm text-amber-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-24 text-center text-amber-600">
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between space-x-2 py-4">
        <div className="text-sm text-amber-600">
          {table.getFilteredSelectedRowModel().rows.length} of{' '}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="px-3 py-2 text-sm bg-amber-600 text-amber-50 rounded-md hover:bg-amber-700 disabled:bg-amber-300 disabled:text-amber-500 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-amber-700">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="px-3 py-2 text-sm bg-amber-600 text-amber-50 rounded-md hover:bg-amber-700 disabled:bg-amber-300 disabled:text-amber-500 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
