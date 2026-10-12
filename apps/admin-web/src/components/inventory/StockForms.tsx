import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  StockMovementType,
  StockUnit,
  type BranchSummary,
  type StockItem,
  type Supplier,
} from '@restor/shared-types';
import { IconSave } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { qty, som } from '../../lib/format';
import { amountOf, endOfDayIso, MOVEMENT_LABELS, parseQty, unitOf } from '../../lib/inventory';
import { STOCK_UNIT_LABELS } from '../../lib/labels';
import { Drawer } from '../Drawer';
import { Seg, Switch } from '../ui';

type Saved = (text: string) => void;

const digits = (value: string) => Number(value.replace(/\D/g, '')) || 0;
const failText = (e: unknown, fallback: string) => (e instanceof RestorApiError ? e.message : fallback);

function useStockRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['stock'] });
    void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Create or edit a tracked item. On create, the opening balance becomes an
 * ADJUSTMENT on the server; on edit there is no quantity at all — a level
 * moves only through a movement.
 */
export function ItemForm({
  item,
  branches,
  branchId,
  categories,
  onClose,
  onSaved,
}: {
  item: StockItem | null;
  branches: BranchSummary[];
  branchId: string;
  categories: string[];
  onClose: () => void;
  onSaved: Saved;
}) {
  const refresh = useStockRefresh();
  const [branch, setBranch] = useState(item?.branchId ?? (branchId || branches[0]?.id || ''));
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<StockUnit>(item?.unit ?? StockUnit.KG);
  const [category, setCategory] = useState(item?.category ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [opening, setOpening] = useState('');
  const [min, setMin] = useState(item?.minQuantity ? qty(item.minQuantity) : '');
  const [cost, setCost] = useState(item?.costPerUnit ? String(item.costPerUnit) : '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        unit,
        category: category.trim() || null,
        sku: sku.trim() || null,
        minQuantity: min.trim() ? parseQty(min) : null,
        costPerUnit: digits(cost),
      };
      return item
        ? api.inventory.updateItem(item.id, { ...body, isActive })
        : api.inventory.createItem({ ...body, branchId: branch, quantity: opening.trim() ? parseQty(opening) : 0 });
    },
    onSuccess: () => {
      refresh();
      onSaved(item ? `“${name.trim()}” saqlandi` : `“${name.trim()}” omborga qoʻshildi`);
    },
    onError: (e) => setError(failText(e, 'Saqlanmadi')),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError('Nomini kiriting');
    if ((min && Number.isNaN(parseQty(min))) || (opening && Number.isNaN(parseQty(opening)))) return setError('Miqdor son boʻlishi kerak');
    setError(null);
    save.mutate();
  }

  return (
    <Drawer
      title={item ? `${item.name} — tahrirlash` : 'Yangi xomashyo'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="item-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form id="item-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        {!item && branches.length > 1 && (
          <div className="field">
            <label htmlFor="if-branch">Filial ombori</label>
            <select id="if-branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="if-name">Nomi</label>
          <input id="if-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mol goʻshti qiymasi" autoFocus />
        </div>
        <div className="field">
          <span className="field__label">Oʻlchov birligi</span>
          <Seg label="Birlik" options={Object.values(StockUnit).map((u) => ({ value: u, label: STOCK_UNIT_LABELS[u] }))} value={unit} onChange={setUnit} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="if-cat">Toifa</label>
            <input id="if-cat" list="if-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Goʻsht" />
            <datalist id="if-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="if-sku">Kod (SKU)</label>
            <input id="if-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="RAW-012" />
          </div>
          {!item && (
            <div className="field">
              <label htmlFor="if-open">Boshlangʻich qoldiq ({unitOf(unit)})</label>
              <input id="if-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
            </div>
          )}
          <div className="field">
            <label htmlFor="if-min">Minimal chegara ({unitOf(unit)})</label>
            <input id="if-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Ogohlantirish chegarasi" />
          </div>
          <div className="field">
            <label htmlFor="if-cost">1 {unitOf(unit)} narxi (soʻm)</label>
            <input id="if-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
          </div>
        </div>
        {item && (
          <>
            <p className="field__hint" style={{ margin: 0 }}>Qoldiq bu yerda oʻzgarmaydi — kirim, hisobdan chiqarish yoki inventarizatsiya orqali.</p>
            <Switch checked={isActive} onChange={setIsActive} label={isActive ? 'Faol' : 'Oʻchirilgan'} />
          </>
        )}
      </form>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

export type MovementKind = 'RECEIPT' | 'WASTE' | 'ADJUSTMENT';

/**
 * A manual movement: a delivery (with cost, use-by date and batch), a
 * write-off, or a correction. Consumption is never posted by hand.
 */
export function MovementForm({
  items,
  kind: initialKind,
  itemId,
  presetQuantity,
  presetComment,
  onClose,
  onSaved,
}: {
  items: StockItem[];
  kind: MovementKind;
  itemId?: string;
  presetQuantity?: string;
  presetComment?: string;
  onClose: () => void;
  onSaved: Saved;
}) {
  const refresh = useStockRefresh();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.inventory.listSuppliers() });
  const [kind, setKind] = useState<MovementKind>(initialKind);
  const [stockItemId, setStockItemId] = useState(itemId ?? items[0]?.id ?? '');
  const [quantity, setQuantity] = useState(presetQuantity ?? '');
  const [direction, setDirection] = useState<'plus' | 'minus'>('minus');
  const [cost, setCost] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [expires, setExpires] = useState('');
  const [batch, setBatch] = useState('');
  const [comment, setComment] = useState(presetComment ?? '');
  const [error, setError] = useState<string | null>(null);

  const item = items.find((i) => i.id === stockItemId);
  const amount = parseQty(quantity);

  const save = useMutation({
    mutationFn: () =>
      api.inventory.addMovement({
        stockItemId,
        type: kind as StockMovementType,
        quantity: kind === 'ADJUSTMENT' && direction === 'minus' ? -amount : amount,
        ...(kind === 'RECEIPT'
          ? {
              costPerUnit: cost ? digits(cost) : undefined,
              supplierId: supplierId || undefined,
              expiresAt: endOfDayIso(expires),
              batchCode: batch.trim() || null,
            }
          : {}),
        comment: comment.trim() || undefined,
      }),
    onSuccess: () => {
      refresh();
      onSaved(`${item?.name}: ${MOVEMENT_LABELS[kind as StockMovementType].toLowerCase()} ${amountOf(String(amount), item?.unit ?? '')}`);
    },
    onError: (e) => setError(failText(e, 'Saqlanmadi')),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!item) return setError('Xomashyoni tanlang');
    if (!(amount > 0)) return setError('Miqdorni kiriting');
    if (kind !== 'RECEIPT' && !comment.trim()) return setError('Sababini yozing');
    setError(null);
    save.mutate();
  }

  return (
    <Drawer
      title={kind === 'RECEIPT' ? 'Yangi kirim' : kind === 'WASTE' ? 'Hisobdan chiqarish' : 'Qoldiqni tuzatish'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="movement-form" className={kind === 'WASTE' ? 'btn btn--danger' : 'btn'} disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form id="movement-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <Seg
          label="Harakat turi"
          options={[
            { value: 'RECEIPT' as MovementKind, label: 'Kirim' },
            { value: 'WASTE' as MovementKind, label: 'Hisobdan chiqarish' },
            { value: 'ADJUSTMENT' as MovementKind, label: 'Tuzatish' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <div className="field">
          <label htmlFor="mf-item">Xomashyo</label>
          <select id="mf-item" value={stockItemId} onChange={(e) => setStockItemId(e.target.value)}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name}{i.branchName ? ` · ${i.branchName}` : ''} — {amountOf(i.quantity, i.unit)}</option>
            ))}
          </select>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="mf-qty">Miqdor{item ? ` (${unitOf(item.unit)})` : ''}</label>
            <input id="mf-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </div>
          {kind === 'ADJUSTMENT' && (
            <div className="field">
              <span className="field__label">Yoʻnalish</span>
              <Seg label="Yoʻnalish" options={[{ value: 'minus' as const, label: 'Kam chiqdi' }, { value: 'plus' as const, label: 'Koʻp chiqdi' }]} value={direction} onChange={setDirection} />
            </div>
          )}
          {kind === 'RECEIPT' && (
            <>
              <div className="field">
                <label htmlFor="mf-cost">1 {item ? unitOf(item.unit) : 'birlik'} narxi (soʻm)</label>
                <input id="mf-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={item?.costPerUnit ? String(item.costPerUnit) : '0'} />
              </div>
              <div className="field">
                <label htmlFor="mf-sup">Taʼminotchi</label>
                <select id="mf-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">—</option>
                  {(suppliers.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="mf-exp">Yaroqlilik muddati</label>
                <input id="mf-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="mf-batch">Partiya raqami</label>
                <input id="mf-batch" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Ixtiyoriy" />
              </div>
            </>
          )}
        </div>
        {kind === 'RECEIPT' && amount > 0 && cost && (
          <p className="muted" style={{ margin: 0 }}>Jami: <b>{som(Math.round(amount * digits(cost)))}</b></p>
        )}
        <div className="field">
          <label htmlFor="mf-comment">{kind === 'RECEIPT' ? 'Izoh' : 'Sabab'}</label>
          <input id="mf-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={kind === 'WASTE' ? 'Muddati oʻtgan, buzilgan, toʻkilgan…' : kind === 'ADJUSTMENT' ? 'Qayta sanaldi' : 'Faktura raqami'} />
        </div>
      </form>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A supplier. The Telegram chat is where purchase orders are posted: create
 * a group with the supplier and the restaurant's bot, and the bot answers
 * `/id` there with the number to paste.
 */
export function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: Saved }) {
  const refresh = useStockRefresh();
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [contact, setContact] = useState(supplier?.contact ?? '');
  const [chat, setChat] = useState(supplier?.telegramChatId ?? '');
  const [comment, setComment] = useState(supplier?.comment ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        phone: phone.replace(/[^\d+]/g, '') || null,
        contact: contact.trim() || null,
        telegramChatId: chat.trim() || null,
        comment: comment.trim() || null,
      };
      return supplier ? api.inventory.updateSupplier(supplier.id, body) : api.inventory.createSupplier(body);
    },
    onSuccess: () => {
      refresh();
      onSaved(supplier ? `“${name.trim()}” saqlandi` : `“${name.trim()}” qoʻshildi`);
    },
    onError: (e) => setError(failText(e, 'Saqlanmadi')),
  });

  return (
    <Drawer
      title={supplier ? `${supplier.name} — tahrirlash` : 'Yangi taʼminotchi'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="supplier-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form
        id="supplier-form"
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) return setError('Nomini kiriting');
          setError(null);
          save.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="sf-name">Nomi</label>
          <input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meat Trade MChJ" autoFocus />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sf-phone">Telefon</label>
            <input id="sf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 71 200 88 99" />
          </div>
          <div className="field">
            <label htmlFor="sf-contact">Masʼul shaxs</label>
            <input id="sf-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sf-chat">Telegram chat ID</label>
          <input id="sf-chat" value={chat} onChange={(e) => setChat(e.target.value)} placeholder="-1001234567890" />
          <span className="field__hint">
            Taʼminotchi va restoran boti bor guruh oching, guruhda <code>/id</code> yozing — bot chat ID ni qaytaradi. Buyurtmalar shu guruhga yuboriladi.
          </span>
        </div>
        <div className="field">
          <label htmlFor="sf-comment">Izoh</label>
          <input id="sf-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Yetkazish kunlari, toʻlov sharti…" />
        </div>
      </form>
    </Drawer>
  );
}
