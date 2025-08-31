import React, { type ReactNode } from 'react';
import { clsx } from 'clsx';

interface TableProps {
  children: ReactNode;
  className?: string;
}

interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
}

interface TableHeadProps {
  children: ReactNode;
  className?: string;
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
}

export const Table: React.FC<TableProps> = ({ children, className }) => (
  <div className={clsx('overflow-auto rounded-lg border border-border shadow-sm', className)}>
    <table className="w-full border-collapse bg-card">{children}</table>
  </div>
);

export const TableHeader: React.FC<TableHeaderProps> = ({ children, className }) => (
  <thead className={clsx('bg-muted', className)}>{children}</thead>
);

export const TableBody: React.FC<TableBodyProps> = ({ children, className }) => (
  <tbody className={clsx(className)}>{children}</tbody>
);

export const TableRow: React.FC<TableRowProps> = ({ children, className }) => (
  <tr
    className={clsx(
      'border-b border-border hover:bg-muted/50 transition-colors duration-200',
      className
    )}
  >
    {children}
  </tr>
);

export const TableHead: React.FC<TableHeadProps> = ({ children, className }) => (
  <th className={clsx('px-4 py-3 text-left text-sm font-semibold text-foreground', className)}>
    {children}
  </th>
);

export const TableCell: React.FC<TableCellProps> = ({ children, className }) => (
  <td className={clsx('px-4 py-3 text-sm text-foreground', className)}>{children}</td>
);
