import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  StockMovementType,
  type StockItem,
  type Supplier,
  type SupplierOrder,
} from '@restor/shared-types';
import {
  IconAlert,
  IconBox,
  IconCheck,
  IconClock,
  IconDownload,
  IconEdit,
  IconHistory,
  IconLayers,
  IconMinus,
  IconPlus,
  IconSearch,
  IconTelegram,
  IconTrash,
  IconTruck,
  IconWallet,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { compactSom, count, dateOf, dateTimeOf, percent, phone, qty, som } from '../lib/format';
import {
  amountOf,
  daysLeftLabel,
  LEVEL_LABELS,
  LEVEL_TONES,
  levelOf,
  MOVEMENT_LABELS,
  MOVEMENT_TONES,
  unitOf,
  type StockLevel,
} from '../lib/inventory';
import { ErrorState, Loading, Notice } from '../components/States';
import { ItemForm, MovementForm, SupplierForm, type MovementKind } from '../components/inventory/StockForms';
import { StockItemPanel } from '../components/inventory/StockItemPanel';
import { OrderForm, SupplierOrdersTab } from '../components/inventory/SupplierOrders';
import { StockTakeForm, StockTakesTab } from '../components/inventory/StockTakes';
import { Kpi, PageHeader, Pager, Seg, Tabs, downloadCsv } from '../components/ui';

type Tab = 'stock' | 'movements' | 'orders' | 'suppliers' | 'expiry' | 'takes';
type Form =
  | { kind: 'item'; item: StockItem | null }
  | { kind: 'movement'; movement: MovementKind; itemId?: string; quantity?: string; comment?: string }
  | { kind: 'supplier'; supplier: Supplier | null }
  | { kind: 'order'; preset?: { supplierId?: string | null; stockItemId: string; quantity: string } }
  | { kind: 'take' };

const PAGE = 25;

/**
 * Inventory (TZ 29-31).
 *
 * One rule shapes the screen: a level moves only through a movement. There
 * is no editable quantity anywhere — a delivery is a receipt, a loss is a
 * write-off, and a count that disagrees with the books is a stock-take whose
 * differences are written as adjustments and kept as a signed act.
 */
export function InventoryPage() {
  const { can } = useAuth();
  const { branches, branchId } = useBranch();
  const [tab, setTab] = useState<Tab>('stock');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'' | 'attention' | StockLevel>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const canManage = can(Permission.INVENTORY_MANAGE);
  const branchKey = branchId || undefined;
  const actionBranch = branchId || (branches.length === 1 ? branches[0]!.id : '');
  const actionBranchName = branches.find((b) => b.id === actionBranch)?.name ?? '';

  const summary = useQuery({ queryKey: ['stock', 'summary', branchId], queryFn: () => api.inventory.summary(branchKey) });
  const items = useQuery({ queryKey: ['stock', 'items', branchId], queryFn: () => api.inventory.listItems({ branchId: branchKey }) });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.inventory.listSuppliers() });

  const all = items.data ?? [];
  const categories = useMemo(() => [...new Set(all.map((i) => i.category).filter((c): c is string => Boolean(c)))].sort(), [all]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((i) => {
      if (category && i.category !== category) return false;
      const level = levelOf(i);
      if (status === 'attention' && level === 'ok') return false;
      if (status && status !== 'attention' && level !== status) return false;
      return !needle || i.name.toLowerCase().includes(needle) || (i.sku ?? '').toLowerCase().includes(needle);
    });
  }, [all, category, status, search]);
  const levels = useMemo(() => {
    const counts = { critical: 0, low: 0, ok: 0 };
    for (const i of all) counts[levelOf(i)]++;
    return counts;
  }, [all]);

  const opened = all.find((i) => i.id === openId) ?? null;
  const s = summary.data;
  const lossShare = s && s.wasteValue + s.consumptionValue > 0 ? (s.wasteValue / (s.wasteValue + s.consumptionValue)) * 100 : null;

  const needBranch = (then: () => void) => {
    if (!actionBranch) return setNotice({ ok: false, text: 'Avval yuqoridagi menyudan filialni tanlang' });
    then();
  };

  const ordered = (order: SupplierOrder) => {
    setForm(null);
    setNotice({
      ok: true,
      text:
        order.telegramStatus === 'QUEUED'
          ? `Buyurtma №${order.number} ${order.supplierName}ga Telegram orqali yuborildi`
          : `Buyurtma №${order.number} saqlandi — ${
              order.telegramStatus === 'NO_BOT' ? 'Telegram bot sozlanmagan' : 'taʼminotchining Telegram chati kiritilmagan'
            }, matnini “Buyurtmalar”dan nusxalang`,
    });
    setTab('orders');
  };

  if (items.isLoading) return <Loading />;
  if (items.isError) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />;

  const pageItems = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <PageHeader
        crumb="Ombor va taʼminot"
        title="Ombor va taʼminot nazorati"
        subtitle="Xomashyo qoldiqlari, partiyalar, kam qolgan zaxiralar va taʼminotchilar"
        actions={
          canManage && (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => needBranch(() => setForm({ kind: 'take' }))}>
                <IconCheck size={16} /> Inventarizatsiya
              </button>
              <button type="button" className="btn btn--ghost" disabled={all.length === 0} onClick={() => setForm({ kind: 'movement', movement: 'WASTE' })}>
                <IconMinus size={16} /> Hisobdan chiqarish
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setForm({ kind: 'item', item: null })}>
                <IconPlus size={16} /> Xomashyo qoʻshish
              </button>
              <button type="button" className="btn" disabled={all.length === 0} onClick={() => setForm({ kind: 'movement', movement: 'RECEIPT' })}>
                <IconTruck size={16} /> Yangi kirim
              </button>
            </>
          )
        }
      />

      <div className="kpi-grid">
        <Kpi
          label="Ombor umumiy qiymati"
          value={s ? compactSom(s.totalValue) : '…'}
          unit="soʻm"
          Icon={IconWallet}
          tone="tone-primary"
          foot={<span>{branchId ? branches.find((b) => b.id === branchId)?.name : `${branches.length} ta filial ombori`}</span>}
        />
        <Kpi
          label="Xomashyo turlari"
          value={count(all.length)}
          unit="ta"
          Icon={IconBox}
          tone="tone-info"
          foot={<span>{categories.length} ta toifada{all.length - all.filter((i) => i.sku).length > 0 ? '' : ' · hammasi kodlangan'}</span>}
        />
        <Kpi
          label="Kritik kam qolganlar"
          value={levels.critical + levels.low}
          unit="ta"
          Icon={IconAlert}
          tone={levels.critical > 0 ? 'tone-danger' : levels.low > 0 ? 'tone-warning' : 'tone-success'}
          alert={levels.critical > 0}
          foot={
            <span className="kpi__foot-text" title={s?.lowItems.map((i) => i.name).join(', ')}>
              {s && s.lowItems.length > 0 ? s.lowItems.slice(0, 3).map((i) => i.name).join(', ') : 'Hammasi yetarli'}
            </span>
          }
        />
        <Kpi
          label="Oylik hisobdan chiqarish"
          value={s ? compactSom(s.wasteValue) : '…'}
          unit="soʻm"
          Icon={IconTrash}
          tone={lossShare !== null && lossShare > 2 ? 'tone-danger' : 'tone-success'}
          foot={<span>{lossShare === null ? '30 kun' : `${percent(lossShare)} yoʻqotish · meʼyor 2% gacha`}</span>}
        />
      </div>

      {s && (s.expiredBatches > 0 || s.expiringBatches > 0) && (
        <div className={`banner ${s.expiredBatches > 0 ? 'banner--danger' : 'banner--warning'}`}>
          <IconClock size={18} />
          <span style={{ flex: 1 }}>
            {s.expiredBatches > 0 && <b>{s.expiredBatches} ta partiyaning muddati oʻtgan. </b>}
            {s.expiringBatches > 0 && `${s.expiringBatches} ta partiya 3 kun ichida yaroqsiz boʻladi.`}
          </span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab('expiry')}>Koʻrish</button>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          setOpenId(null);
        }}
        options={[
          { value: 'stock', label: 'Ombor qoldiqlari', count: all.length, Icon: IconBox },
          { value: 'movements', label: 'Kirim va chiqim', Icon: IconHistory },
          { value: 'orders', label: 'Buyurtmalar', Icon: IconTelegram },
          { value: 'suppliers', label: 'Taʼminotchilar', count: suppliers.data?.length, Icon: IconTruck },
          { value: 'expiry', label: 'Yaroqlilik muddati', count: s ? s.expiredBatches + s.expiringBatches || undefined : undefined, Icon: IconClock },
          { value: 'takes', label: 'Inventarizatsiyalar', Icon: IconLayers },
        ]}
      />

      {tab === 'stock' && (
        <>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <div className="category-pills" role="group" aria-label="Toifa">
              <button type="button" aria-pressed={!category} onClick={() => { setCategory(''); setPage(1); }}>Barchasi</button>
              {categories.map((c) => (
                <button key={c} type="button" aria-pressed={category === c} onClick={() => { setCategory(c); setPage(1); }}>{c}</button>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <select aria-label="Zaxira holati" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
                <option value="">Barcha holatlar</option>
                <option value="attention">Kam qolganlar ({levels.critical + levels.low})</option>
                <option value="critical">Shoshilinch ({levels.critical})</option>
                <option value="ok">Yetarli ({levels.ok})</option>
              </select>
              <div className="search-input" style={{ minWidth: 220 }}>
                <IconSearch size={15} />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Nomi yoki SKU kodi…" aria-label="Qidiruv" />
              </div>
              <button type="button" className="btn btn--ghost" onClick={() => exportItems(filtered)}>
                <IconDownload size={15} /> Eksport
              </button>
            </div>
          </div>

          <div className={`split${opened ? '' : ' split--single'}`}>
            <div className="card card--flush">
              <div className="card__head">
                <div>
                  <h2 className="card__title">Ombordagi xomashyolar</h2>
                  <p className="card__sub">{filtered.length} ta saralangan</p>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="pill tone-danger">Kritik: {levels.critical}</span>
                  <span className="pill tone-warning">Kam: {levels.low}</span>
                  <span className="pill tone-success">Yetarli: {levels.ok}</span>
                </div>
              </div>
              {all.length === 0 ? (
                <p className="muted" style={{ padding: 24, textAlign: 'center' }}>
                  Ombor boʻsh. Xomashyo qoʻshing va menyu taomlariga retsept bering — sotuvda sarf avtomatik yoziladi.
                </p>
              ) : (
                <div className="table-wrap">
                  <table style={{ minWidth: 760 }}>
                    <thead>
                      <tr>
                        <th>Xomashyo</th>
                        <th className="td-right">Joriy qoldiq</th>
                        <th className="td-right">Min. chegara</th>
                        <th className="td-right">Narx</th>
                        <th className="td-right">Umumiy qiymat</th>
                        <th>Holat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((i) => {
                        const level = levelOf(i);
                        return (
                          <tr key={i.id} className={`row--clickable${i.id === openId ? ' row--selected' : ''}`} onClick={() => setOpenId(i.id === openId ? null : i.id)}>
                            <td>
                              <div className="cell-main">{i.name}</div>
                              <div className="cell-sub">{[i.sku, i.category, !branchId ? i.branchName : null].filter(Boolean).join(' · ') || '—'}</div>
                            </td>
                            <td className="td-right num cell-main" style={{ color: level === 'critical' ? 'var(--danger)' : undefined }}>{amountOf(i.quantity, i.unit)}</td>
                            <td className="td-right num">{i.minQuantity ? amountOf(i.minQuantity, i.unit) : '—'}</td>
                            <td className="td-right num">{som(i.costPerUnit)}</td>
                            <td className="td-right num">{som(i.stockValue)}</td>
                            <td><span className={`pill ${LEVEL_TONES[level]}`}>{LEVEL_LABELS[level]}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="card__foot">
                <Pager page={page} totalPages={Math.ceil(filtered.length / PAGE)} onChange={setPage} />
              </div>
            </div>

            {opened && (
              <StockItemPanel
                key={opened.id}
                item={opened}
                suppliers={suppliers.data ?? []}
                canManage={canManage}
                onClose={() => setOpenId(null)}
                onEdit={() => setForm({ kind: 'item', item: opened })}
                onMove={(movement) => setForm({ kind: 'movement', movement, itemId: opened.id })}
                onOrdered={ordered}
                onNotice={setNotice}
              />
            )}
          </div>
        </>
      )}

      {tab === 'movements' && <MovementsTab branchId={branchId} />}

      {tab === 'orders' && (
        <SupplierOrdersTab
          branchId={branchId}
          items={all}
          suppliers={suppliers.data ?? []}
          canManage={canManage}
          onNew={() => needBranch(() => setForm({ kind: 'order' }))}
          onNotice={setNotice}
        />
      )}

      {tab === 'suppliers' && (
        <SuppliersTab
          suppliers={suppliers.data ?? []}
          canManage={canManage}
          onEdit={(supplier) => setForm({ kind: 'supplier', supplier })}
          onNotice={setNotice}
        />
      )}

      {tab === 'expiry' && (
        <ExpiryTab
          branchId={branchId}
          canManage={canManage}
          onWriteOff={(itemId, quantity, comment) => setForm({ kind: 'movement', movement: 'WASTE', itemId, quantity, comment })}
        />
      )}

      {tab === 'takes' && <StockTakesTab branchId={branchId} onNotice={setNotice} />}

      {form?.kind === 'item' && (
        <ItemForm
          item={form.item}
          branches={branches}
          branchId={branchId}
          categories={categories}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); setNotice({ ok: true, text }); }}
        />
      )}
      {form?.kind === 'movement' && (
        <MovementForm
          items={all.filter((i) => i.isActive)}
          kind={form.movement}
          itemId={form.itemId}
          presetQuantity={form.quantity}
          presetComment={form.comment}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); setNotice({ ok: true, text }); }}
        />
      )}
      {form?.kind === 'supplier' && (
        <SupplierForm
          supplier={form.supplier}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); setNotice({ ok: true, text }); }}
        />
      )}
      {form?.kind === 'order' && (
        <OrderForm
          branchId={actionBranch}
          branchName={actionBranchName}
          items={all}
          suppliers={suppliers.data ?? []}
          preset={form.preset}
          onClose={() => setForm(null)}
          onSaved={ordered}
        />
      )}
      {form?.kind === 'take' && (
        <StockTakeForm
          branchId={actionBranch}
          branchName={actionBranchName}
          items={all}
          onClose={() => setForm(null)}
          onSaved={(take) => {
            setForm(null);
            setTab('takes');
            setNotice({
              ok: true,
              text: `Inventarizatsiya saqlandi: ${take.itemsCount} pozitsiya, ${take.matchedCount} tasi mos${take.shortageValue ? `, kamomad ${som(take.shortageValue)}` : ''}`,
            });
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MovementsTab({ branchId }: { branchId: string }) {
  const [type, setType] = useState<StockMovementType | ''>('');
  const [page, setPage] = useState(1);
  const movements = useQuery({
    queryKey: ['stock', 'movements', branchId, type, page],
    queryFn: () => api.inventory.listMovements({ branchId: branchId || undefined, type: type || undefined, page, limit: 30 }),
  });

  return (
    <section className="stack" style={{ gap: 12 }}>
      <Seg
        label="Harakat turi"
        quiet
        options={[
          { value: '' as const, label: 'Barchasi' },
          ...[StockMovementType.RECEIPT, StockMovementType.CONSUMPTION, StockMovementType.WASTE, StockMovementType.ADJUSTMENT].map((t) => ({
            value: t,
            label: MOVEMENT_LABELS[t],
          })),
        ]}
        value={type}
        onChange={(t) => { setType(t); setPage(1); }}
      />
      {movements.isLoading ? (
        <Loading />
      ) : movements.isError ? (
        <ErrorState error={movements.error} onRetry={() => void movements.refetch()} />
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table style={{ minWidth: 760 }}>
              <thead>
                <tr><th>Vaqt</th><th>Xomashyo</th><th>Turi</th><th className="td-right">Miqdor</th><th>Manba</th><th>Kim</th></tr>
              </thead>
              <tbody>
                {movements.data!.items.length === 0 ? (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>Harakat yoʻq</td></tr>
                ) : (
                  movements.data!.items.map((m) => {
                    const n = Number(m.quantity);
                    return (
                      <tr key={m.id}>
                        <td className="cell-sub" style={{ whiteSpace: 'nowrap' }}>{dateTimeOf(m.createdAt)}</td>
                        <td className="cell-main">{m.stockItemName}</td>
                        <td><span className={`pill ${MOVEMENT_TONES[m.type]}`}>{MOVEMENT_LABELS[m.type]}</span></td>
                        <td className="td-right num cell-main" style={{ color: n < 0 ? 'var(--danger)' : 'var(--success)' }}>
                          {n > 0 ? '+' : ''}{qty(m.quantity)} {unitOf(m.unit ?? '')}
                        </td>
                        <td className="cell-sub">
                          {[
                            m.orderNumber ? `#${m.orderNumber}` : null,
                            m.supplierName,
                            m.costPerUnit ? `${som(m.costPerUnit)}/${unitOf(m.unit ?? '')}` : null,
                            m.expiresAt ? `muddat ${dateOf(m.expiresAt)}` : null,
                            m.batchCode ? `partiya ${m.batchCode}` : null,
                            m.type !== StockMovementType.CONSUMPTION ? m.comment : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                        <td className="cell-sub">{m.createdByName ?? (m.type === StockMovementType.CONSUMPTION ? 'Tizim' : '—')}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="card__foot">
            <Pager page={page} totalPages={movements.data!.pagination.totalPages} onChange={setPage} />
          </div>
        </div>
      )}
    </section>
  );
}

function SuppliersTab({
  suppliers,
  canManage,
  onEdit,
  onNotice,
}: {
  suppliers: Supplier[];
  canManage: boolean;
  onEdit: (supplier: Supplier | null) => void;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (s: Supplier) => api.inventory.updateSupplier(s.id, { isActive: !s.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
    onError: (e) => onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Oʻzgartirilmadi' }),
  });

  return (
    <section className="stack" style={{ gap: 12 }}>
      {canManage && (
        <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => onEdit(null)}><IconPlus size={16} /> Taʼminotchi qoʻshish</button>
        </div>
      )}
      {suppliers.length === 0 ? (
        <p className="card muted" style={{ textAlign: 'center' }}>Taʼminotchi yoʻq</p>
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table style={{ minWidth: 640 }}>
              <thead><tr><th>Nomi</th><th>Telefon</th><th>Telegram</th><th>Izoh</th><th /></tr></thead>
              <tbody>
                {suppliers.map((sup) => (
                  <tr key={sup.id} style={{ opacity: sup.isActive ? 1 : 0.55 }}>
                    <td><div className="cell-main">{sup.name}</div><div className="cell-sub">{sup.contact ?? ''}</div></td>
                    <td className="num">{sup.phone ? phone(sup.phone) : '—'}</td>
                    <td>{sup.telegramChatId ? <span className="pill tone-success"><IconTelegram size={12} /> ulangan</span> : <span className="pill tone-neutral">yoʻq</span>}</td>
                    <td className="cell-sub">{sup.comment ?? ''}</td>
                    <td className="td-right">
                      {canManage && (
                        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onEdit(sup)}><IconEdit size={13} /> Tahrirlash</button>
                          <button type="button" className="btn btn--sm btn--ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(sup)}>
                            {sup.isActive ? 'Oʻchirish' : 'Yoqish'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Batches by use-by date. "Left" is a first-in first-out estimate from the
 * current level, which is why writing one off asks for the quantity again.
 */
function ExpiryTab({
  branchId,
  canManage,
  onWriteOff,
}: {
  branchId: string;
  canManage: boolean;
  onWriteOff: (itemId: string, quantity: string, comment: string) => void;
}) {
  const batches = useQuery({
    queryKey: ['stock', 'batches', branchId],
    queryFn: () => api.inventory.listBatches({ branchId: branchId || undefined }),
  });

  if (batches.isLoading) return <Loading />;
  if (batches.isError) return <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />;
  const list = batches.data ?? [];
  if (list.length === 0) {
    return (
      <p className="card muted" style={{ textAlign: 'center' }}>
        Muddatli partiya yoʻq. Kirim qilishda yaroqlilik muddatini kiriting — shu yerda kuzatiladi.
      </p>
    );
  }

  const atRisk = list.filter((b) => b.daysLeft <= 3).reduce((sum, b) => sum + b.value, 0);

  return (
    <div className="card card--flush">
      <div className="card__head">
        <div>
          <h2 className="card__title">Yaroqlilik muddati nazorati</h2>
          <p className="card__sub">Qoldiq FIFO boʻyicha hisoblangan: avval eski partiya ishlatiladi deb olinadi</p>
        </div>
        {atRisk > 0 && <span className="pill pill--lg tone-danger">Xavf ostida: {som(atRisk)}</span>}
      </div>
      <div className="table-wrap">
        <table style={{ minWidth: 720 }}>
          <thead>
            <tr><th>Xomashyo</th><th>Partiya</th><th>Kirim</th><th className="td-right">Qoldiq</th><th className="td-right">Qiymat</th><th>Muddat</th><th /></tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.movementId}>
                <td className="cell-main">{b.stockItemName}<div className="cell-sub">{b.supplierName ?? ''}</div></td>
                <td className="num">{b.batchCode ?? '—'}</td>
                <td className="cell-sub">{dateOf(b.receivedAt)} · {amountOf(b.received, b.unit)}</td>
                <td className="td-right num cell-main">{amountOf(b.remaining, b.unit)}</td>
                <td className="td-right num">{som(b.value)}</td>
                <td>
                  <span className={`pill ${b.daysLeft < 0 ? 'tone-danger' : b.daysLeft <= 3 ? 'tone-warning' : 'tone-success'}`}>{daysLeftLabel(b.daysLeft)}</span>
                  <div className="cell-sub">{dateOf(b.expiresAt)}</div>
                </td>
                <td className="td-right">
                  {canManage && b.daysLeft <= 3 && (
                    <button
                      type="button"
                      className="btn btn--sm btn--danger-soft"
                      onClick={() => onWriteOff(b.stockItemId, qty(b.remaining), `Muddati ${b.daysLeft < 0 ? 'oʻtgan' : 'tugayotgan'} partiya${b.batchCode ? ` ${b.batchCode}` : ''} (${dateOf(b.expiresAt)})`)}
                    >
                      <IconTrash size={13} /> Hisobdan chiqarish
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function exportItems(items: StockItem[]) {
  downloadCsv(`ombor_${new Date().toISOString().slice(0, 10)}`, [
    ['Xomashyo', 'SKU', 'Toifa', 'Filial', 'Birlik', 'Qoldiq', 'Min. chegara', 'Narx (soʻm)', 'Qiymat (soʻm)', 'Holat'],
    ...items.map((i) => [
      i.name,
      i.sku,
      i.category,
      i.branchName,
      unitOf(i.unit),
      qty(i.quantity),
      i.minQuantity ? qty(i.minQuantity) : '',
      i.costPerUnit,
      i.stockValue,
      LEVEL_LABELS[levelOf(i)],
    ]),
  ]);
}
