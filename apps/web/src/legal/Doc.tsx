import { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../Logo';
import { EDITION } from './requisites';

/** Каркас юридического документа: заголовок, редакция, оглавление по разделам */
export function Doc({ title, children, subtitle }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 leading-relaxed text-ink">
      <Link to="/" aria-label="На главную MioFlow" className="print:hidden"><Logo size={28} /></Link>
      <h1 className="display mt-4 text-3xl sm:text-4xl">{title}</h1>
      {subtitle && <div className="mt-2 text-ink-muted">{subtitle}</div>}
      <p className="mt-1 text-sm text-ink-muted print:hidden">Редакция от {EDITION}</p>
      <div className="mt-8 space-y-6 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_p]:mt-2">
        {children}
      </div>
      <nav className="mt-12 print:hidden flex flex-wrap gap-4 border-t pt-6 text-sm text-brand-600">
        <Link to="/terms">Оферта</Link>
        <Link to="/privacy">Политика обработки ПДн</Link>
        <Link to="/consent">Согласие на обработку ПДн</Link>
        <Link to="/cookies">Cookie</Link>
      </nav>
    </div>
  );
}
