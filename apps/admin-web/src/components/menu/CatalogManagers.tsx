import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Category } from '@restor/shared-types';
import { IconPlus, IconTrash } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { som } from '../../lib/format';

/** Digits only: a manager typing "45 000" means forty-five thousand. */
export function digits(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}

/**
 * Categories.
 *
 * Inline rename rather than a dialog: renaming is the whole job most of the
 * time, and a dialog per row would be three clicks for a one-word change.
 */
export function CategoryManager({
  categories,
  canCreate,
  canUpdate,
  canDelete,
  onChanged,
}: {
  categories: Category[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fail = (caught: unknown, fallback: string) =>
    setError(caught instanceof RestorApiError ? caught.message : fallback);
  const ok = () => {
    setError(null);
    onChanged();
  };

  const create = useMutation({
    mutationFn: () => api.catalog.createCategory({ name: newName.trim(), sortOrder: categories.length }),
    onSuccess: () => {
      setNewName('');
      ok();
    },
    onError: (caught) => fail(caught, 'Kategoriya qoʻshilmadi'),
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; isActive?: boolean }) =>
      api.catalog.updateCategory(id, payload),
    onSuccess: ok,
    onError: (caught) => fail(caught, 'Saqlanmadi'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.catalog.deleteCategory(id),
    onSuccess: ok,
    onError: (caught) => fail(caught, 'Oʻchirilmadi'),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.catalog.reorderCategories(ids),
    onSuccess: ok,
    onError: (caught) => fail(caught, 'Tartib saqlanmadi'),
  });

  const move = (index: number, delta: number) => {
    const ids = categories.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

  const busy = update.isPending || remove.isPending || reorder.isPending;

  return (
    <div className="stack">
      {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
      <p className="muted" style={{ fontSize: 13 }}>
        Tartib — menyuda koʻrinish tartibi. Oʻchirilgan (nofaol) kategoriya mijozga koʻrinmaydi, lekin taomlari saqlanadi.
      </p>
      {categories.map((category, index) => (
        <CategoryRow
          key={category.id}
          category={category}
          canUpdate={canUpdate}
          canDelete={canDelete}
          busy={busy}
          first={index === 0}
          last={index === categories.length - 1}
          onMove={(delta) => move(index, delta)}
          onSave={(payload) => update.mutate({ id: category.id, ...payload })}
          onRemove={() => remove.mutate(category.id)}
        />
      ))}
      {canCreate && (
        <div className="row" style={{ gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Yangi kategoriya nomi"
            style={{ flex: 1 }}
            aria-label="Yangi kategoriya nomi"
          />
          <button
            type="button"
            className="btn"
            disabled={newName.trim().length < 2 || create.isPending}
            onClick={() => create.mutate()}
          >
            <IconPlus size={16} /> Qoʻshish
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  canUpdate,
  canDelete,
  busy,
  first,
  last,
  onMove,
  onSave,
  onRemove,
}: {
  category: Category;
  canUpdate: boolean;
  canDelete: boolean;
  busy: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onSave: (payload: { name?: string; isActive?: boolean }) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const dirty = name.trim() !== category.name && name.trim().length >= 2;
  const count = category.productCount ?? 0;

  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      {canUpdate && (
        <div style={{ display: 'grid' }}>
          <button type="button" className="icon-btn icon-btn--sm" style={{ height: 18 }} disabled={first || busy} onClick={() => onMove(-1)} aria-label="Yuqoriga">▲</button>
          <button type="button" className="icon-btn icon-btn--sm" style={{ height: 18 }} disabled={last || busy} onClick={() => onMove(1)} aria-label="Pastga">▼</button>
        </div>
      )}
      <input
        value={name}
        disabled={!canUpdate}
        onChange={(event) => setName(event.target.value)}
        style={{ flex: 1, minWidth: 0 }}
        aria-label="Kategoriya nomi"
      />
      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{count} ta</span>
      {canUpdate && (
        <label className="switch" title={category.isActive ? 'Faol' : 'Nofaol'}>
          <input
            type="checkbox"
            role="switch"
            checked={category.isActive}
            disabled={busy}
            onChange={(event) => onSave({ isActive: event.target.checked })}
            aria-label="Faol"
          />
          <span className="switch__track" />
        </label>
      )}
      {dirty && (
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => onSave({ name: name.trim() })}>
          Saqlash
        </button>
      )}
      {canDelete &&
        (confirming ? (
          <>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirming(false)}>Yoʻq</button>
            <button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={onRemove}>Oʻchirish</button>
          </>
        ) : (
          <button
            type="button"
            className="icon-btn icon-btn--sm icon-btn--danger"
            // A category holding products would orphan them; the server
            // refuses it, and saying so here avoids a pointless round trip.
            disabled={count > 0}
            title={count > 0 ? 'Avval taomlarni boshqa kategoriyaga koʻchiring' : 'Oʻchirish'}
            aria-label="Oʻchirish"
            onClick={() => setConfirming(true)}
          >
            <IconTrash size={16} />
          </button>
        ))}
    </div>
  );
}

/**
 * Modifier groups, defined once and reused.
 *
 * `minSelect` and `maxSelect` are the whole point of a group: "Sauce 0-2" is
 * optional and lets a guest pick two, "Size 1-1" forces exactly one choice.
 * Getting those two numbers wrong is how a checkout either blocks a valid
 * order or lets a guest order a pizza with no size.
 */
export function ModifierGroupManager({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useQuery({ queryKey: ['modifier-groups'], queryFn: () => api.catalog.listModifierGroups() });
  const remove = useMutation({
    mutationFn: (id: string) => api.catalog.deleteModifierGroup(id),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (caught) => setError(caught instanceof RestorApiError ? caught.message : 'Oʻchirilmadi'),
  });

  const all = groups.data ?? [];

  return (
    <div className="stack">
      {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
      {all.length === 0 && !creating && (
        <p className="muted" style={{ fontSize: 13 }}>
          Guruh yoʻq. Masalan “Sous 0–2” yoki “Oʻlcham 1–1” — bir marta yaratiladi va koʻp taomga ulanadi.
        </p>
      )}
      {all.map((group) => (
        <div key={group.id} className="soft-box row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <strong>{group.name}</strong>
              <span className="pill tone-info">
                {group.minSelect === group.maxSelect ? `aniq ${group.minSelect} ta` : `${group.minSelect}–${group.maxSelect} ta`}
              </span>
            </div>
            <div className="cell-sub" style={{ marginTop: 4 }}>
              {group.modifiers.map((m) => `${m.name}${m.price ? ` (+${som(m.price)})` : ''}`).join(', ')}
            </div>
          </div>
          {canManage && (
            <button
              type="button"
              className="icon-btn icon-btn--sm icon-btn--danger"
              aria-label={`${group.name} guruhini oʻchirish`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(group.id)}
            >
              <IconTrash size={16} />
            </button>
          )}
        </div>
      ))}
      {canManage &&
        (creating ? (
          <ModifierGroupForm
            onSaved={() => {
              setCreating(false);
              onChanged();
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button type="button" className="btn btn--ghost" style={{ justifySelf: 'start' }} onClick={() => setCreating(true)}>
            <IconPlus size={16} /> Guruh qoʻshish
          </button>
        ))}
    </div>
  );
}

function ModifierGroupForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [minSelect, setMinSelect] = useState('0');
  const [maxSelect, setMaxSelect] = useState('1');
  const [rows, setRows] = useState<Array<{ name: string; price: string }>>([{ name: '', price: '0' }]);
  const [serverError, setServerError] = useState<string | null>(null);

  const modifiers = rows
    .filter((row) => row.name.trim().length > 0)
    .map((row, index) => ({ name: row.name.trim(), price: digits(row.price), sortOrder: index }));
  const min = digits(minSelect);
  const max = digits(maxSelect);

  const error =
    name.trim().length < 2
      ? 'Guruh nomini kiriting'
      : modifiers.length === 0
        ? 'Kamida bitta qoʻshimcha kiriting'
        : min > max
          ? 'Eng kami eng koʻpidan katta boʻlmasligi kerak'
          : max > modifiers.length
            ? `Eng koʻpi ${modifiers.length} dan oshmasligi kerak`
            : null;

  const save = useMutation({
    mutationFn: () => api.catalog.createModifierGroup({ name: name.trim(), minSelect: min, maxSelect: max, modifiers }),
    onSuccess: onSaved,
    onError: (caught) => setServerError(caught instanceof RestorApiError ? caught.message : 'Saqlanmadi'),
  });

  return (
    <div className="soft-box stack">
      <div className="form-grid">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="mg-name">Guruh nomi</label>
          <input id="mg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sous" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="mg-min">Eng kami</label>
          <input id="mg-min" inputMode="numeric" value={minSelect} onChange={(e) => setMinSelect(e.target.value)} />
          <span className="field__hint">0 — ixtiyoriy</span>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="mg-max">Eng koʻpi</label>
          <input id="mg-max" inputMode="numeric" value={maxSelect} onChange={(e) => setMaxSelect(e.target.value)} />
        </div>
      </div>
      {rows.map((row, index) => (
        <div key={index} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <input
            value={row.name}
            onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))}
            placeholder="Ketchup"
            style={{ flex: 1 }}
            aria-label="Qoʻshimcha nomi"
          />
          <input
            inputMode="numeric"
            value={row.price}
            onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, price: e.target.value } : r)))}
            style={{ width: 120 }}
            aria-label="Narxi"
          />
          {rows.length > 1 && (
            <button type="button" className="icon-btn icon-btn--sm" aria-label="Olib tashlash" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
              <IconTrash size={15} />
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={() => setRows([...rows, { name: '', price: '0' }])}>
        <IconPlus size={14} /> Yana bitta
      </button>
      {(serverError ?? error) && <p className="field__error">{serverError ?? error}</p>}
      <div className="row">
        <button type="button" className="btn" disabled={Boolean(error) || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saqlanmoqda…' : 'Guruhni saqlash'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Bekor</button>
      </div>
    </div>
  );
}
