import { Link } from 'react-router';

/**
 * ВНИМАНИЕ: заглушки. До запуска замените тексты на документы, подготовленные юристом:
 * политика обработки ПДн (152-ФЗ), оферта, согласие на обработку ПДн (отдельный документ).
 */
export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/" className="text-sm text-brand-600">← Salon</Link>
      <h1 className="mt-4 text-3xl font-bold">{kind === 'privacy' ? 'Политика обработки персональных данных' : 'Публичная оферта'}</h1>
      <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">Документ готовится. Текст будет опубликован до начала приёма оплат.</p>
    </div>
  );
}
