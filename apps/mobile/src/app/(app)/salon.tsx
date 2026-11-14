import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, ErrorText, Field, H, Loading, Muted, Screen, Toggle } from '../../components/ui';
import { get, patch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { IndustryInfo, LinkKey, Tenant } from '../../lib/types';

const LINKS: { key: LinkKey; label: string; placeholder: string }[] = [
  { key: 'yandexMaps', label: 'Карточка в Яндекс Картах', placeholder: 'https://yandex.ru/maps/org/…' },
  { key: 'twoGis', label: 'Карточка в 2ГИС', placeholder: 'https://2gis.ru/…/firm/…' },
  { key: 'vk', label: 'ВКонтакте', placeholder: 'https://vk.com/…' },
  { key: 'telegram', label: 'Telegram-канал', placeholder: 'https://t.me/…' },
  { key: 'max', label: 'MAX', placeholder: 'https://max.ru/…' },
  { key: 'site', label: 'Сайт', placeholder: 'https://…' },
];

export default function SalonSettings() {
  const qc = useQueryClient();
  const { reload } = useAuth();
  const q = useQuery({ queryKey: ['tenant'], queryFn: () => get<Tenant>('/tenant') });
  const industries = useQuery({ queryKey: ['industries'], queryFn: () => get<IndustryInfo[]>('/public-meta/industries'), staleTime: Infinity });
  const [f, setF] = useState<Tenant | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);

  const save = useMutation({
    mutationFn: () => patch<Tenant>('/tenant', { name: f!.name, phone: f!.phone || null, address: f!.address || null, settings: f!.settings }),
    onSuccess: (t) => { qc.setQueryData(['tenant'], t); reload(); },
  });
  if (!f) return q.error ? <Screen><ErrorText error={q.error} /></Screen> : <Loading />;
  const set = (k: keyof Tenant['settings']) => (v: string | boolean) =>
    setF({ ...f, settings: { ...f.settings, [k]: typeof v === 'string' ? parseInt(v || '0', 10) : v } });

  return (
    <Screen>
      <Field label="Название" value={f.name} onChangeText={(name) => setF({ ...f, name })} />
      <Field label="Телефон салона" value={f.phone ?? ''} onChangeText={(phone) => setF({ ...f, phone })} keyboardType="phone-pad" />
      <Field label="Адрес" value={f.address ?? ''} onChangeText={(address) => setF({ ...f, address })} />
      <Muted>Часовой пояс: {f.timezone}</Muted>

      <Toggle label="Я работаю один (частный мастер)" hint="Скрывает команду и роли; в онлайн-записи нет выбора мастера. Выключите, когда появятся сотрудники" value={!!f.settings.solo} onChange={(solo) => setF({ ...f, settings: { ...f.settings, solo } })} />

      <H>Сфера</H>
      <Muted>Меняет слова в приложении («мастер», «тренер», «преподаватель») и разметку для поисковиков.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(industries.data ?? []).map((i) => (
          <Chip key={i.code} label={i.label} active={f.settings.industry === i.code} onPress={() => setF({ ...f, settings: { ...f.settings, industry: i.code } })} />
        ))}
      </View>

      <H>Мини-сайт</H>
      <Muted>Показывается на странице онлайн-записи и в Яндекс Картах / 2ГИС, если вы добавите туда ссылку.</Muted>
      <Field label="О вас" value={f.settings.about ?? ''} onChangeText={(about) => setF({ ...f, settings: { ...f.settings, about } })} multiline maxLength={1500} placeholder="Чем вы отличаетесь, какие материалы используете, есть ли парковка" />
      {LINKS.map((l) => (
        <Field
          key={l.key}
          label={l.label}
          value={f.settings.links?.[l.key] ?? ''}
          onChangeText={(v) => setF({ ...f, settings: { ...f.settings, links: { ...(f.settings.links ?? {}), [l.key]: v.trim() } } })}
          autoCapitalize="none"
          keyboardType="url"
          placeholder={l.placeholder}
        />
      ))}

      <H>Реквизиты для согласия клиентов</H>
      <Muted>Салон — оператор персональных данных своих клиентов. Эти данные показываются в согласии на странице онлайн-записи.</Muted>
      <Field label="ИП / организация" value={f.settings.legalName ?? ''} onChangeText={(legalName) => setF({ ...f, settings: { ...f.settings, legalName } })} placeholder="ИП Иванова Анна Сергеевна" />
      <Field label="ИНН" value={f.settings.inn ?? ''} onChangeText={(inn) => setF({ ...f, settings: { ...f.settings, inn: inn.replace(/\D/g, '').slice(0, 12) } })} keyboardType="number-pad" />

      <H>Онлайн-запись</H>
      <Toggle label="Онлайн-запись включена" value={f.settings.onlineBookingEnabled} onChange={set('onlineBookingEnabled')} />
      <Field label="Шаг сетки времени, мин" value={String(f.settings.slotStepMin)} onChangeText={set('slotStepMin')} keyboardType="number-pad" />
      <Field label="Записаться можно не позже чем за, мин" value={String(f.settings.minLeadMin)} onChangeText={set('minLeadMin')} keyboardType="number-pad" />
      <Field label="Запись открыта на, дней вперёд" value={String(f.settings.maxDaysAhead)} onChangeText={set('maxDaysAhead')} keyboardType="number-pad" />
      <Field label="Клиент может отменить не позднее чем за, ч" value={String(f.settings.cancelBeforeHours)} onChangeText={set('cancelBeforeHours')} keyboardType="number-pad" />

      <H>Напоминания</H>
      <Toggle label="Напоминать клиентам" hint="За 24 часа и за 2 часа до визита" value={f.settings.remindersEnabled} onChange={set('remindersEnabled')} />
      <Toggle label="Просить оценить визит" hint="Через 2 часа после визита: оценка 1–5. Довольных попросим оставить отзыв на картах, о недовольных сразу сообщим вам" value={f.settings.feedbackEnabled} onChange={set('feedbackEnabled')} />
      <Toggle label="Советы раз в неделю" hint="В понедельник утром: итоги недели и что можно улучшить — в Telegram и push" value={f.settings.insightsDigest} onChange={set('insightsDigest')} />

      <ErrorText error={save.error} />
      <Button title="Сохранить" onPress={() => save.mutate()} loading={save.isPending} />
    </Screen>
  );
}
