import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  PortionUnit,
  type BranchSummary,
  type Category,
  type Product,
} from '@restor/shared-types';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBranch,
  IconImage,
  IconPause,
  IconPlay,
  IconSave,
  IconSliders,
  IconTrash,
} from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dayTimeOf, percent, som } from '../../lib/format';
import { SidePanel, Switch } from '../ui';
import { digits } from './CatalogManagers';
import { availabilityAt } from '../../lib/catalog';

const PORTION_LABELS: Record<PortionUnit, string> = { G: 'gr', ML: 'ml', PCS: 'dona' };

interface Draft {
  name: string;
  description: string;
  categoryId: string;
  price: string;
  discountPrice: string;
  preparationTime: string;
  portionSize: string;
  portionUnit: PortionUnit | '';
  isActive: boolean;
}

function draftOf(product: Product | null, fallbackCategory: string): Draft {
  return {
    name: product?.name ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? fallbackCategory,
    price: product ? String(product.price) : '',
    discountPrice: product?.discountPrice != null ? String(product.discountPrice) : '',
    preparationTime: String(product?.preparationTime ?? 10),
    portionSize: product?.portionSize != null ? String(product.portionSize) : '',
    portionUnit: product?.portionUnit ?? '',
    isActive: product?.isActive ?? true,
  };
}

/**
 * Create or edit one dish, beside the catalogue.
 *
 * Price sits behind its own permission (`products.price.update`), separately
 * from the rest: a shift manager who may fix a typo in a description has no
 * business repricing the menu. Without it the field is shown but disabled, so
 * the price can still be read.
 *
 * Stop-list toggles act immediately per branch — that is what the floor uses
 * mid-service — while the form fields wait for "Saqlash".
 */
