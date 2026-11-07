import { useEffect, useState } from 'react';
import { api, APP_URL, rub } from '../lib/api';

type Plan = { code: string; name: string; priceMonthly: number; limits: { masters?: number; smsPerMonth?: number } };

const FEATURES = [
  { icon: '📅', title: 'Онлайн-запись 24/7', text: 'Своя страница записи для салона. Клиент выбирает услугу, мастера и время за минуту.' },
  { icon: '🔔', title: 'Меньше неявок', text: 'Напоминания за сутки и за 2 часа с кнопками «Подтвердить» и «Отменить».' },
  { icon: '📱', title: 'Приложение для iOS и Android', text: 'Календарь, клиенты и записи — в телефоне у владельца и каждого мастера.' },
  { icon: '👥', title: 'База клиентов', text: 'История визитов, заметки, сумма покупок. Импорт из другой CRM за пару минут.' },
  { icon: '🔒', title: 'Данные под защитой', text: 'Серверы в России, шифрование, изоляция данных каждого салона.' },
  { icon: '⚡', title: 'Старт за 10 минут', text: 'Готовые шаблоны услуг для маникюра, парикмахерской, бровей и барбершопа.' },
];

export function Landing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => { api<Plan[]>('/billing/plans').then(setPlans).catch(() => setPlans([])); }, []);

  return (
    <div>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="text-xl font-bold text-brand-700">✦ Salon</span>
        <a href={APP_URL} className="text-sm font-semibold text-slate-700 hover:text-brand-700">Войти</a>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 text-center md:pt-20">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight md:text-6xl">Онлайн-запись и CRM для салона красоты</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">Клиенты записываются сами, получают напоминания и реже пропускают визиты. Вы видите всё расписание в телефоне.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a href={`${APP_URL}/register`} className="btn-primary text-lg">Попробовать 14 дней бесплатно</a>
          <a href="/b/demo" className="btn-ghost text-lg">Посмотреть пример записи</a>
        </div>
        <p className="mt-3 text-sm text-slate-500">Без карты. Отменить можно в любой момент.</p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-6">
            <div className="text-3xl">{f.icon}</div>
            <h3 className="mt-3 text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-slate-600">{f.text}</p>
          </div>
        ))}
      </section>

      {plans.length > 0 && (
        <section className="bg-white py-20">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-center text-3xl font-bold">Тарифы</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {plans.map((p, i) => (
                <div key={p.code} className={`card p-6 ${i === 1 ? 'ring-2 ring-brand-500' : ''}`}>
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <p className="mt-3 text-4xl font-bold">{rub(p.priceMonthly)}<span className="text-base font-normal text-slate-500"> / мес</span></p>
                  <ul className="mt-6 space-y-2 text-slate-600">
                    <li>✓ До {p.limits.masters} мастеров</li>
                    <li>✓ Онлайн-запись и приложение</li>
                    <li>✓ Напоминания в Telegram</li>
                    <li>✓ {p.limits.smsPerMonth} SMS в месяц</li>
                  </ul>
                  <a href={`${APP_URL}/register`} className={`${i === 1 ? 'btn-primary' : 'btn-ghost'} mt-6 w-full`}>Начать бесплатно</a>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-sm text-slate-500 sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} Salon</span>
        <span className="flex gap-4"><a href="/privacy">Политика ПДн</a><a href="/terms">Оферта</a></span>
      </footer>
    </div>
  );
}
