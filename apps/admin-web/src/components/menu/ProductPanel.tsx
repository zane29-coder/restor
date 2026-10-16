import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
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
  IconPlus,
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
  variants: VariantDraft[];
  isActive: boolean;
}

interface VariantDraft {
  id?: string;
  name: string;
  priceDelta: string;
  isDefault: boolean;
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
    variants: product?.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      priceDelta: String(variant.priceDelta),
      isDefault: variant.isDefault,
    })) ?? [],
    isActive: product?.isActive ?? true,
  };
}

function signedDigits(value: string): number {
  const amount = Number(value.replace(/\D/g, '')) || 0;
  return value.trimStart().startsWith('-') ? -amount : amount;
}

function signedInput(value: string): string {
  const amount = value.replace(/\D/g, '');
  return `${value.trimStart().startsWith('-') ? '-' : ''}${amount}`;
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
              : draft.variants.some((variant) => variant.name.trim().length === 0)
                ? 'Har bir variant nomini kiriting'
                : draft.variants.some((variant) => {
                      const delta = signedDigits(variant.priceDelta);
                      return delta < -2_147_483_648 || delta > 2_147_483_647;
                    })
                  ? 'Variant narx farqi -2 147 483 648 dan 2 147 483 647 gacha bo‘lishi mumkin'
              : null;

  const variantsPayload = () =>
    draft.variants.map((variant, index) => ({
      ...(variant.id ? { id: variant.id } : {}),
      name: variant.name.trim(),
      priceDelta: signedDigits(variant.priceDelta),
      isDefault: variant.isDefault,
      sortOrder: index,
    }));

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
        const variants = variantsPayload().map(({ id: _id, ...variant }) => variant);
        return api.catalog.createProduct({ ...payload(), price, variants });
      }
      return api.catalog.updateProduct(product.id, {
        ...payload(),
        isActive: draft.isActive,
        ...(canPrice ? { variants: variantsPayload() } : {}),
      });
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
        <ImageBlock product={product} canEdit={can(Permission.PRODUCTS_UPDATE)} onChanged={invalidate} />
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

      <form id="product-form" onSubmit={submit} className="stack" style={{ gap: 0 }} noValidate>
        <div className="field">
          <label htmlFor="pf-name">Taom nomi</label>
          <input id="pf-name" value={draft.name} disabled={!canEdit} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pf-desc">Tavsif va tarkibi</label>
          <textarea id="pf-desc" rows={3} value={draft.description} disabled={!canEdit} onChange={(e) => set('description', e.target.value)} style={{ resize: 'none' }} />
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
        <VariantEditor
          variants={draft.variants}
          disabled={!canEdit || !canPrice}
          onChange={(variants) => set('variants', variants)}
        />
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

