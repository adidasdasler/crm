import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4 text-center">
      <div><p className="text-6xl font-bold text-brand-600">404</p><p className="mt-2 text-slate-600">Страница не найдена</p><Link to="/" className="btn-primary mt-6">На главную</Link></div>
    </div>
  );
}
