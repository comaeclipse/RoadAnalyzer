'use client';

import { Navigation } from './Navigation';

interface PageLayoutProps {
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '7xl' | 'full';
  padding?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '7xl': 'max-w-7xl',
  full: 'max-w-full',
};

export function PageLayout({ children, maxWidth = '7xl', padding = true }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      <main className={`mx-auto ${maxWidthClasses[maxWidth]} ${padding ? 'p-4 sm:p-6' : ''}`}>
        {children}
      </main>
    </div>
  );
}