export function ProductPanel({
  product,
  categories,
  branches,
  currentBranchId,
  onClose,
  onCreated,
  onPrev,
  onNext,
}: {
  /** `null` opens the panel in create mode. */
  product: Product | null;
  categories: Category[];
  branches: BranchSummary[];
  currentBranchId: string;
  onClose: () => void;
  onCreated: (product: Product) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(product, categories[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Switching to another product resets the form to that product.
  useEffect(() => {
    setDraft(draftOf(product, categories[0]?.id ?? ''));
    setError(null);
    setSaved(false);
    setConfirmDelete(false);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCreate = product === null;
  const canEdit = isCreate ? can(Permission.PRODUCTS_CREATE) : can(Permission.PRODUCTS_UPDATE);
  const canPrice = isCreate || can(Permission.PRODUCTS_PRICE_UPDATE);
  const canStop = can(Permission.PRODUCTS_AVAILABILITY_UPDATE);

  const recipe = useQuery({
    queryKey: ['recipe', product?.id],
    queryFn: () => api.inventory.getRecipe(product!.id),
    enabled: !isCreate && can(Permission.INVENTORY_VIEW),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['products'] });
  const fail = (caught: unknown, fallback: string) =>
    setError(caught instanceof RestorApiError ? caught.message : fallback);

  const price = digits(draft.price);
  const discount = draft.discountPrice.trim() ? digits(draft.discountPrice) : null;
  const portion = draft.portionSize.trim() ? digits(draft.portionSize) : null;
  const validation =
    draft.name.trim().length < 2
      ? 'Taom nomini kiriting'
      : !draft.categoryId
        ? 'Kategoriyani tanlang'
        : price <= 0
          ? 'Narx noldan katta boʻlishi kerak'
          : discount !== null && discount >= price
            ? 'Chegirma narxi asosiy narxdan past boʻlishi kerak'
            : (portion === null) !== (draft.portionUnit === '')
              ? 'Porsiya miqdori va birligini birga kiriting'
              : null;

  const payload = () => ({
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    categoryId: draft.categoryId,
    ...(canPrice ? { price, discountPrice: discount } : {}),
    preparationTime: digits(draft.preparationTime),
    portionSize: portion,
    portionUnit: draft.portionUnit || null,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isCreate) {
        return api.catalog.createProduct({ ...payload(), price });
      }
      return api.catalog.updateProduct(product.id, { ...payload(), isActive: draft.isActive });
    },
    onSuccess: (result) => {
      setError(null);
      invalidate();
      if (isCreate) onCreated(result);
      else setSaved(true);
    },
    onError: (caught) => fail(caught, 'Saqlanmadi'),
  });

  const remove = useMutation({
    mutationFn: () => api.catalog.deleteProduct(product!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (caught) => fail(caught, 'Oʻchirilmadi'),
  });

  const availability = useMutation({
    mutationFn: (payload: { branchId: string; isStopListed?: boolean; isAvailable?: boolean }) =>
      api.catalog.setAvailability(product!.id, payload),
    onSuccess: invalidate,
    onError: (caught) => fail(caught, 'Stop-list oʻzgarmadi'),
  });

  const stateAt = (branchId: string) => (product ? availabilityAt(product, branchId) : 'off');
  const stoppedAt = (branchId: string) => stateAt(branchId) === 'stopped';
  // Stop-listing only means something where the dish is sold at all.
  const scopeBranches = (currentBranchId ? branches.filter((b) => b.id === currentBranchId) : branches).filter(
    (b) => stateAt(b.id) !== 'off',
  );
  const allStopped = scopeBranches.length > 0 && scopeBranches.every((b) => stoppedAt(b.id));

  const setAll = async (isStopListed: boolean) => {
    for (const branch of scopeBranches) {
      await availability.mutateAsync({ branchId: branch.id, isStopListed }).catch(() => undefined);
    }
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (validation) return setError(validation);
    save.mutate();
  }

  const category = categories.find((c) => c.id === (product?.categoryId ?? draft.categoryId));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  return (
    <SidePanel
      title={isCreate ? 'Yangi taom' : 'Taom tafsilotlari'}
      sub={product ? `Oxirgi oʻzgarish: ${dayTimeOf(product.updatedAt)}` : 'Asosiy maʼlumotlarni kiriting, keyin rasm va stop-list'}
      onClose={onClose}
      headerExtra={
        !isCreate && (
          <>
            <button type="button" className="icon-btn icon-btn--sm" aria-label="Oldingi taom" disabled={!onPrev} onClick={onPrev}>
              <IconArrowLeft size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" aria-label="Keyingi taom" disabled={!onNext} onClick={onNext}>
              <IconArrowRight size={16} />
            </button>
          </>
        )
      }
      footer={
        <>
          {error && <div className="alert alert--error" style={{ margin: 0 }} role="alert">{error}</div>}
          {saved && <div className="alert alert--info" style={{ margin: 0 }} role="status">Saqlandi</div>}
          {canEdit && (
            <button type="submit" form="product-form" className="btn btn--block" disabled={save.isPending}>
              <IconSave size={17} />
              {save.isPending ? 'Saqlanmoqda…' : isCreate ? 'Taomni yaratish' : 'Saqlash'}
            </button>
          )}
          {!isCreate && canStop && scopeBranches.length > 0 && (
            <button
              type="button"
              className={`btn btn--block ${allStopped ? 'btn--soft' : 'btn--ghost'}`}
              disabled={availability.isPending}
              onClick={() => void setAll(!allStopped)}
            >
              {allStopped ? <IconPlay size={17} /> : <IconPause size={17} />}
              {allStopped ? 'Stop-listdan chiqarish' : 'Stop-listga kiritish'}
              {!currentBranchId && branches.length > 1 ? ' (barcha filiallar)' : ''}
            </button>
          )}
          {!isCreate && can(Permission.PRODUCTS_DELETE) &&
            (confirmDelete ? (
              <div className="row" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 13, flex: 1 }}>Taom menyudan oʻchirilsinmi? Oʻtgan buyurtmalar saqlanadi.</span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirmDelete(false)}>Yoʻq</button>
                <button type="button" className="btn btn--sm btn--danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Ha</button>
              </div>
            ) : (
              <button type="button" className="btn btn--danger-soft btn--block" onClick={() => setConfirmDelete(true)}>
                <IconTrash size={16} /> Oʻchirish
              </button>
            ))}
        </>
      }
    >
      {!isCreate && (
        <ImageBlock product={product} canEdit={can(Permission.PRODUCTS_UPDATE)} onChanged={invalidate} onError={setError} />
      )}

      {!isCreate && (
        <>
          <div>
            <span className="pill tone-primary">{category?.name ?? '—'}</span>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{product.name}</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div className="soft-box stat-mini">
              <span className="stat-mini__label">Asosiy narx</span>
              <span className="stat-mini__value">{som(product.discountPrice ?? product.price)}</span>
              {product.discountPrice != null && <s className="cell-sub">{som(product.price)}</s>}
            </div>
            <div className="soft-box stat-mini">
              <span className="stat-mini__label">Tannarx</span>
              {recipe.data && recipe.data.ingredients.length > 0 ? (
                <>
                  <span className="stat-mini__value">{som(recipe.data.totalCost)}</span>
                  <span className="cell-sub" style={{ color: recipe.data.margin < 0 ? 'var(--danger-ink)' : 'var(--success-ink)' }}>
                    Marja: {percent(recipe.data.marginPercent)}
                  </span>
                </>
              ) : (
                <>
                  <span className="stat-mini__value">—</span>
                  <span className="cell-sub">{can(Permission.INVENTORY_VIEW) ? 'Retsept yoʻq' : 'Ruxsat yoʻq'}</span>
                </>
              )}
            </div>
            <div className="soft-box stat-mini">
              <span className="stat-mini__label">Tayyorlash</span>
              <span className="stat-mini__value">{product.preparationTime} daq</span>
              <span className="cell-sub">Oshxona meʼyori</span>
            </div>
          </div>
        </>
      )}

      <form id="product-form" onSubmit={submit} className="stack" style={{ gap: 0 }}>
        <div className="field">
          <label htmlFor="pf-name">Taom nomi</label>
          <input id="pf-name" value={draft.name} disabled={!canEdit} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pf-desc">Tavsif va tarkibi</label>
          <textarea id="pf-desc" rows={2} value={draft.description} disabled={!canEdit} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pf-cat">Kategoriya</label>
            <select id="pf-cat" value={draft.categoryId} disabled={!canEdit} onChange={(e) => set('categoryId', e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-prep">Tayyorlash (daq)</label>
            <input id="pf-prep" inputMode="numeric" value={draft.preparationTime} disabled={!canEdit} onChange={(e) => set('preparationTime', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-price">Narxi (soʻm)</label>
            <input id="pf-price" inputMode="numeric" value={draft.price} disabled={!canEdit || !canPrice} onChange={(e) => set('price', e.target.value)} />
            {!canPrice && <span className="field__hint">Narxni oʻzgartirish huquqingiz yoʻq</span>}
          </div>
          <div className="field">
            <label htmlFor="pf-disc">Chegirma narxi</label>
            <input id="pf-disc" inputMode="numeric" placeholder="—" value={draft.discountPrice} disabled={!canEdit || !canPrice} onChange={(e) => set('discountPrice', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-portion">Porsiya</label>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input id="pf-portion" inputMode="numeric" placeholder="450" value={draft.portionSize} disabled={!canEdit} onChange={(e) => set('portionSize', e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <select value={draft.portionUnit} disabled={!canEdit} onChange={(e) => set('portionUnit', e.target.value as PortionUnit | '')} aria-label="Porsiya birligi">
                <option value="">—</option>
                {Object.values(PortionUnit).map((u) => (
                  <option key={u} value={u}>{PORTION_LABELS[u]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {!isCreate && (
          <Switch
            checked={draft.isActive}
            disabled={!canEdit}
            onChange={(v) => set('isActive', v)}
            label="Faol — menyuda koʻrinadi va buyurtma qilinadi"
          />
        )}
      </form>

      {!isCreate && can(Permission.PRODUCTS_UPDATE) && (
        <ModifierPicker product={product} onChanged={invalidate} onError={setError} />
      )}

      {!isCreate && branches.length > 0 && (
        <section className="detail-section">
          <div className="detail-section__title">
            <span className="row" style={{ gap: 6 }}><IconBranch size={14} /> Filiallar boʻyicha stop-list</span>
            <span>{branches.length} ta filial</span>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {branches.map((branch) => {
              const state = stateAt(branch.id);
              const setting = product.branchSettings?.find((s) => s.branchId === branch.id);
              return (
                <div key={branch.id} className="soft-box row" style={{ flexWrap: 'nowrap', padding: '10px 12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cell-main">{branch.name}</div>
                    <div
                      className="cell-sub"
                      style={{ color: state === 'stopped' ? 'var(--danger-ink)' : state === 'selling' ? 'var(--success-ink)' : undefined }}
                    >
                      {state === 'off' ? 'Bu filialda sotilmaydi' : state === 'stopped' ? 'Stop-list — tugagan' : 'Sotuvda'}
                      {setting?.priceOverride != null && ` · narx ${som(setting.priceOverride)}`}
                    </div>
                  </div>
                  {canStop &&
                    (state === 'off' ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--soft"
                        disabled={availability.isPending}
                        onClick={() => availability.mutate({ branchId: branch.id, isAvailable: true, isStopListed: false })}
                      >
                        Sotuvga qoʻshish
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          title="Bu filial menyusidan butunlay olib tashlash"
                          disabled={availability.isPending}
                          onClick={() => availability.mutate({ branchId: branch.id, isAvailable: false })}
                        >
                          Olib tashlash
                        </button>
                        <Switch
                          checked={state === 'selling'}
                          disabled={availability.isPending}
                          onChange={(available) => availability.mutate({ branchId: branch.id, isStopListed: !available })}
                          title={state === 'stopped' ? 'Stop-listdan chiqarish' : 'Stop-listga kiritish'}
                        />
                      </>
                    ))}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </SidePanel>
  );
}

/**
 * Product photo.
 *
 * Two steps on purpose: the file is uploaded first and the returned URL is
 * then patched onto the product. A single combined endpoint would have to
 * either hold the upload until the product saves, or leave an orphaned file
 * behind when the save fails.
 */
function ImageBlock({
  product,
  canEdit,
  onChanged,
  onError,
}: {
  product: Product;
  canEdit: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    // 5 MB: a phone photo straight from the camera is often 8-12 MB, and
    // sending that for a menu thumbnail wastes the kitchen's data plan.
    if (file.size > 5 * 1024 * 1024) return onError('Rasm 5 MB dan kichik boʻlishi kerak');
    setBusy(true);
    try {
      const uploaded = await api.catalog.uploadImage(file, file.name);
      await api.catalog.updateProduct(product.id, { imageUrl: uploaded.url });
      onChanged();
    } catch (caught) {
      onError(caught instanceof RestorApiError ? caught.message : 'Rasm yuklanmadi');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await api.catalog.updateProduct(product.id, { imageUrl: null });
      onChanged();
    } catch (caught) {
      onError(caught instanceof RestorApiError ? caught.message : 'Oʻchirilmadi');
    } finally {
      setBusy(false);
    }
  }

  return (
    // A fixed height rather than aspect-ratio: inside the panel's grid an
    // aspect-ratio box collapsed its row and the fields below slid under it.
    <div style={{ position: 'relative', height: 190, borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface-low)' }}>
      {product.imageUrl ? (
        <img src={product.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-subtle)' }}>
          <IconImage size={34} strokeWidth={1.4} />
          <span style={{ fontSize: 12 }}>Rasm yoʻq</span>
        </div>
      )}
      {canEdit && (
        <div className="row" style={{ position: 'absolute', right: 10, bottom: 10, gap: 6 }}>
          {product.imageUrl && (
            <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void clear()}>
              Olib tashlash
            </button>
          )}
          <label className="btn btn--sm btn--dark" style={{ cursor: 'pointer' }}>
            <IconImage size={14} />
            {busy ? 'Yuklanmoqda…' : product.imageUrl ? 'Almashtirish' : 'Rasm yuklash'}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                // Reset so re-selecting the same file fires change again.
                event.target.value = '';
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * Which modifier groups a product offers.
 *
 * Groups are shared across products — "Sauce" is defined once and attached to
 * every dish that takes one — so this attaches and detaches rather than
 * editing; the groups themselves live under "Qoʻshimchalar".
 */
function ModifierPicker({
  product,
  onChanged,
  onError,
}: {
  product: Product;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const groups = useQuery({ queryKey: ['modifier-groups'], queryFn: () => api.catalog.listModifierGroups() });
  const attached = product.modifierGroups.map((g) => g.id);
  const save = useMutation({
    mutationFn: (ids: string[]) => api.catalog.updateProduct(product.id, { modifierGroupIds: ids }),
    onSuccess: onChanged,
    onError: (caught) => onError(caught instanceof RestorApiError ? caught.message : 'Saqlanmadi'),
  });

  const all = groups.data ?? [];

  return (
    <section className="detail-section">
      <div className="detail-section__title">
        <span className="row" style={{ gap: 6 }}><IconSliders size={14} /> Qoʻshimchalar ({attached.length} ta)</span>
      </div>
      {all.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Qoʻshimcha guruhlari yoʻq — “Qoʻshimchalar” tugmasidan yarating.</p>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {all.map((group) => {
            const on = attached.includes(group.id);
            return (
              <label key={group.id} className="row soft-box" style={{ gap: 10, padding: '8px 12px', flexWrap: 'nowrap', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={save.isPending}
                  onChange={() => save.mutate(on ? attached.filter((id) => id !== group.id) : [...attached, group.id])}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="cell-main">{group.name}</span>
                  <span className="cell-sub ellipsis" style={{ display: 'block' }}>
                    {group.modifiers.map((m) => `${m.name}${m.price ? ` +${som(m.price)}` : ''}`).join(', ')}
                  </span>
                </span>
                <span className="pill tone-neutral">{group.minSelect}–{group.maxSelect}</span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}

export { PORTION_LABELS };
