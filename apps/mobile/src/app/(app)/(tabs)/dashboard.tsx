import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ComponentProps, ReactNode, useState } from 'react';
import { LayoutAnimation, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { F, Text } from '../../../components/Text';
import { C, Card, Chip, ErrorText, Loading, Muted, webMax } from '../../../components/ui';
import { get } from '../../../lib/api';
import { useMe } from '../../../lib/auth';
import { addDays, minutes, rub, time, today } from '../../../lib/format';
import type { Analytics, Insight, Today } from '../../../lib/types';

const PERIODS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '3 месяца' },
];
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Кабинет владельца: деньги, загрузка, откуда клиенты. Доступ — право analytics.view. */
export default function Dashboard() {
  const me = useMe();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [days, setDays] = useState(30);
  const to = today(me.tenant.timezone);
  const from = addDays(to, -(days - 1));
  const q = useQuery({ queryKey: ['analytics', from, to], queryFn: () => get<Analytics>(`/analytics/summary?from=${from}&to=${to}`) });
  const ins = useQuery({ queryKey: ['analytics', 'insights'], queryFn: () => get<Insight[]>('/analytics/insights'), staleTime: 10 * 60_000 });
  const t = useQuery({ queryKey: ['analytics', 'today'], queryFn: () => get<Today>('/analytics/today'), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  const d = q.data;

  const delta = d && d.previous.booked ? (d.totals.booked - d.previous.booked) / d.previous.booked : null;
  const maxDay = Math.max(1, ...(d?.byDay.map((x) => x.revenue) ?? [1]));
  const maxSrc = Math.max(1, ...(d?.sources.map((x) => x.count) ?? [1]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={[webMax, { padding: 16, gap: 12, paddingBottom: 40 }, wide && { maxWidth: 1100 }]}
      refreshControl={<RefreshControl refreshing={q.isRefetching || t.isRefetching} onRefresh={() => { void q.refetch(); void t.refetch(); }} />}
    >
      {t.data && <TodayCards d={t.data} tz={me.tenant.timezone} wide={wide} />}
      {(ins.data?.length ?? 0) > 0 && <Insights list={ins.data!} />}
      <Text style={{ fontFamily: F.display, fontSize: 22, marginTop: 8 }}>Отчёт за период</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {PERIODS.map((p) => <Chip key={p.days} label={p.label} active={days === p.days} onPress={() => setDays(p.days)} />)}
      </View>
      <ErrorText error={q.error} />
      {d && (
        <>
          {/* Главная цифра */}
          <Card style={{ backgroundColor: C.text, borderColor: C.text, padding: 20 }}>
            <Text style={{ color: '#B8BCE8', fontSize: 14 }}>Записей на сумму</Text>
            <Text style={{ color: '#fff', fontFamily: F.display, fontSize: 40, lineHeight: 48 }}>{rub(d.totals.booked)}</Text>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {delta !== null && (
                <View style={{ backgroundColor: delta >= 0 ? '#1E5B45' : '#6B2A1B', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>{delta >= 0 ? '▲' : '▼'} {pct(Math.abs(delta))} к прошлому периоду</Text>
                </View>
              )}
              <Text style={{ color: '#B8BCE8', fontSize: 13 }}>оплачено визитов: {rub(d.totals.revenue)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 64, marginTop: 12 }}>
              {d.byDay.map((x) => (
                <View key={x.date} style={{ flex: 1, height: `${Math.max(3, (x.revenue / maxDay) * 100)}%`, backgroundColor: x.revenue ? C.accent : '#2A2C55', borderRadius: 3 }} />
              ))}
            </View>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Kpi icon="calendar-outline" label="Записей" value={String(d.totals.bookings)} hint={`из них онлайн ${pct(d.totals.onlineShare)}`} wide={wide} />
            <Kpi icon="wallet-outline" label="Средний чек" value={rub(d.totals.avgCheck)} wide={wide} />
            <Kpi icon="speedometer-outline" label="Загрузка мастеров" value={pct(d.totals.load)} hint="занятое время / по графику" wide={wide} />
            {(d.totals.deposits > 0 || d.totals.passSales > 0) && <Kpi icon="wallet-outline" label="Внесли заранее" value={rub(d.totals.deposits + d.totals.passSales)} hint={`депозиты ${rub(d.totals.deposits)} · абонементы: ${d.totals.passCount}`} wide={wide} />}
            {d.totals.reviews > 0 && <Kpi icon="star-outline" label="Оценка клиентов" value={`${d.totals.rating?.toFixed(1)} ★`} hint={`${d.totals.reviews} оценок${d.totals.lowRatings ? ` · низких: ${d.totals.lowRatings}` : ''}`} wide={wide} tone={d.totals.lowRatings ? 'bad' : undefined} />}
            <Kpi icon="person-add-outline" label="Новых клиентов" value={String(d.totals.newCustomers)} wide={wide} />
            {d.totals.materialCost > 0 && <Kpi icon="cube-outline" label="Материалы" value={rub(d.totals.materialCost)} hint={`${pct(d.totals.revenue ? d.totals.materialCost / d.totals.revenue : 0)} от оплаченного`} wide={wide} />}
            <Kpi icon="close-circle-outline" label="Не пришли" value={pct(d.totals.noShowRate)} hint={`отмен: ${d.totals.cancelled}`} wide={wide} tone={d.totals.noShowRate > 0.1 ? 'bad' : undefined} />
          </View>

          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12 }}>
            <Card style={{ flex: 1 }}>
              <Title>Откуда клиенты</Title>
              {d.sources.length === 0 ? <Muted>Пока нет записей за период</Muted> : d.sources.map((s) => (
                <Bar key={s.key} label={s.label} value={`${s.count} · ${rub(s.amount)}`} share={s.count / maxSrc} />
              ))}
              <Muted>Добавьте метку к ссылке записи — например, ?src=yandex для Яндекс Карт, ?src=2gis для 2ГИС.</Muted>
            </Card>
            <Card style={{ flex: 1 }}>
              <Title>Мастера</Title>
              {d.masters.map((m) => (
                <Bar key={m.id} label={m.name} value={`${m.bookings} зап. · ${rub(m.amount)} · ${pct(m.load)}${m.rating ? ` · ${m.rating.toFixed(1)}★` : ''}`} share={m.load} color={m.color} onPress={() => router.push(`/master/${m.id}`)} />
              ))}
            </Card>
          </View>

          <Card>
            <Title>Популярные услуги</Title>
            {d.services.length === 0 ? <Muted>Пока нет данных</Muted> : d.services.map((s, i) => (
              <View key={s.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: C.border }}>
                <Text style={{ flex: 1 }} numberOfLines={1}>{s.name}</Text>
                <Muted>{s.count} · {rub(s.amount)}</Muted>
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const Title = ({ children }: { children: string }) => <Text style={{ fontFamily: F.display, fontSize: 20, marginBottom: 4 }}>{children}</Text>;

function Kpi({ icon, label, value, hint, wide, tone }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; value: string; hint?: string; wide: boolean; tone?: 'bad' }) {
  return (
    <View style={{ flexBasis: wide ? '18%' : '46%', flexGrow: 1, backgroundColor: C.card, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#EEF0F7', gap: 4 }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: tone === 'bad' ? '#FDECE7' : C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={tone === 'bad' ? C.danger : C.brand} />
      </View>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>{value}</Text>
      {hint && <Text style={{ fontSize: 12, color: C.muted }}>{hint}</Text>}
    </View>
  );
}

function Bar({ label, value, share, color = C.brand, onPress }: { label: string; value: string; share: number; color?: string; onPress?: () => void }) {
  return (
    <View style={{ gap: 4, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1} onPress={onPress}>{label}</Text>
        <Muted>{value}</Muted>
      </View>
      <View style={{ height: 8, backgroundColor: C.brandSoft, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(2, Math.min(1, share) * 100)}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
}

type CardKey = 'load' | 'revenue' | 'top';
const pctN = (x: number) => `${Math.round(x * 100)}%`;
const STATUS: Record<string, string> = { SCHEDULED: 'ждём', CONFIRMED: 'подтвердил', ARRIVED: 'пришёл', COMPLETED: 'оплачено' };

/** Три главные цифры дня. Нажатие раскрывает детали. */
function TodayCards({ d, tz, wide }: { d: Today; tz: string; wide: boolean }) {
  const [open, setOpen] = useState<CardKey | null>(null);
  const toggle = (k: CardKey) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen(open === k ? null : k); };
  const top = d.topMaster.top;
  const cards: { key: CardKey; icon: ComponentProps<typeof Ionicons>['name']; label: string; value: string; hint: string; detail: ReactNode }[] = [
    {
      key: 'load', icon: 'speedometer-outline', label: 'Загрузка на сегодня', value: pctN(d.load.value),
      hint: !d.load.capacityMin ? 'сегодня выходной' : d.load.dayOver ? 'рабочий день завершён' : d.load.freeMin ? `свободно ещё ${minutes(d.load.freeMin)}` : 'свободных окон нет',
      detail: d.load.masters.map((m) => (
        <View key={m.id} style={{ gap: 4, paddingVertical: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '600' }}>{m.name}</Text>
            <Muted>{m.capacityMin ? `${pctN(m.load)} · ${m.bookings} зап.` : 'не работает'}</Muted>
          </View>
          {m.capacityMin > 0 && <Meter share={m.load} color={m.color} />}
          {m.free.length > 0 && <Text style={{ fontSize: 13, color: C.muted }}>Свободно: {m.free.map((f) => `${f.from}–${f.to}`).join(', ')}</Text>}
        </View>
      )),
    },
    {
      key: 'revenue', icon: 'cash-outline', label: 'Ожидаемый доход', value: rub(d.revenue.expected),
      hint: `${d.revenue.bookings} зап. · оплачено ${rub(d.revenue.done)}`,
      detail: d.revenue.list.length ? d.revenue.list.map((b) => (
        <Pressable key={b.id} onPress={() => router.push(`/booking/${b.id}`)} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6, alignItems: 'center' }}>
          <Text style={{ fontWeight: '700', width: 48 }}>{time(b.startsAt, tz)}</Text>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1}>{b.customer} · {b.services.join(', ')}</Text>
            <Text style={{ fontSize: 13, color: C.muted }}>{b.master} · {STATUS[b.status] ?? b.status}</Text>
          </View>
          <Text style={{ fontWeight: '600' }}>{rub(b.price)}</Text>
        </Pressable>
      )) : <Muted>На сегодня записей нет</Muted>,
    },
    {
      key: 'top', icon: 'trophy-outline', label: 'Самый прибыльный мастер', value: top ? top.name : '—',
      hint: top ? `${rub(top.amount)} за 7 дней · ${pctN(top.share)} выручки` : 'пока нет записей за неделю',
      detail: d.topMaster.ranking.map((m, i) => (
        <View key={m.id} style={{ gap: 4, paddingVertical: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '600' }}>{i + 1}. {m.name}</Text>
            <Muted>{rub(m.amount)} · {m.bookings} зап. · чек {rub(m.avgCheck)}</Muted>
          </View>
          <Meter share={m.share} color={m.color} />
        </View>
      )),
    },
  ];
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontFamily: F.display, fontSize: 22 }}>Сегодня</Text>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 10, alignItems: 'flex-start' }}>
        {cards.map((c) => {
          const isOpen = open === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => toggle(c.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', backgroundColor: isOpen ? C.text : C.card, borderRadius: 22, padding: 16, borderWidth: 1, borderColor: isOpen ? C.text : '#EEF0F7', gap: 6 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: isOpen ? 'rgba(255,255,255,.12)' : C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={c.icon} size={18} color={isOpen ? C.accent : C.brand} />
                </View>
                <Text style={{ flex: 1, color: isOpen ? '#C9CCF2' : C.muted }}>{c.label}</Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={isOpen ? '#C9CCF2' : C.muted} />
              </View>
              <Text style={{ fontSize: 28, fontWeight: '700', color: isOpen ? '#fff' : C.text }} numberOfLines={1}>{c.value}</Text>
              <Text style={{ fontSize: 13, color: isOpen ? '#C9CCF2' : C.muted }}>{c.hint}</Text>
              {isOpen && <View style={{ backgroundColor: C.card, borderRadius: 16, padding: 12, marginTop: 6 }}>{c.detail}</View>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Meter({ share, color }: { share: number; color: string }) {
  return (
    <View style={{ height: 6, backgroundColor: C.brandSoft, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(2, Math.min(1, share) * 100)}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

const LEVEL: Record<Insight['level'], { icon: ComponentProps<typeof Ionicons>['name']; color: string; bg: string }> = {
  warn: { icon: 'alert-circle', color: '#9A2A08', bg: '#FDECE7' },
  tip: { icon: 'bulb', color: C.brandDark, bg: C.brandSoft },
  good: { icon: 'trophy', color: '#0F7A52', bg: '#E6F6EC' },
};

/** Советы: что можно улучшить — на основе данных салона (те же правила, что в еженедельной сводке) */
function Insights({ list }: { list: Insight[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 3);
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontFamily: F.display, fontSize: 22, marginTop: 8 }}>Советы</Text>
      {shown.map((i) => {
        const l = LEVEL[i.level];
        return (
          <View key={i.code} style={{ backgroundColor: l.bg, borderRadius: 20, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name={l.icon} size={20} color={l.color} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontWeight: '700', color: l.color }}>{i.title}</Text>
            </View>
            <Text style={{ color: C.text }}>{i.text}</Text>
            {i.customers && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {i.customers.map((c) => (
                  <Pressable key={c.id} onPress={() => router.push(`/customer/${c.id}`)} style={{ backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 13 }}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {i.action && (
              <Pressable onPress={() => router.push(i.action!.route as never)} accessibilityRole="button">
                <Text style={{ color: l.color, fontWeight: '700' }}>{i.action.label} →</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {list.length > 3 && (
        <Pressable onPress={() => setAll(!all)}><Text style={{ color: C.brand, fontWeight: '600' }}>{all ? 'Свернуть' : `Ещё советы: ${list.length - 3}`}</Text></Pressable>
      )}
    </View>
  );
}
