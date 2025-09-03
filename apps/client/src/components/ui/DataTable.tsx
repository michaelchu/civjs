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
        {/* Table - Scrollable section that grows with available space */}
        <div className="flex-1 rounded-lg border border-border shadow-sm overflow-hidden min-h-0">
          <div className="h-full max-h-[50vh] md:max-h-[60vh] overflow-y-auto overflow-x-auto">
            <table className="w-full border-collapse bg-card">
              <thead className="bg-muted sticky top-0 z-10">
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => {
                      return (
                        <th
                          key={header.id}
                          className="px-4 py-3 text-left text-sm font-semibold text-foreground"
                        >
                          {header.isPlaceholder ? null : (
                            <div
                              className={clsx(
                                'flex items-center space-x-2',
                                header.column.getCanSort() &&
                                  'cursor-pointer select-none hover:bg-muted rounded px-2 py-1 -mx-2 -my-1'
                              )}
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getCanSort() && (
                                <span className="text-muted-foreground">
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
                      className="border-b border-border hover:bg-muted/50 transition-colors duration-200"
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-4 py-3 text-sm text-foreground">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                      No results.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Default layout for non-full-height mode
  return (
    <div>
      {/* Table */}
      <div className="rounded-lg border border-border shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-96">
          <table className="w-full border-collapse bg-card">
            <thead className="bg-muted sticky top-0">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => {
                    return (
                      <th
                        key={header.id}
                        className="px-4 py-3 text-left text-sm font-semibold text-foreground"
                      >
                        {header.isPlaceholder ? null : (
                          <div
                            className={clsx(
                              'flex items-center space-x-2',
                              header.column.getCanSort() &&
                                'cursor-pointer select-none hover:bg-muted rounded px-2 py-1 -mx-2 -my-1'
                            )}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              <span className="text-muted-foreground">
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
                    className="border-b border-border hover:bg-muted/50 transition-colors duration-200"
                  >
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3 text-sm text-foreground">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-24 text-center text-muted-foreground">
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
        <div className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{' '}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