function VariantEditor({
  variants,
  disabled,
  onChange,
}: {
  variants: VariantDraft[];
  disabled: boolean;
  onChange: (variants: VariantDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<VariantDraft>) =>
    onChange(variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)));

  const makeDefault = (index: number) =>
    onChange(variants.map((variant, i) => ({ ...variant, isDefault: i === index })));

  const remove = (index: number) => {
    const removedWasDefault = variants[index]?.isDefault;
    const next = variants.filter((_, i) => i !== index);
    if (removedWasDefault && next[0]) next[0] = { ...next[0], isDefault: true };
    onChange(next);
  };

  const add = () =>
    onChange([...variants, { name: '', priceDelta: '0', isDefault: variants.length === 0 }]);

  return (
    <section className="detail-section variant-editor" aria-labelledby="variant-editor-title">
      <div className="detail-section__title">
        <span id="variant-editor-title">O‘lcham va variantlar ({variants.length} ta)</span>
        {!disabled && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={variants.length >= 20}
            onClick={add}
          >
            <IconPlus size={14} /> Variant qo‘shish
          </button>
        )}
      </div>
      <p className="field__hint variant-editor__hint">
        Masalan, Kichik va Katta. Narx farqi asosiy narxga qo‘shiladi; arzonroq variant uchun minus kiriting.
      </p>
      {variants.length === 0 ? (
        <div className="variant-editor__empty">Variant yo‘q — mahsulot bitta asosiy narxda sotiladi.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {variants.map((variant, index) => {
            const key = variant.id ?? `new-${index}`;
            return (
              <fieldset key={key} className="variant-row" disabled={disabled}>
                <legend>{index + 1}-variant</legend>
                <div className="field variant-row__name">
                  <label htmlFor={`variant-name-${key}`}>Nomi</label>
                  <input
                    id={`variant-name-${key}`}
                    value={variant.name}
                    maxLength={80}
                    placeholder={index === 0 ? 'Kichik' : 'Katta'}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                </div>
                <div className="field variant-row__price">
                  <label htmlFor={`variant-price-${key}`}>Narx farqi</label>
                  <input
                    id={`variant-price-${key}`}
                    value={variant.priceDelta}
                    inputMode="text"
                    placeholder="+5 000 yoki -5 000"
                    onChange={(event) => update(index, { priceDelta: signedInput(event.target.value) })}
                  />
                </div>
                <label className="variant-row__default">
                  <input
                    type="radio"
                    name="default-product-variant"
                    checked={variant.isDefault}
                    onChange={() => makeDefault(index)}
                  />
                  Asosiy
                </label>
                {!disabled && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    aria-label={`${variant.name || `${index + 1}-variant`}ni olib tashlash`}
                    onClick={() => remove(index)}
                  >
                    <IconTrash size={16} />
                  </button>
                )}
              </fieldset>
            );
          })}
        </div>
      )}
      {disabled && <span className="field__hint">Variant narxlarini o‘zgartirish huquqingiz yo‘q.</span>}
    </section>
  );
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function imageFailureReason(caught: unknown): string {
  if (!(caught instanceof RestorApiError)) return 'Kutilmagan xatolik yuz berdi. Qayta urinib ko‘ring.';

  if (caught.status === 413) {
    return caught.code === ErrorCode.FILE_TOO_LARGE
      ? caught.message
      : 'Rasm hajmi server limitidan oshdi. Kichikroq fayl tanlang.';
  }
  if (caught.status === 415) {
    return caught.code === ErrorCode.UNSUPPORTED_FILE_TYPE
      ? caught.message
      : 'Rasm formati serverda qo‘llab-quvvatlanmaydi. JPEG, PNG, WebP yoki AVIF tanlang.';
  }
  if (caught.status === 401) return 'Tizimga kirish muddati tugagan. Qayta kiring va yana urinib ko‘ring.';
  if (caught.status === 403) return 'Rasm yuklash uchun sizda ruxsat yo‘q.';
  if (caught.status === 400) {
    return caught.code === ErrorCode.BAD_REQUEST
      ? caught.message
      : 'Server rasm faylini o‘qiy olmadi. Boshqa rasm tanlang.';
  }

  switch (caught.code) {
    case ErrorCode.FILE_TOO_LARGE:
      return caught.message;
    case ErrorCode.UNSUPPORTED_FILE_TYPE:
      return caught.message;
    case 'NETWORK_ERROR':
      return 'Internet aloqasi uzildi. Ulanishni tekshirib, qayta urinib ko‘ring.';
    case 'TIMEOUT':
      return 'Rasmni yuborish vaqti tugadi. Ulanishni tekshirib, qayta urinib ko‘ring.';
    case ErrorCode.FORBIDDEN:
    case ErrorCode.PERMISSION_DENIED:
      return 'Rasmni o‘zgartirish uchun sizda ruxsat yo‘q.';
    default:
      if (caught.status >= 500) return 'Rasm saqlash xizmati javob bermadi. Keyinroq qayta urinib ko‘ring.';
      return `Server rasmni rad etdi (${caught.code}). Boshqa fayl tanlab ko‘ring.`;
  }
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
}: {
  product: Product;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    // 5 MB: a phone photo straight from the camera is often 8-12 MB, and
    // sending that for a menu thumbnail wastes the kitchen's data plan.
    if (file.size === 0) return setUploadError('Tanlangan rasm fayli bo‘sh. Boshqa fayl tanlang.');
    if (file.size > MAX_IMAGE_BYTES) {
      return setUploadError(`Rasm hajmi ${(file.size / (1024 * 1024)).toFixed(1)} MB. Limit 5 MB.`);
    }
    if (file.type && !IMAGE_TYPES.has(file.type)) {
      return setUploadError(`“${file.type}” formati qabul qilinmaydi. JPEG, PNG, WebP yoki AVIF tanlang.`);
    }

    setUploadError(null);
    setBusy(true);
    try {
      const uploaded = await api.catalog.uploadImage(file, file.name);
      try {
        await api.catalog.updateProduct(product.id, { imageUrl: uploaded.url });
        onChanged();
      } catch (caught) {
        setUploadError(`Rasm yuklandi, lekin mahsulotga biriktirilmadi. ${imageFailureReason(caught)}`);
      }
    } catch (caught) {
      setUploadError(imageFailureReason(caught));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setUploadError(null);
    setBusy(true);
    try {
      await api.catalog.updateProduct(product.id, { imageUrl: null });
      onChanged();
    } catch (caught) {
      setUploadError(`Rasm olib tashlanmadi. ${imageFailureReason(caught)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Mahsulot rasmi">
      {/* Fixed height prevents the panel grid row collapsing while the image loads. */}
      <div style={{ position: 'relative', height: 190, borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface-low)' }}>
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={`${product.name} rasmi`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-subtle)' }}>
            <IconImage size={34} strokeWidth={1.4} />
            <span style={{ fontSize: 12 }}>Rasm yo‘q</span>
          </div>
        )}
        {canEdit && (
          <div className="row" style={{ position: 'absolute', right: 10, bottom: 10, gap: 6 }}>
            {product.imageUrl && (
              <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void clear()}>
                Olib tashlash
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              aria-label="Mahsulot rasmini tanlash"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                // Reset so re-selecting the same file fires change again.
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn--sm btn--dark"
              disabled={busy}
              aria-busy={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconImage size={14} />
              {busy ? 'Yuklanmoqda…' : product.imageUrl ? 'Almashtirish' : 'Rasm yuklash'}
            </button>
          </div>
        )}
      </div>
      <span className="field__hint">JPEG, PNG, WebP yoki AVIF · ko‘pi bilan 5 MB</span>
      {uploadError && <div className="alert alert--error" role="alert">{uploadError}</div>}
    </section>
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
