import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StockItem, StockTake } from '@restor/shared-types';
import { IconPrint, IconSave, IconSearch } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTimeOf, percent, qty, som } from '../../lib/format';
import { parseQty, unitOf } from '../../lib/inventory';
import { printStockTake } from '../../lib/print';
import { Drawer } from '../Drawer';
import { ErrorState, Loading } from '../States';

type Notify = (n: { ok: boolean; text: string }) => void;

/** Past stock-takes, each printable as the signed act. */
export function StockTakesTab({ branchId, onNotice }: { branchId: string; onNotice: Notify }) {
  const { user } = useAuth();
  const takes = useQuery({
    queryKey: ['stock', 'takes', branchId],
    queryFn: () => api.inventory.listTakes(branchId || undefined),
  });

  if (takes.isLoading) return <Loading />;
  if (takes.isError) return <ErrorState error={takes.error} onRetry={() => void takes.refetch()} />;
  if ((takes.data ?? []).length === 0) {
    return <p className="card muted" style={{ textAlign: 'center' }}>Hali inventarizatsiya oʻtkazilmagan</p>;
  }

  return (
    <div className="card card--flush">
      <div className="table-wrap">
        <table style={{ minWidth: 680 }}>
          <thead>
            <tr><th>Sana</th><th>Filial</th><th className="td-right">Pozitsiya</th><th className="td-right">Moslik</th><th className="td-right">Kamomad</th><th className="td-right">Ortiqcha</th><th /></tr>
          </thead>
          <tbody>
            {takes.data!.map((t) => (
              <tr key={t.id}>
                <td className="cell-main">{dateTimeOf(t.createdAt)}<div className="cell-sub">{t.createdByName ?? '—'}</div></td>
                <td>{t.branchName}</td>
                <td className="td-right num">{t.itemsCount}</td>
                <td className="td-right">{percent(t.itemsCount ? (t.matchedCount / t.itemsCount) * 100 : null)}</td>
                <td className="td-right num" style={{ color: t.shortageValue ? 'var(--danger)' : undefined }}>{t.shortageValue ? `−${som(t.shortageValue)}` : '—'}</td>
                <td className="td-right num">{t.surplusValue ? `+${som(t.surplusValue)}` : '—'}</td>
                <td className="td-right">
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => !printStockTake(t, user?.tenantName ?? 'RESTOR') && onNotice({ ok: false, text: 'Brauzer yangi oynani bloklab qoʻydi' })}
                  >
                    <IconPrint size={13} /> Akt
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Counting the shelf.
 *
 * Staff type what they count; the books beside each line are only a guide —
 * the server re-reads them at the moment of saving, so a sale that finished
 * mid-count is not mistaken for a shortage. Lines left blank are not counted
 * and not touched.
 */
export function StockTakeForm({
  branchId,
  branchName,
  items,
  onClose,
  onSaved,
}: {
  branchId: string;
  branchName: string;
  items: StockItem[];
  onClose: () => void;
  onSaved: (take: StockTake) => void;
}) {
  const queryClient = useQueryClient();
  const shelf = useMemo(
    () => items.filter((i) => i.branchId === branchId && i.isActive).sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name)),
    [items, branchId],
  );
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const counted = shelf.filter((i) => counts[i.id]?.trim());
  const diffValue = counted.reduce((sum, i) => {
    const c = parseQty(counts[i.id]!);
    return Number.isNaN(c) ? sum : sum + Math.round((c - Number(i.quantity)) * i.costPerUnit);
  }, 0);
  const visible = shelf.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.sku?.toLowerCase().includes(search.toLowerCase()));

  const save = useMutation({
    mutationFn: () =>
      api.inventory.createTake({
        branchId,
        note: note.trim() || null,
        lines: counted.map((i) => ({ stockItemId: i.id, counted: parseQty(counts[i.id]!) })),
      }),
    onSuccess: (take) => {
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onSaved(take);
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  return (
    <Drawer
      title={`Inventarizatsiya — ${branchName}`}
      width="wide"
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <span className="muted" style={{ alignSelf: 'center', marginRight: 'auto' }}>
            {counted.length} / {shelf.length} sanaldi · farq: <b style={{ color: diffValue < 0 ? 'var(--danger)' : undefined }}>{diffValue > 0 ? '+' : ''}{som(diffValue)}</b>
          </span>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button
            type="button"
            className="btn"
            disabled={save.isPending}
            onClick={() => {
              if (counted.length === 0) return setError('Kamida bitta mahsulotni sanang');
              if (counted.some((i) => Number.isNaN(parseQty(counts[i.id]!)) || parseQty(counts[i.id]!) < 0)) return setError('Sanoq son boʻlishi kerak');
              setError(null);
              save.mutate();
            }}
          >
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Yakunlash va akt tuzish'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <p className="field__hint" style={{ margin: 0 }}>
          Javonda sanalgan miqdorni kiriting. Boʻsh qoldirilgan qatorlar sanalmagan hisoblanadi va oʻzgarmaydi. Farqlar avtomatik tuzatish sifatida yoziladi.
        </p>
        <div className="search-input">
          <IconSearch size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Xomashyo nomi yoki kodi…" aria-label="Qidiruv" />
        </div>
        <div className="table-wrap">
          <table style={{ minWidth: 560 }}>
            <thead>
              <tr><th>Xomashyo</th><th className="td-right">Hisobda</th><th>Sanaldi</th><th className="td-right">Farq</th></tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const raw = counts[i.id] ?? '';
                const c = parseQty(raw);
                const diff = raw.trim() && !Number.isNaN(c) ? Math.round((c - Number(i.quantity)) * 1000) / 1000 : null;
                return (
                  <tr key={i.id}>
                    <td className="cell-main">{i.name}<div className="cell-sub">{i.category ?? ''}{i.sku ? ` · ${i.sku}` : ''}</div></td>
                    <td className="td-right num">{qty(i.quantity)} {unitOf(i.unit)}</td>
                    <td>
                      <input
                        aria-label={`${i.name} sanog'i`}
                        inputMode="decimal"
                        value={raw}
                        onChange={(e) => setCounts((s) => ({ ...s, [i.id]: e.target.value }))}
                        style={{ width: 110 }}
                      />
                    </td>
                    <td className="td-right num" style={{ color: diff === null || diff === 0 ? undefined : diff < 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {diff === null ? '' : diff === 0 ? 'mos' : `${diff > 0 ? '+' : ''}${String(diff).replace('.', ',')}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="field">
          <label htmlFor="st-note">Izoh</label>
          <input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Oylik inventarizatsiya, komissiya: …" />
        </div>
      </div>
    </Drawer>
  );
}
