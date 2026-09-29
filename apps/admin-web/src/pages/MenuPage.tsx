import { useState } from 'react';
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
 * Covers the operations a manager performs daily: browsing the catalog,
 * toggling a product's stop-list at a branch, and adding a product. Variant
 * and modifier editing stay in Phase 2's follow-up work — the API supports
 * them, this screen just does not expose the editor yet.
 */
export function MenuPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [categoryId, setCategoryId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
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

      {isCreating && (
        <CreateProductForm
          categories={categories.data ?? []}
          onDone={() => {
            setIsCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
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
