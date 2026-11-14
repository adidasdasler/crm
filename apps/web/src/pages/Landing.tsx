import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Logo } from '../Logo';
import { api, APP_URL, rub } from '../lib/api';
import { OPERATOR } from '../legal/requisites';

type Plan = { code: string; name: string; priceMonthly: number; priceYearly: number; limits: { masters?: number } };

/** Линейные иконки (stroke 1.8) */
const I = {
  calendar: <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20a2 2 0 0 0 4 0" />,
  phone: <path d="M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2" />,
  users: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .8 3 2.8 3 6" />,
  shield: <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3ZM9 12l2 2 4-4" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  pin: <path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
  key: <path d="M14 10a4 4 0 1 0-3.5 3.97L9 15.5V18H6.5v2.5H4V18l6.03-6.03A4 4 0 0 0 14 10Zm1-1h.01" />,
  move: <path d="M4 7h11l-3-3M20 17H9l3 3" />,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  box: <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9ZM3.5 7.5 12 12l8.5-4.5M12 12v9" />,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />,
  wallet: <path d="M4 7a2 2 0 0 1 2-2h11v4M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2Zm12 7h.01" />,
};
const Svg = ({ d, size = 22 }: { d: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const Icon = ({ d, tone = 'brand' }: { d: ReactNode; tone?: 'brand' | 'blush' | 'dark' }) => (
  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tone === 'blush' ? 'bg-blush-300 text-ink' : tone === 'dark' ? 'bg-white/10 text-white' : 'bg-brand-50 text-brand-600'}`}>
    <Svg d={d} />
  </span>
);

const CHANNELS = ['Telegram', 'MAX', 'ВКонтакте', 'Email', 'Яндекс Карты', '2ГИС', 'iOS', 'Android', 'Веб-версия'];

const INDUSTRIES = [
  'Маникюр и педикюр', 'Парикмахерские', 'Барбершопы', 'Брови и ресницы', 'Косметология', 'Массаж и СПА', 'Тату-студии',
  'Фитнес и йога', 'Репетиторы и курсы', 'Груминг', 'Фотостудии', 'Автосервисы', 'Психологи и консультанты',
];

const FAQ = [
  { q: 'Почему без SMS?', a: 'SMS стоят 4–6 ₽ за штуку, и салоны платят за них сверх тарифа. MioFlow отправляет напоминания в Telegram, MAX, ВКонтакте и на email — это бесплатно и для вас, и для клиента, а кнопки «Подтвердить» и «Отменить» работают прямо в сообщении.' },
  { q: 'Как появиться в Яндекс Картах и 2ГИС?', a: 'В приложении есть раздел «Карты и ссылки»: готовая ссылка с меткой площадки, QR-код и пошаговая инструкция. Ссылку вставляете в кнопку «Записаться» карточки организации — клиенты попадают сразу на ваш мини-сайт с услугами и свободным временем.' },
  { q: 'Есть ли ограничения в тарифах?', a: 'Нет. Все функции доступны на любом тарифе: напоминания без лимитов, кабинет владельца, роли, мини-сайт, приложение. Тариф зависит только от числа мастеров.' },
  { q: 'Как перенести клиентов из другой программы?', a: 'Выгрузите базу в Excel или CSV и загрузите в MioFlow — клиенты с телефонами и заметками появятся за минуту. Если нужна помощь, перенесём сами бесплатно.' },
  { q: 'Кто видит данные клиентов?', a: 'Вы решаете сами в «Ролях и доступах»: например, мастер видит только свои записи, а телефоны клиентов можно скрыть. Данные хранятся на серверах в России, каждый салон изолирован на уровне базы данных.' },
  { q: 'Как платить? Есть автосписания?', a: 'Автосписаний нет. Перед окончанием периода приходит ссылка на оплату за месяц или год, чек — из «Мой налог». Не оплатили — данные сохраняются, доступ откроется после оплаты.' },
];

/** Экономия на SMS-напоминаниях: 2 SMS на визит */
const SMS_PRICE = 4.5;

export function Landing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [yearly, setYearly] = useState(false);
  const [visits, setVisits] = useState(400);
  useEffect(() => { api<Plan[]>('/billing/plans').then(setPlans).catch(() => setPlans([])); }, []);
  const saving = useMemo(() => Math.round(visits * 2 * SMS_PRICE), [visits]);
  const register = `${APP_URL}/register`;

  return (
    <div className="overflow-x-clip bg-white">
      {/* ─── Шапка ─── */}
      <header className="sticky top-0 z-30 border-b border-brand-50/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" aria-label="MioFlow — на главную"><Logo size={30} /></a>
          <nav className="hidden items-center gap-1 text-sm font-semibold text-ink-muted md:flex">
            <a href="#features" className="rounded-full px-3 py-2 hover:text-ink">Возможности</a>
            <a href="#maps" className="rounded-full px-3 py-2 hover:text-ink">Для карт</a>
            <a href="#prices" className="rounded-full px-3 py-2 hover:text-ink">Цены</a>
            <a href="#faq" className="rounded-full px-3 py-2 hover:text-ink">Вопросы</a>
          </nav>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <a href={APP_URL} className="rounded-full px-4 py-2 hover:bg-brand-50">Войти</a>
            <a href={register} className="hidden rounded-full bg-ink px-4 py-2 text-white hover:bg-brand-700 sm:inline-flex">Попробовать</a>
          </div>
        </div>
      </header>

      {/* ─── Первый экран ─── */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[680px] bg-[radial-gradient(60%_60%_at_80%_10%,#E6E8FF_0%,rgba(255,255,255,0)_70%),radial-gradient(40%_40%_at_10%_30%,#FFE3EB_0%,rgba(255,255,255,0)_70%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 md:grid-cols-[1.15fr_0.85fr] md:pb-24 md:pt-16">
          <div className="space-y-7">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-ink shadow-sm ring-1 ring-brand-100">
              <span className="h-2 w-2 rounded-full bg-[#19AA1E]" /> Напоминания в мессенджеры — бесплатно
            </span>
            <h1 className="display text-[2.6rem] leading-[1.04] sm:text-6xl md:text-[4.1rem]">
              Клиенты записываются сами. <span className="text-brand-600">И&nbsp;приходят.</span>
            </h1>
            <p className="max-w-xl text-lg text-ink-muted sm:text-xl">
              Запись из Яндекс Карт, 2ГИС и соцсетей — круглосуточно и без звонков. За день до визита клиент получает напоминание в Telegram, MAX или ВКонтакте, а вы видите все записи, мастеров и выручку в одном месте — с телефона и компьютера.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a href={register} className="btn-primary whitespace-nowrap px-7 py-4 text-lg shadow-[0_12px_30px_-10px_rgba(47,59,255,.7)]">Попробовать 14 дней бесплатно</a>
              <a href={`${APP_URL}/login?demo=1`} className="btn-ghost whitespace-nowrap px-7 py-4 text-lg">Посмотреть демо</a>
            </div>
            <p className="text-ink-muted">
              Работаете одна? <a href={`${register}?kind=solo`} className="font-semibold text-brand-600 underline underline-offset-4">Тариф «Соло» — 290 ₽ в месяц</a>
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
              {['Без карты и автосписаний', 'Все функции в любом тарифе', 'Перенос из YCLIENTS и DIKIDI за 5 минут', 'Без SMS-расходов'].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><span className="text-brand-600"><Svg d={I.check} size={16} /></span>{t}</li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* ─── Каналы ─── */}
      <section className="border-y border-brand-50 bg-paper/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm font-semibold text-ink-muted sm:px-6">
          <span className="text-ink">Работает с:</span>
          {CHANNELS.map((c) => <span key={c}>{c}</span>)}
        </div>
      </section>

      {/* ─── Как работает ─── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="display max-w-3xl text-4xl md:text-5xl">Запуск за вечер — без обучения и внедренцев</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { n: '1', t: 'Выберите сферу', d: 'Добавим типовые услуги с ценами для маникюра, барбершопа, массажа, фитнеса и ещё десятка сфер. Поправьте под себя.' },
            { n: '2', t: 'Поставьте ссылку', d: 'В Яндекс Карты, 2ГИС, ВКонтакте, Telegram и на QR у стойки. Мини-сайт с услугами и свободным временем готов сразу.' },
            { n: '3', t: 'Принимайте записи', d: 'Клиент записывается за минуту и сам подтверждает визит кнопкой в мессенджере. Вы видите всё в приложении.' },
          ].map((s) => (
            <div key={s.n} className="rounded-3xl bg-paper p-7">
              <span className="display text-6xl text-brand-200">{s.n}</span>
              <h3 className="mt-2 text-xl font-semibold">{s.t}</h3>
              <p className="mt-2 text-ink-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Возможности (бенто) ─── */}
      <section id="features" className="scroll-mt-20 bg-ink py-20 text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.1em] text-blush-300">Возможности</p>
          <h2 className="display mt-3 max-w-3xl text-4xl md:text-5xl">Всё для записи и роста — в одном приложении</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-6">
            <Tile className="md:col-span-4" icon={I.bell} title="Напоминания, на которые отвечают"
              text="За сутки и за 2 часа — в Telegram, MAX или ВКонтакте с кнопками «Подтвердить» и «Отменить». Нет мессенджера — письмо на email. Освободившееся время сразу открыто для записи.">
              <div className="mt-5 flex flex-wrap gap-2 text-sm">
                {['Telegram', 'MAX', 'ВКонтакте', 'Email'].map((c) => <span key={c} className="rounded-full bg-white/10 px-3 py-1">{c}</span>)}
                <span className="rounded-full bg-blush-300 px-3 py-1 font-semibold text-ink">0 ₽ за сообщение</span>
              </div>
            </Tile>
            <Tile className="md:col-span-2" icon={I.chart} title="Кабинет владельца" text="Выручка, средний чек, загрузка каждого мастера, неявки и откуда приходят клиенты.">
              <MiniChart />
            </Tile>
            <Tile className="md:col-span-2" icon={I.key} title="Роли и доступы" text="Владелец, управляющий, администратор, мастер. Включайте права переключателями: кто видит все записи, телефоны клиентов, отчёты." />
            <Tile className="md:col-span-2" icon={I.phone} title="iOS, Android и веб" text="Одно приложение для владельца и мастеров. На компьютере — веб-версия с боковым меню." />
            <Tile className="md:col-span-2" icon={I.shield} title="Данные под защитой" text="Серверы в России, шифрование, изоляция данных каждого салона, журнал действий. Документы по 152-ФЗ готовы." />
            <Tile className="md:col-span-3" icon={I.users} title="База клиентов" text="История визитов, заметки, метки, сумма покупок. Импорт из Excel и выгрузка в один клик." />
            <Tile className="md:col-span-3" icon={I.calendar} title="Запись без накладок" text="Несколько услуг в визите, перерыв после процедуры, «любой мастер». Двойная запись невозможна технически — даже если двое нажмут одновременно." />
            <Tile className="md:col-span-2" icon={I.box} title="Склад материалов" text="Расходники списываются сами после визита. Приложение предупредит, когда материал заканчивается или подходит срок годности." />
            <Tile className="md:col-span-2" icon={I.wallet} title="Депозиты и абонементы" text="Клиент вносит деньги вперёд и получает бонус, абонемент считает визиты сам. Оплату принимаете вы — сервис ведёт учёт." />
            <Tile className="md:col-span-2" icon={I.star} title="Оценки и советы" text="После визита клиент ставит оценку. Раз в неделю приходит сводка: что выросло, где теряете деньги и что с этим сделать." />
          </div>
        </div>
      </section>

      {/* ─── Карты ─── */}
      <section id="maps" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-4 py-20 sm:px-6 md:grid-cols-2">
        <div className="space-y-5">
          <Icon d={I.pin} tone="blush" />
          <h2 className="display text-4xl md:text-5xl">Кнопка «Записаться» в Яндекс Картах и 2ГИС</h2>
          <p className="text-lg text-ink-muted">
            Каждый салон получает мини-сайт: услуги с ценами, мастера, часы работы, адрес и свободное время. Ставите ссылку в карточку организации — и клиент с карты записывается в два касания, не звоня.
          </p>
          <ul className="space-y-3">
            {['Пошаговая инструкция и ссылки прямо в приложении', 'Поисковики видят цены, адрес и часы работы (разметка schema.org)', 'QR-код для стойки, визиток и зеркал', 'В отчёте видно, сколько клиентов пришло с каждой площадки'].map((t) => (
              <li key={t} className="flex gap-3"><span className="mt-0.5 text-brand-600"><Svg d={I.check} /></span><span>{t}</span></li>
            ))}
          </ul>
        </div>
        <MapsVisual />
      </section>

      {/* ─── Калькулятор экономии ─── */}
      <section className="bg-paper py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 md:grid-cols-2">
          <div>
            <h2 className="display text-4xl md:text-5xl">Сколько вы сэкономите на SMS</h2>
            <p className="mt-4 text-lg text-ink-muted">Обычно салон платит за два SMS на каждый визит — около {SMS_PRICE.toLocaleString('ru-RU')} ₽ за штуку сверх тарифа. В MioFlow напоминания бесплатны.</p>
          </div>
          <div className="card space-y-6 p-7 shadow-[0_30px_60px_-30px_rgba(14,15,43,.25)]">
            <label className="block">
              <span className="flex items-baseline justify-between font-semibold">Визитов в месяц <span className="display text-3xl tabular-nums text-brand-600">{visits}</span></span>
              <input type="range" min={50} max={2000} step={50} value={visits} onChange={(e) => setVisits(+e.target.value)} className="mt-4 w-full accent-brand-600" aria-label="Визитов в месяц" />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-paper p-4">
                <p className="text-sm text-ink-muted">SMS-напоминания</p>
                <p className="text-2xl font-bold tabular-nums">{saving.toLocaleString('ru-RU')} ₽<span className="text-sm font-normal text-ink-muted">/мес</span></p>
              </div>
              <div className="rounded-2xl bg-brand-600 p-4 text-white">
                <p className="text-sm text-brand-100">MioFlow</p>
                <p className="text-2xl font-bold">0 ₽</p>
              </div>
            </div>
            <p className="text-ink-muted">Экономия за год: <b className="text-ink">{(saving * 12).toLocaleString('ru-RU')} ₽</b></p>
          </div>
        </div>
      </section>

      {/* ─── Сферы ─── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="display max-w-3xl text-4xl md:text-5xl">Не только салоны красоты</h2>
        <p className="mt-4 max-w-2xl text-lg text-ink-muted">Везде, где клиент записывается к специалисту на время. Приложение говорит на языке вашей сферы: «мастер», «тренер», «преподаватель».</p>
        <div className="mt-8 flex flex-wrap gap-2">
          {INDUSTRIES.map((x) => <span key={x} className="rounded-full bg-paper px-4 py-2 font-semibold ring-1 ring-brand-50">{x}</span>)}
        </div>
      </section>

      {/* ─── Цены ─── */}
      {plans.length > 0 && (
        <section id="prices" className="scroll-mt-20 bg-paper py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="display text-4xl md:text-5xl">Честные цены</h2>
                <p className="mt-3 max-w-xl text-lg text-ink-muted">Все функции в любом тарифе — платите только за число мастеров. 14 дней бесплатно, оплата по ссылке, чек из «Мой налог».</p>
              </div>
              <div className="inline-flex w-fit rounded-full bg-white p-1 ring-1 ring-brand-100" role="tablist" aria-label="Период оплаты">
                {[false, true].map((y) => (
                  <button key={String(y)} role="tab" aria-selected={yearly === y} onClick={() => setYearly(y)} className={`rounded-full px-5 py-2 text-sm font-semibold transition ${yearly === y ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'}`}>
                    {y ? 'За год −20%' : 'Помесячно'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((p) => {
                const featured = p.code === 'START';
                const monthly = yearly ? Math.round(p.priceYearly / 12) : p.priceMonthly;
                return (
                  <div key={p.code} className={`relative flex flex-col gap-5 rounded-3xl p-7 ${featured ? 'bg-brand-600 text-white shadow-[0_30px_60px_-25px_rgba(47,59,255,.8)]' : 'bg-white ring-1 ring-brand-50'}`}>
                    {featured && <span className="absolute -top-3 left-7 rounded-full bg-blush-300 px-3 py-1 text-xs font-semibold text-ink">Чаще выбирают</span>}
                    <div>
                      <h3 className="display text-3xl">{p.name}</h3>
                      <p className={`mt-1 text-sm ${featured ? 'text-brand-100' : 'text-ink-muted'}`}>{p.limits.masters === 1 ? 'Частный мастер' : `До ${p.limits.masters} мастеров`}</p>
                    </div>
                    <div>
                      <p className="text-4xl font-bold tabular-nums">{rub(monthly)}<span className={`text-base font-normal ${featured ? 'text-brand-100' : 'text-ink-muted'}`}> / мес</span></p>
                      <p className={`mt-1 h-5 text-sm ${featured ? 'text-brand-100' : 'text-ink-muted'}`}>{yearly ? `${rub(p.priceYearly)} за год` : ''}</p>
                    </div>
                    <ul className={`space-y-2 text-sm ${featured ? 'text-brand-50' : 'text-ink-muted'}`}>
                      {['Онлайн-запись и мини-сайт', 'Напоминания без лимитов', 'Кабинет владельца и роли', 'Приложение iOS, Android, веб'].map((t) => (
                        <li key={t} className="flex gap-2"><Svg d={I.check} size={18} />{t}</li>
                      ))}
                    </ul>
                    <a href={`${register}?kind=${p.code === 'SOLO' ? 'solo' : 'salon'}`} className={`btn mt-auto ${featured ? 'bg-white text-brand-700 hover:bg-brand-50' : 'bg-ink text-white hover:bg-brand-700'}`}>Начать бесплатно</a>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex items-center gap-4 rounded-3xl bg-white p-5 ring-1 ring-brand-50">
              <Icon d={I.move} />
              <p><b>Переезжаете из другой программы?</b> <span className="text-ink-muted">Перенесём клиентов и услуги бесплатно.</span></p>
            </div>
          </div>
        </section>
      )}

      {/* ─── Вопросы ─── */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
        <h2 className="display text-4xl md:text-5xl">Частые вопросы</h2>
        <div className="mt-8 divide-y divide-brand-100 rounded-3xl bg-paper px-6">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-xl text-brand-600 transition group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-3 text-ink-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ─── Финальный призыв ─── */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-brand-600 px-6 py-14 text-center text-white sm:px-12">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-blush-300/40 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <h2 className="display relative mx-auto max-w-2xl text-4xl md:text-5xl">Первые онлайн-записи — уже сегодня</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg text-brand-100">14 дней бесплатно, без карты. Настроите за вечер, а клиенты начнут записываться сами.</p>
          <a href={register} className="btn relative mt-8 bg-white px-8 py-4 text-lg text-brand-700 hover:bg-brand-50">Создать салон бесплатно</a>
        </div>
      </section>

      <footer className="border-t border-brand-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo size={26} />
          <span className="flex flex-wrap gap-5">
            <a href="/my" className="font-semibold text-brand-600 hover:text-ink">Мои записи (для клиентов)</a>
            <a href="/terms" className="hover:text-ink">Оферта</a>
            <a href="/privacy" className="hover:text-ink">Политика ПДн</a>
            <a href="/consent" className="hover:text-ink">Согласие на обработку ПДн</a>
            <span>© {new Date().getFullYear()} MioFlow</span>
          </span>
        </div>
        {/* Сведения об исполнителе — требование закона о защите прав потребителей (продажа услуг через сайт) */}
        {!OPERATOR.fullName.startsWith('[') && (
          <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-muted sm:px-6">
            Исполнитель: {OPERATOR.fullName}, плательщик налога на профессиональный доход, ИНН {OPERATOR.inn}. Обращения: {OPERATOR.email}.
            Сайт использует только технически необходимые cookie.
          </p>
        )}
      </footer>
    </div>
  );
}

function Tile({ icon, title, text, className = '', children }: { icon: ReactNode; title: string; text: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`rounded-3xl bg-white/[0.06] p-7 ring-1 ring-white/10 ${className}`}>
      <Icon d={icon} tone="dark" />
      <h3 className="mt-4 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-[#C9CCF2]">{text}</p>
      {children}
    </div>
  );
}

function MiniChart() {
  const bars = [38, 52, 44, 70, 58, 86, 74];
  return (
    <div className="mt-5 flex h-20 items-end gap-1.5" aria-hidden="true">
      {bars.map((h, i) => <div key={i} className={`flex-1 rounded-md ${i === 5 ? 'bg-blush-300' : 'bg-brand-500/70'}`} style={{ height: `${h}%` }} />)}
    </div>
  );
}

/** Композиция: напоминание в мессенджере + карточка кабинета + запись с карт */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md pb-6 pt-4 md:pb-0" aria-hidden="true">
      <div className="absolute -right-4 top-0 h-48 w-48 rounded-full bg-blush-300/80" />
      <div className="relative mx-auto w-[290px] rounded-[2.75rem] bg-ink p-2.5 shadow-[0_40px_80px_-25px_rgba(47,59,255,.55)]">
        <div className="rounded-[2.25rem] bg-[#DDE3F7] p-4">
          <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-blush-300 font-display text-ink">Л</span>
            <div><p className="text-sm font-semibold">Студия «Лаванда»</p><p className="text-xs text-ink-muted">напоминание</p></div>
          </div>
          <div className="space-y-2.5">
            <div className="max-w-[90%] rounded-3xl rounded-bl-md bg-white p-3.5">
              <p className="text-sm font-semibold">Пора к мастеру: завтра в 14:00</p>
              <p className="mt-1 text-xs text-ink-muted">Маникюр с покрытием · Анна<br />Студия «Лаванда», ул. Примерная, 1</p>
            </div>
            <div className="grid max-w-[90%] grid-cols-2 gap-2 text-center text-xs font-semibold text-brand-600">
              <span className="rounded-xl bg-white/80 py-2">Подтвердить</span>
              <span className="rounded-xl bg-white/80 py-2">Отменить</span>
            </div>
            <div className="ml-auto w-fit rounded-3xl rounded-br-md bg-brand-600 px-3.5 py-2 text-xs text-white">Приду ✓</div>
            <div className="max-w-[90%] rounded-3xl rounded-bl-md bg-white p-3 text-xs">Спасибо! Ждём вас завтра в 14:00.</div>
          </div>
        </div>
      </div>
      <div className="absolute -left-2 -top-2 hidden w-48 rounded-2xl bg-white p-3.5 shadow-xl ring-1 ring-brand-50 sm:block md:-left-16">
        <p className="text-xs text-ink-muted">Выручка за месяц</p>
        <p className="text-xl font-bold">412 600 ₽</p>
        <p className="mt-1 inline-block whitespace-nowrap rounded-full bg-[#E6F6EC] px-2 py-0.5 text-xs font-semibold text-[#0F7A52]">▲ 18% к прошлому месяцу</p>
      </div>
      <div className="absolute -right-2 -bottom-8 hidden w-56 items-center gap-3 rounded-2xl bg-white p-3.5 shadow-xl ring-1 ring-brand-50 sm:flex md:-right-14">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FC3F1D] text-white"><Svg d={I.pin} size={18} /></span>
        <div><p className="text-xs text-ink-muted">Новая запись</p><p className="text-sm font-semibold">из Яндекс Карт · 16:30</p></div>
      </div>
    </div>
  );
}

function MapsVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
      <div className="overflow-hidden rounded-[2rem] bg-[#EEF1E7] ring-1 ring-brand-50">
        <div className="relative h-56 bg-[linear-gradient(90deg,rgba(255,255,255,.75)_2px,transparent_2px),linear-gradient(rgba(255,255,255,.75)_2px,transparent_2px)] bg-[size:48px_48px]">
          <div className="absolute left-[14%] top-[12%] h-24 w-40 rounded-3xl bg-[#DCE8D0]" />
          <div className="absolute bottom-[12%] right-[10%] h-16 w-28 rounded-2xl bg-[#D5E4F5]" />
          <span className="absolute left-1/2 top-[38%] grid h-12 w-12 -translate-x-1/2 -rotate-45 place-items-center rounded-full rounded-bl-none bg-[#FC3F1D] text-white shadow-lg">
            <span className="rotate-45"><Svg d={I.pin} size={20} /></span>
          </span>
        </div>
        <div className="space-y-3 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">Студия «Лаванда»</p>
              <p className="text-sm text-ink-muted">Ногтевая студия · ул. Примерная, 1</p>
              <p className="text-sm"><span className="font-semibold text-[#0F7A52]">Открыто</span> <span className="text-ink-muted">до 20:00</span></p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm font-semibold">
            <span className="col-span-2 rounded-xl bg-brand-600 py-2.5 text-white">Записаться</span>
            <span className="rounded-xl bg-paper py-2.5">Маршрут</span>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 right-2 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-xl sm:-right-3">→ mioflow.ru/b/lavanda</div>
    </div>
  );
}
