import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { IconClose, IconPlus } from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Empty, Loading } from '../components/States';

/**
 * Menu management (TZ §9).
 *
 * Everything a manager does to the catalog: browse it, change a price, add or
 * retire a product, reorganise categories, and stop-list something that ran
 * out at one branch.
 *
 * Changing a price is the operation that matters most here — it is the one a
 * restaurant performs weekly, and until this screen supported it the only way
 * was a database edit. Variants and modifier groups remain API-only.
 */
export function MenuPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [categoryId, setCategoryId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<MenuProductRow | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.catalog.listCategories({ includeInactive: true }),
  });

  const branches = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
  });

  const products = useQuery({
    queryKey: ['products', categoryId],
    queryFn: () => api.catalog.listProducts({ categoryId: categoryId || undefined, limit: 100 }),
  });

  const toggleStopList = useMutation({
    mutationFn: ({ productId, isStopListed }: { productId: string; isStopListed: boolean }) =>
      api.catalog.setAvailability(productId, { branchId, isStopListed }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (caught) =>
      setError(caught instanceof RestorApiError ? caught.message : 'Amal bajarilmadi'),
  });

  if (products.isLoading || categories.isLoading) return <Loading />;
  if (products.isError) {
    return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;
  }

  const items = products.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row">
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
        >
          <option value="">Barcha kategoriyalar</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name} ({category.productCount ?? 0})
            </option>
          ))}
        </select>

        {/* Stop-listing is per branch, so the action needs one selected. */}
        <select
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
        >
          <option value="">Stop-list uchun filial tanlang</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>

        <div className="spacer" />

        {can(Permission.CATEGORIES_UPDATE) && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShowCategories((value) => !value)}
          >
            Kategoriyalar
          </button>
        )}

        {can(Permission.PRODUCTS_CREATE) && (
          <button type="button" className="btn" onClick={() => setIsCreating((value) => !value)}>
            {isCreating ? (
              <>
                <IconClose size={16} />
                Bekor qilish
              </>
            ) : (
              <>
                <IconPlus size={16} />
                Mahsulot
              </>
            )}
          </button>
        )}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {showCategories && (
        <CategoryManager
          categories={categories.data ?? []}
          canCreate={can(Permission.CATEGORIES_CREATE)}
          canDelete={can(Permission.CATEGORIES_DELETE)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ['categories'] });
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
          onError={setError}
        />
      )}

      {isCreating && (
        <CreateProductForm
          categories={categories.data ?? []}
          onDone={() => {
            setIsCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}

      {editing && (
        <ProductEditor
          product={editing}
          categories={categories.data ?? []}
          canEditPrice={can(Permission.PRODUCTS_PRICE_UPDATE)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setError(null);
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
          onError={setError}
        />
      )}

      {items.length === 0 ? (
        <Empty title="Mahsulot yoʻq" description="Yangi mahsulot qoʻshing." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nomi</th>
                <th>Kategoriya</th>
                <th>Narxi</th>
                <th>Tayyorlash</th>
                <th>Variantlar</th>
                <th>Holat</th>
                <th>Stop-list</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((product) => {
                const setting = product.branchSettings?.find((entry) => entry.branchId === branchId);
                const stopped = setting?.isStopListed ?? false;

                return (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      {product.description && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {product.description}
                        </div>
                      )}
                    </td>
                    <td>{product.category?.name ?? '—'}</td>
                    <td>
                      {product.discountPrice ? (
                        <>
                          <strong>{formatMoney(product.discountPrice)}</strong>{' '}
                          <s className="muted">{formatMoney(product.price)}</s>
                        </>
                      ) : (
                        formatMoney(product.price)
                      )}
                    </td>
                    <td>{product.preparationTime} min</td>
                    <td>{product.variants.length || '—'}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: product.isActive ? '#DCFCE7' : '#FEE2E2',
                          color: product.isActive ? '#166534' : '#991B1B',
                        }}
                      >
                        {product.isActive ? 'Faol' : 'Oʻchiq'}
                      </span>
                    </td>
                    <td>
                      {!branchId ? (
                        <span className="muted">filial tanlang</span>
                      ) : can(Permission.PRODUCTS_AVAILABILITY_UPDATE) ? (
                        <button
                          type="button"
                          className={stopped ? 'btn btn--danger' : 'btn btn--ghost'}
                          style={{ padding: '5px 10px', minHeight: 30, fontSize: 12 }}
                          disabled={toggleStopList.isPending}
                          onClick={() =>
                            toggleStopList.mutate({
                              productId: product.id,
                              isStopListed: !stopped,
                            })
                          }
                        >
                          {stopped ? 'Tugadi' : 'Bor'}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {can(Permission.PRODUCTS_UPDATE) && (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          style={{ padding: '5px 10px', minHeight: 30, fontSize: 12 }}
                          onClick={() => setEditing(product)}
                        >
                          Tahrirlash
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateProductForm({
  categories,
  onDone,
}: {
  categories: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [price, setPrice] = useState('');
  const [preparationTime, setPreparationTime] = useState('10');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.catalog.createProduct({
        categoryId,
        name: name.trim(),
        // Prices are integers in minor units everywhere (TZ §40).
        price: Math.round(Number(price)),
        preparationTime: Number(preparationTime),
      }),
    onSuccess: onDone,
    onError: (caught) =>
      setError(caught instanceof RestorApiError ? caught.message : 'Saqlanmadi'),
  });

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      <h2 style={{ fontSize: 15, margin: '0 0 14px' }}>Yangi mahsulot</h2>
      {error && <div className="alert alert--error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <div className="field">
          <label htmlFor="p-name">Nomi</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="p-cat">Kategoriya</label>
          <select id="p-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-price">Narxi (UZS)</label>
          <input
            id="p-price"
            type="number"
            min="0"
            step="1000"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="p-prep">Tayyorlash (min)</label>
          <input
            id="p-prep"
            type="number"
            min="0"
            max="240"
            value={preparationTime}
            onChange={(e) => setPreparationTime(e.target.value)}
            required
          />
        </div>
      </div>

      <button type="submit" className="btn" disabled={create.isPending}>
        {create.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/** The product shape this screen renders; kept loose so the list query drives it. */
type MenuProductRow = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  price: number;
  discountPrice: number | null;
  preparationTime: number;
  isActive: boolean;
};

/**
 * Editing a product.
 *
 * Price sits behind its own permission (`products.price.update`), separately
 * from the rest. That is not decoration: a shift manager who may fix a typo in
 * a description has no business repricing the menu, and the two are different
 * kinds of mistake. When the permission is absent the field is shown but
 * disabled, so the person can still see what the price is.
 *
 * Deactivating is offered instead of deleting wherever it will do. A product
 * that has been sold appears on past orders and in reports; removing it makes
 * yesterday's figures unexplainable, while an inactive product simply stops
 * being orderable.
 */
function ProductEditor({
  product,
  categories,
  canEditPrice,
  onClose,
  onSaved,
  onError,
}: {
  product: MenuProductRow;
  categories: Array<{ id: string; name: string }>;
  canEditPrice: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [price, setPrice] = useState(String(product.price));
  const [discountPrice, setDiscountPrice] = useState(
    product.discountPrice != null ? String(product.discountPrice) : '',
  );
  const [preparationTime, setPreparationTime] = useState(String(product.preparationTime));
  const [isActive, setIsActive] = useState(product.isActive);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const priceValue = digits(price);
  const discountValue = discountPrice.trim() ? digits(discountPrice) : null;

  // A "discount" above the price would quietly raise the bill.
  const discountError =
    discountValue != null && discountValue >= priceValue
      ? 'Chegirma narxi asosiy narxdan past boʻlishi kerak'
      : null;
  const priceError = priceValue <= 0 ? 'Narx noldan katta boʻlishi kerak' : null;

  const save = useMutation({
    mutationFn: () =>
      api.catalog.updateProduct(product.id, {
        name: name.trim(),
        description: description.trim() || null,
        categoryId,
        ...(canEditPrice ? { price: priceValue, discountPrice: discountValue } : {}),
        preparationTime: digits(preparationTime),
        isActive,
      }),
    onSuccess: onSaved,
    onError: (caught) =>
      onError(caught instanceof RestorApiError ? caught.message : 'Saqlanmadi'),
  });

  const remove = useMutation({
    mutationFn: () => api.catalog.deleteProduct(product.id),
    onSuccess: onSaved,
    onError: (caught) =>
      onError(caught instanceof RestorApiError ? caught.message : 'Oʻchirilmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (priceError || discountError || name.trim().length < 2) return;
    save.mutate();
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{product.name}</h3>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Yopish
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
        }}
      >
        <Labelled label="Nomi">
          <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
        </Labelled>

        <Labelled label="Kategoriya">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            style={fieldStyle}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Labelled>

        <Labelled
          label="Narxi"
          hint={canEditPrice ? undefined : 'Narx oʻzgartirish huquqingiz yoʻq'}
          error={canEditPrice ? priceError : null}
        >
          <input
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={!canEditPrice}
            style={fieldStyle}
          />
        </Labelled>

        <Labelled label="Chegirma narxi" hint="Boʻsh — chegirma yoʻq" error={discountError}>
          <input
            inputMode="numeric"
            value={discountPrice}
            onChange={(e) => setDiscountPrice(e.target.value)}
            disabled={!canEditPrice}
            placeholder="—"
            style={fieldStyle}
          />
        </Labelled>

        <Labelled label="Tayyorlash (min)">
          <input
            inputMode="numeric"
            value={preparationTime}
            onChange={(e) => setPreparationTime(e.target.value)}
            style={fieldStyle}
          />
        </Labelled>

        <Labelled label="Tavsif">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="—"
            style={fieldStyle}
          />
        </Labelled>
      </div>

      <label className="row" style={{ gap: 8, marginTop: 14, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Faol — menyuda koʻrinadi va buyurtma qilinadi
      </label>

      <div className="row" style={{ marginTop: 16, gap: 10 }}>
        <button
          type="submit"
          className="btn"
          disabled={save.isPending || Boolean(priceError) || Boolean(discountError)}
        >
          {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>

        <div className="spacer" />

        {confirmDelete ? (
          <>
            <span className="muted" style={{ fontSize: 13 }}>
              Butunlay oʻchirilsinmi?
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmDelete(false)}
            >
              Yoʻq
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Ha, oʻchirish
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setConfirmDelete(true)}
          >
            Oʻchirish
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Categories.
 *
 * Inline rename rather than a dialog: renaming is the whole job most of the
 * time, and a dialog per row would be three clicks for a one-word change.
 */
function CategoryManager({
  categories,
  canCreate,
  canDelete,
  onChanged,
  onError,
}: {
  categories: Array<{ id: string; name: string; sortOrder?: number; productCount?: number }>;
  canCreate: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [newName, setNewName] = useState('');

  const fail = (caught: unknown, fallback: string) =>
    onError(caught instanceof RestorApiError ? caught.message : fallback);

  const create = useMutation({
    mutationFn: () =>
      api.catalog.createCategory({ name: newName.trim(), sortOrder: categories.length }),
    onSuccess: () => {
      setNewName('');
      onChanged();
    },
    onError: (caught) => fail(caught, 'Kategoriya qoʻshilmadi'),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.catalog.updateCategory(id, { name }),
    onSuccess: onChanged,
    onError: (caught) => fail(caught, 'Nomi oʻzgartirilmadi'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.catalog.deleteCategory(id),
    onSuccess: onChanged,
    onError: (caught) => fail(caught, 'Oʻchirilmadi'),
  });

  return (
    <div className="card">
      <h3 style={{ fontSize: 15, margin: '0 0 12px' }}>Kategoriyalar</h3>

      <div style={{ display: 'grid', gap: 8 }}>
        {categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            canDelete={canDelete}
            isBusy={rename.isPending || remove.isPending}
            onRename={(name) => rename.mutate({ id: category.id, name })}
            onRemove={() => remove.mutate(category.id)}
          />
        ))}
      </div>

      {canCreate && (
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Yangi kategoriya nomi"
            style={{ ...fieldStyle, flex: 1 }}
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
  canDelete,
  isBusy,
  onRename,
  onRemove,
}: {
  category: { id: string; name: string; productCount?: number };
  canDelete: boolean;
  isBusy: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const isDirty = name.trim() !== category.name && name.trim().length >= 2;
  const count = category.productCount ?? 0;

  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ ...fieldStyle, flex: 1 }}
      />
      <span className="muted" style={{ fontSize: 12, minWidth: 70 }}>
        {count} mahsulot
      </span>

      {isDirty && (
        <button
          type="button"
          className="btn"
          style={{ padding: '6px 12px', minHeight: 32, fontSize: 12 }}
          disabled={isBusy}
          onClick={() => onRename(name.trim())}
        >
          Saqlash
        </button>
      )}

      {canDelete &&
        (confirming ? (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ padding: '6px 12px', minHeight: 32, fontSize: 12 }}
              onClick={() => setConfirming(false)}
            >
              Yoʻq
            </button>
            <button
              type="button"
              className="btn btn--danger"
              style={{ padding: '6px 12px', minHeight: 32, fontSize: 12 }}
              disabled={isBusy}
              onClick={onRemove}
            >
              Oʻchirish
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--ghost"
            style={{ padding: '6px 12px', minHeight: 32, fontSize: 12 }}
            // A category holding products would orphan them; the server
            // refuses it, and saying so here avoids a pointless round trip.
            disabled={count > 0}
            title={count > 0 ? 'Avval mahsulotlarni koʻchiring' : undefined}
            onClick={() => setConfirming(true)}
          >
            Oʻchirish
          </button>
        ))}
    </div>
  );
}

function Labelled({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      {(error ?? hint) && (
        <span className="muted" style={{ fontSize: 12, color: error ? '#991B1B' : undefined }}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

const fieldStyle = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 14,
} as const;

/** Digits only: a manager typing "45 000" means forty-five thousand. */
function digits(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}
