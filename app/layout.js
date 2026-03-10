// file: app/layout.js
import './globals.css';
import AppHeader from '@/components/AppHeader';

export const metadata = {
  title: '3DCADサイト',
  description: '3D CAD in browser',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>
        <div className="min-h-screen overflow-hidden bg-white">
          <AppHeader />
          <main className="px-4 py-4 overflow-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}