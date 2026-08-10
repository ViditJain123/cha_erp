import type { Metadata } from 'next';
import { APP } from '@checklist/config/app';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: APP.name,
    template: `%s · ${APP.name}`,
  },
  description: APP.tagline,
};

/**
 * Root layout is deliberately bare. Each route group supplies its own chrome:
 * `(app)` the ERP sidebar, `(admin)` the platform console, `legacy/` the old
 * checklist nav, `(auth)` no chrome at all.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
