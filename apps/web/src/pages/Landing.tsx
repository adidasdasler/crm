import { ReactNode, useEffect, useState } from 'react';
import { Logo, Mark } from '../Logo';
import { api, APP_URL, rub } from '../lib/api';

type Plan = { code: string; name: string; priceMonthly: number; priceYearly: number; limits: { masters?: number; smsPerMonth?: number } };

/** Простые линейные иконки (stroke) — вместо эмодзи */
const I = {
  calendar: <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20a2 2 0 0 0 4 0" />,
  phone: <path d="M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2" />,
  users: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .8 3 2.8 3 6" />,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3ZM9 12l2 2 4-4" />,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />,
};
const Icon = ({ d }: { d: ReactNode }) => (
  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-600">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
  </span>
);

const FEATURES = [
  { icon: I.bell, title: 'Напоминания, которые работают', text: 'За сутки и за 2 часа — в Telegram с кнопками «Подтвердить» и «Отменить» или по SMS. Неявок меньше.' },
  { icon: I.calendar, title: 'Онлайн-запись 24/7', text: 'Своя страница записи для салона. Клиент выбирает услугу, мастера и время за минуту — без звонков.' },
  { icon: I.phone, title: 'Приложение для iOS и Android', text: 'Календарь, клиенты и записи — в телефоне у владельца и каждого мастера. Мастер видит только свои записи.' },
  { icon: I.users, title: 'База клиентов', text: 'История визитов, заметки, сумма покупок. Импорт из другой CRM и выгрузка в Excel.' },
  { icon: I.shield, title: 'Данные в России', text: 'Серверы в РФ, шифрование, изоляция данных каждого салона. Документы по 152-ФЗ готовы.' },
  { icon: I.bolt, title: 'Старт за 10 минут', text: 'Шаблоны услуг для маникюра, парикмахерской, бровей и барбершопа. Без обучения.' },
];

export function Landing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => { api<Plan[]>('/billing/plans').then(setPlans).catch(() => setPlans([])); }, []);

  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo size={34} />
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <a href="#prices" className="hidden rounded-full px-4 py-2 text-ink-muted hover:text-ink sm:inline">Тарифы</a>
          <a href={APP_URL} className="rounded-full px-4 py-2 ring-1 ring-brand-100 hover:bg-brand-50">Войти</a>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-8 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:pt-16">
        <div className="space-y-7">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-brand-600">Для салонов красоты и частных мастеров</p>
          <h1 className="display max-w-xl text-5xl leading-[1.05] md:text-6xl">Клиенты записываются сами и приходят вовремя</h1>
          <p className="max-w-xl text-lg text-ink-muted">Онлайн-запись, календарь мастеров и напоминания клиентам в Telegram и по SMS. Вы занимаетесь клиентами — MioFlow следит за расписанием.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a href={`${APP_URL}/register`} className="btn-primary px-7 py-4 text-lg">Попробовать 14 дней бесплатно</a>
            <a href="/b/demo" className="btn-ghost px-7 py-4 text-lg">Записаться как клиент</a>
          </div>
          <p className="text-sm text-ink-muted">Без карты и без автосписаний.</p>
        </div>

        {/* Главный момент продукта — напоминание клиенту */}
        <div className="relative mx-auto w-full max-w-sm" aria-hidden="true">
          <div className="absolute -right-6 -top-6 h-40 w-40 rounded-full bg-blush-300" />
          <div className="relative rounded-[2.5rem] bg-[#DDE3F7] p-5 shadow-[0_30px_60px_-20px_rgba(47,59,255,.35)] ring-8 ring-ink">
            <div className="mb-6 flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
              <Mark size={36} />
              <div><p className="font-semibold">MioFlow · напоминания</p><p className="text-xs text-ink-muted">бот</p></div>
            </div>
            <div className="space-y-3">
              <div className="max-w-[85%] rounded-3xl rounded-bl-md bg-white p-4">
                <p className="font-semibold">Пора к мастеру: завтра в 14:00</p>
                <p className="mt-1 text-sm text-ink-muted">Маникюр с покрытием · Анна<br />Студия «Лаванда», ул. Примерная, 1</p>
              </div>
              <div className="grid max-w-[85%] grid-cols-2 gap-2 text-center text-sm font-semibold text-brand-600">
                <span className="rounded-xl bg-white/80 py-2">Подтвердить</span>
                <span className="rounded-xl bg-white/80 py-2">Отменить</span>
              </div>
              <div className="ml-auto w-fit rounded-3xl rounded-br-md bg-brand-600 px-4 py-2 text-sm text-white">Подтвердить</div>
              <div className="max-w-[85%] rounded-3xl rounded-bl-md bg-white p-4 text-sm">Спасибо! Ждём вас завтра в 14:00.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-paper py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="display max-w-2xl text-4xl md:text-5xl">Всё, что нужно салону, — без лишнего</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card space-y-3 p-6">
                <Icon d={f.icon} />
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="text-ink-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {plans.length > 0 && (
        <section id="prices" className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="display text-4xl md:text-5xl">Тарифы</h2>
            <p className="mt-3 text-ink-muted">14 дней бесплатно на любом тарифе. Оплата по ссылке за месяц или год, чек из «Мой налог».</p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {plans.map((p, i) => {
                const featured = i === 1;
                return (
                  <div key={p.code} className={`flex flex-col gap-5 rounded-3xl p-7 ${featured ? 'bg-brand-600 text-white' : 'bg-paper'}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="display text-3xl">{p.name}</h3>
                      {featured && <span className="rounded-full bg-blush-300 px-3 py-1 text-xs font-semibold text-ink">Чаще выбирают</span>}
                    </div>
                    <p className="text-4xl font-bold tabular-nums">{rub(p.priceMonthly)}<span className={`text-base font-normal ${featured ? 'text-brand-100' : 'text-ink-muted'}`}> / мес</span></p>
                    <ul className={`space-y-2 ${featured ? 'text-brand-50' : 'text-ink-muted'}`}>
                      <li>До {p.limits.masters} мастеров</li>
                      <li>Онлайн-запись и приложение</li>
                      <li>Напоминания в Telegram без ограничений</li>
                      <li>{p.limits.smsPerMonth} SMS в месяц</li>
                    </ul>
                    <a href={`${APP_URL}/register`} className={`btn mt-auto ${featured ? 'bg-white text-brand-700 hover:bg-brand-50' : 'bg-brand-600 text-white hover:bg-brand-700'}`}>Начать бесплатно</a>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <footer className="border-t border-brand-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo size={26} />
          <span className="flex flex-wrap gap-5">
            <a href="/terms" className="hover:text-ink">Оферта</a>
            <a href="/privacy" className="hover:text-ink">Политика ПДн</a>
            <span>© {new Date().getFullYear()} MioFlow</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
