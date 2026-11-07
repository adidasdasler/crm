import { Ionicons } from '@expo/vector-icons';
import { ComponentProps, useState } from 'react';
import { Image, Linking, Platform, Pressable, Share, View } from 'react-native';
import { F, Text } from '../../components/Text';
import { Button, C, Card, Chip, H, Muted, Screen } from '../../components/ui';
import { API_URL, PUBLIC_WEB_URL } from '../../lib/api';
import { useMe } from '../../lib/auth';

type Place = {
  src: string; title: string; icon: ComponentProps<typeof Ionicons>['name']; color: string; cabinet?: { label: string; url: string };
  steps: string[];
};

/**
 * Куда поставить ссылку на запись. Метка ?src= позволяет увидеть в «Обзоре», сколько клиентов пришло с каждой площадки.
 * Названия разделов в кабинетах площадок со временем меняются — шаги описаны по смыслу.
 */
const PLACES: Place[] = [
  {
    src: 'yandex', title: 'Яндекс Карты', icon: 'location', color: '#FC3F1D',
    cabinet: { label: 'Открыть Яндекс Бизнес', url: 'https://yandex.ru/sprav/' },
    steps: [
      'Войдите в Яндекс Бизнес и выберите свою организацию (если её нет — добавьте и подтвердите).',
      'Откройте карточку организации → раздел с кнопкой действия / онлайн-записью.',
      'Выберите «Записаться» и вставьте ссылку ниже. Кнопка появится в карточке на Картах и в Поиске.',
      'Дополнительно вставьте эту же ссылку в поле «Сайт» — клиенты будут попадать сразу на запись.',
    ],
  },
  {
    src: '2gis', title: '2ГИС', icon: 'map', color: '#19AA1E',
    cabinet: { label: 'Открыть кабинет 2ГИС', url: 'https://account.2gis.com/' },
    steps: [
      'Войдите в личный кабинет 2ГИС для бизнеса и подтвердите права на карточку.',
      'В разделе контактов карточки добавьте ссылку ниже как сайт или кнопку «Записаться».',
      'Изменения проходят модерацию 2ГИС, обычно 1–3 дня.',
    ],
  },
  { src: 'vk', title: 'ВКонтакте', icon: 'logo-vk', color: '#0077FF', steps: ['Сообщество → Управление → Кнопка действия → «Записаться» → ссылка ниже.', 'Закрепите пост со ссылкой и добавьте её в меню сообщества.'] },
  { src: 'telegram', title: 'Telegram-канал', icon: 'paper-plane', color: '#229ED9', steps: ['Добавьте ссылку в описание канала и закреплённое сообщение.'] },
  { src: 'qr', title: 'QR-код в салоне', icon: 'qr-code', color: C.text, steps: ['Распечатайте QR на стойку администратора, визитки и зеркала — клиент запишется на следующий визит, не дожидаясь звонка.'] },
];

export default function Maps() {
  const me = useMe();
  const [src, setSrc] = useState('yandex');
  const place = PLACES.find((p) => p.src === src)!;
  const link = `${PUBLIC_WEB_URL}/b/${me.tenant.slug}?src=${src}`;
  const base = `${API_URL.startsWith('http') ? API_URL : `${PUBLIC_WEB_URL}${API_URL}`}/public/${me.tenant.slug}`;
  // PNG — для показа в приложении (iOS/Android не рисуют SVG в Image), SVG — для печати без потери качества
  const qr = `${base}/qr.png?src=${src}`;
  const qrPrint = `${base}/qr.svg?src=${src}`;

  const copy = async () => {
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(link);
      alert('Ссылка скопирована');
    } else await Share.share({ message: link });
  };

  return (
    <Screen>
      <Card style={{ backgroundColor: C.text, borderColor: C.text, padding: 20 }}>
        <Text style={{ color: '#fff', fontFamily: F.display, fontSize: 26, lineHeight: 32 }}>Клиенты с карт — сразу в запись</Text>
        <Text style={{ color: '#C9CCF2' }}>
          Кнопка «Записаться» в Яндекс Картах и 2ГИС ведёт на ваш мини-сайт: услуги, цены, мастера и свободное время. Поисковики видят адрес, часы и цены — карточка выглядит полнее.
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PLACES.map((p) => <Chip key={p.src} label={p.title} active={src === p.src} onPress={() => setSrc(p.src)} />)}
      </View>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: place.color, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={place.icon} size={20} color="#fff" />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{place.title}</Text>
        </View>
        <Text style={{ color: C.brandDark, marginTop: 6 }} selectable>{link}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <Button title={Platform.OS === 'web' ? 'Скопировать ссылку' : 'Поделиться ссылкой'} icon="copy-outline" onPress={copy} style={{ flexGrow: 1 }} />
          {place.cabinet && <Button variant="ghost" title={place.cabinet.label} icon="open-outline" onPress={() => Linking.openURL(place.cabinet!.url)} style={{ flexGrow: 1 }} />}
        </View>
        <H>Как подключить</H>
        {place.steps.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <Text style={{ color: C.brand, fontWeight: '700', fontSize: 13 }}>{i + 1}</Text>
            </View>
            <Text style={{ flex: 1 }}>{s}</Text>
          </View>
        ))}
      </Card>

      <Card style={{ alignItems: 'center' }}>
        <Image source={{ uri: qr }} style={{ width: 200, height: 200 }} accessibilityLabel="QR-код ссылки на запись" />
        <Muted>QR ведёт на запись с меткой «{place.title}»</Muted>
        <Pressable onPress={() => Linking.openURL(qrPrint)}><Text style={{ color: C.brand, fontWeight: '600' }}>Открыть для печати</Text></Pressable>
      </Card>

      <Muted>Сколько клиентов пришло с каждой площадки — в разделе «Обзор» → «Откуда клиенты».</Muted>
    </Screen>
  );
}
