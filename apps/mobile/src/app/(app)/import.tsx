import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../../components/Text';
import { Button, C, Card, Chip, ErrorText, H, Muted, Screen } from '../../components/ui';
import { upload } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { rub } from '../../lib/format';

type Kind = 'customers' | 'services';
type Picked = { uri: string; name: string; mimeType?: string; file?: File };
type Summary = {
  source: string; columns: { field: string; column: string }[]; total: number; invalid: number;
  sample?: Record<string, unknown>[]; created?: number; skipped?: number;
};

/** Перенос из YCLIENTS, DIKIDI, Excel: файл → что нашли → загрузить */
export default function Import() {
  const me = useMe();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(can(me, 'customers.view') ? 'customers' : 'services');
  const [file, setFile] = useState<Picked | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const send = (f: Picked, dryRun: boolean) => {
    const form = new FormData();
    if (f.file) form.append('file', f.file, f.name);
    else form.append('file', { uri: f.uri, name: f.name, type: f.mimeType ?? 'application/octet-stream' } as unknown as Blob);
    return upload<Summary>(`/import?kind=${kind}${dryRun ? '&dryRun=1' : ''}`, form);
  };

  async function pick() {
    setError(null);
    setResult(null);
    const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const f: Picked = { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined, file: (a as { file?: File }).file };
    setFile(f);
    setPreview(null);
    setBusy(true);
    try {
      setPreview(await send(f, true));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await send(file, false));
      setPreview(null);
      setFile(null);
      void qc.invalidateQueries({ queryKey: [kind] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Muted>Перенесите базу из YCLIENTS, DIKIDI или любой таблицы. Выгрузите данные в Excel (.xlsx) или CSV — колонки мы узнаем сами, а перед загрузкой покажем, что нашли.</Muted>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {can(me, 'customers.view') && <Chip label="Клиенты" active={kind === 'customers'} onPress={() => { setKind('customers'); setPreview(null); setFile(null); }} />}
        {can(me, 'catalog.manage') && <Chip label="Услуги" active={kind === 'services'} onPress={() => { setKind('services'); setPreview(null); setFile(null); }} />}
      </View>

      <Card>
        <Text style={{ fontWeight: '700', color: C.text }}>Где взять файл</Text>
        {kind === 'customers' ? (
          <>
            <Muted>В YCLIENTS и DIKIDI откройте список клиентов и найдите кнопку экспорта (выгрузки) в Excel. Если не нашли — напишите в их поддержку «нужна выгрузка клиентской базы»: по закону вы владеете своими данными.</Muted>
            <Muted>Нужны колонки с именем и телефоном. Email, дата рождения, комментарий, категории, число визитов и сумма — перенесутся, если есть.</Muted>
          </>
        ) : (
          <>
            <Muted>В старой программе откройте список услуг и выгрузите его в Excel. Подойдёт и таблица, составленная вручную.</Muted>
            <Muted>Нужна колонка с названием. Цена, длительность («90», «1:30» или «1 ч 30 мин») и категория — если есть. Услуги сразу станут доступны всем мастерам.</Muted>
          </>
        )}
        <Muted>Клиенты с уже известным телефоном и услуги с таким же названием не дублируются — файл можно загрузить повторно.</Muted>
      </Card>

      <Button title={file ? `Выбрать другой файл` : 'Выбрать файл'} variant={file ? 'ghost' : 'primary'} onPress={pick} loading={busy && !preview} />
      <ErrorText error={error} />

      {preview && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.text }}>{file?.name}</Text>
          <Muted>Похоже на выгрузку: {preview.source}. Нашли {preview.total} {kind === 'customers' ? plural(preview.total, 'клиента', 'клиентов', 'клиентов') : plural(preview.total, 'услугу', 'услуги', 'услуг')}{preview.invalid ? `, пропустим ${preview.invalid} ${plural(preview.invalid, 'строку', 'строки', 'строк')} без ${kind === 'customers' ? 'имени или телефона' : 'названия'}` : ''}.</Muted>
          <Muted>Колонки: {preview.columns.map((c) => `${c.field} ← «${c.column}»`).join(', ')}</Muted>
          <H>Первые строки</H>
          {preview.sample?.map((r, i) => (
            <Text key={i} style={{ color: C.text }}>
              {kind === 'customers'
                ? `${r.name} · ${r.phone}${r.email ? ` · ${r.email}` : ''}${(r.tags as string[])?.length ? ` · ${(r.tags as string[]).join(', ')}` : ''}`
                : `${r.name} · ${rub(r.price as number)} · ${r.duration} мин${r.category ? ` · ${r.category}` : ''}`}
            </Text>
          ))}
          <Button title={`Загрузить: ${preview.total} ${kind === 'customers' ? plural(preview.total, 'клиент', 'клиента', 'клиентов') : plural(preview.total, 'услуга', 'услуги', 'услуг')}`} onPress={confirm} loading={busy} disabled={!preview.total} />
        </Card>
      )}

      {result && (
        <Card style={{ backgroundColor: '#DDF5EA', borderColor: '#BDEBD4' }}>
          <Text style={{ fontWeight: '700', color: '#0F6B48' }}>Готово: добавлено {result.created}</Text>
          {!!result.skipped && <Muted>Уже были в базе и пропущены: {result.skipped}</Muted>}
          <Muted>Будущие записи из старой программы перенесите вручную или напишите нам — поможем бесплатно.</Muted>
        </Card>
      )}
    </Screen>
  );
}

/** 1 клиент, 2 клиента, 5 клиентов */
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
