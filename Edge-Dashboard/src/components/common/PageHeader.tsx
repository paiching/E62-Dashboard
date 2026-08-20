import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, action, className = '' }: PageHeaderProps) {
  return (
    <header className={`page-header ${className}`}>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
