import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, type Product } from '@restor/shared-types';
import {
  IconBan,
  IconClock,
  IconCopy,
  IconDownload,
  IconEdit,
  IconGrid,
  IconImage,
  IconList,
  IconMenu,
  IconPause,
  IconPlay,
  IconPlus,
  IconSearch,
  IconSliders,
  IconTag,
  IconUpload,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { count, som } from '../lib/format';
import { Drawer } from '../components/Drawer';
import { CategoryManager, ModifierGroupManager } from '../components/menu/CatalogManagers';
import { ImportProducts } from '../components/menu/ImportProducts';
import { PORTION_LABELS, ProductPanel } from '../components/menu/ProductPanel';
import { ErrorState, Loading } from '../components/States';
import { Kpi, PageHeader, Pager, Seg, Switch, downloadCsv } from '../components/ui';

type StatusFilter = 'all' | 'active' | 'stopped' | 'inactive';

/**
 * Menu management (TZ §9).
 *
 * The whole catalogue is loaded once (a restaurant menu is hundreds of rows,
 * not thousands) so the category tabs, the stop-list filter and the counts
 * are instant and always agree with each other. Stop-list state is read for
 * the branch chosen in the top bar; with "all branches" a dish counts as
 * stop-listed when it is out anywhere.
 */
export function MenuPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { branchId, branches } = useBranch();
  const [params, setParams] = useSearchParams();

  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [text, setText] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [drawer, setDrawer] = useState<'categories' | 'modifiers' | 'import' | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const openId = params.get('id');
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  const categories = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.catalog.listCategories({ includeInactive: true }),
  });

  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => {
      const all: Product[] = [];
      for (let p = 1; p <= 20; p++) {
        const res = await api.catalog.listProducts({ page: p, limit: 100 });
        all.push(...res.items);
        if (!res.pagination.hasNext) break;
      }
      return all;
    },
  });

  useEffect(() => setPage(1), [categoryId, status, text, branchId, limit]);

  const all = products.data ?? [];
  const scopeIds = branchId ? [branchId] : branches.map((b) => b.id);
  const stoppedAt = (p: Product) =>
    scopeIds.filter((id) => p.branchSettings?.find((s) => s.branchId === id)?.isStopListed);
  const isStopped = (p: Product) => stoppedAt(p).length > 0;

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return all.filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (needle && !`${p.name} ${p.description ?? ''}`.toLowerCase().includes(needle)) return false;
      if (status === 'active' && (!p.isActive || isStopped(p))) return false;
      if (status === 'stopped' && !isStopped(p)) return false;
      if (status === 'inactive' && p.isActive) return false;
      return true;
    });
  }, [all, categoryId, text, status, branchId, branches]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const pageRows = filtered.slice((page - 1) * limit, page * limit);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['products'] });
  const fail = (caught: unknown, fallback: string) =>
    setRowError(caught instanceof RestorApiError ? caught.message : fallback);

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.catalog.updateProduct(id, { isActive }),
    onSuccess: () => {
      setRowError(null);
      invalidate();
    },
    onError: (caught) => fail(caught, 'Saqlanmadi'),
  });

  const toggleStop = useMutation({
    mutationFn: async ({ product, stop }: { product: Product; stop: boolean }) => {
      for (const id of scopeIds) {
        await api.catalog.setAvailability(product.id, { branchId: id, isStopListed: stop });
      }
    },
    onSuccess: () => {
      setRowError(null);
      invalidate();
    },
    onError: (caught) => fail(caught, 'Stop-list oʻzgarmadi'),
  });

  /**
   * A copy starts inactive, so a half-edited duplicate never reaches a guest
   * before someone has renamed and priced it.
   */
  const duplicate = useMutation({
    mutationFn: async (p: Product) => {
      const copy = await api.catalog.createProduct({
        categoryId: p.categoryId,
        name: `${p.name} (nusxa)`,
        description: p.description,
        imageUrl: p.imageUrl,
        price: p.price,
        discountPrice: p.discountPrice,
        preparationTime: p.preparationTime,
        portionSize: p.portionSize,
        portionUnit: p.portionUnit,
        modifierGroupIds: p.modifierGroups.map((g) => g.id),
      });
      return api.catalog.updateProduct(copy.id, { isActive: false });
    },
    onSuccess: (copy) => {
      setRowError(null);
      invalidate();
      open(copy.id);
    },
    onError: (caught) => fail(caught, 'Nusxa olinmadi'),
  });

  if (products.isLoading || categories.isLoading) return <Loading />;
  if (products.isError) return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;

  const cats = categories.data ?? [];
  const weekAgo = Date.now() - 7 * 86_400_000;
  const addedThisWeek = all.filter((p) => new Date(p.createdAt).getTime() > weekAgo).length;
  const stoppedCount = all.filter(isStopped).length;
  const stoppedBranches = new Set(all.flatMap(stoppedAt)).size;
  const avgPrep = all.length ? Math.round(all.reduce((s, p) => s + p.preparationTime, 0) / all.length) : 0;
  const activeCats = cats.filter((c) => c.isActive).length;

  const isCreating = openId === 'new';
  const openProduct = isCreating ? null : all.find((p) => p.id === openId);
  const openIndex = openProduct ? filtered.findIndex((p) => p.id === openProduct.id) : -1;

  return (
    <div className="page">
      <PageHeader
        crumb="Menyu"
        title="Menyu boshqaruvi"
        badge={<span className="pill tone-success">{branches.length} ta filial bilan sinxron</span>}
        subtitle="Taomlar, kategoriyalar, qoʻshimchalar va filiallar boʻyicha stop-list"
        actions={
          <>
            {can(Permission.CATEGORIES_VIEW) && (
              <button type="button" className="btn btn--ghost" onClick={() => setDrawer('categories')}>
                <IconTag size={16} /> Kategoriyalar
              </button>
            )}
            {can(Permission.MODIFIERS_VIEW) && (
              <button type="button" className="btn btn--ghost" onClick={() => setDrawer('modifiers')}>
                <IconSliders size={16} /> Qoʻshimchalar
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={() => exportMenu(all, cats)}>
              <IconDownload size={16} /> Eksport
            </button>
            {can(Permission.PRODUCTS_CREATE) && (
              <>
                <button type="button" className="btn btn--ghost" onClick={() => setDrawer('import')}>
                  <IconUpload size={16} /> Import
                </button>
                <button type="button" className="btn" onClick={() => open('new')}>
                  <IconPlus size={17} /> Yangi taom
                </button>
              </>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi
          label="Jami taomlar"
          value={count(all.length)}
          unit="ta"
          Icon={IconMenu}
          tone="tone-primary"
          foot={<span>{addedThisWeek > 0 ? `+${addedThisWeek} bu hafta` : 'Bu hafta yangi yoʻq'}</span>}
        />
        <Kpi
          label="Faol kategoriyalar"
          value={activeCats}
          unit="boʻlim"
          Icon={IconTag}
          tone="tone-info"
          foot={<span>{cats.length - activeCats > 0 ? `${cats.length - activeCats} ta yashirilgan` : 'Hammasi onlayn'}</span>}
        />
        <Kpi
          label="Stop-listdagi taomlar"
          value={stoppedCount}
          unit="ta"
          Icon={IconBan}
          tone={stoppedCount > 0 ? 'tone-danger' : 'tone-success'}
          alert={stoppedCount > 0}
          foot={
            stoppedCount > 0 ? (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setStatus('stopped')}>
                {stoppedBranches} ta filialda · koʻrish
              </button>
            ) : (
              <span>Hammasi mavjud</span>
            )
          }
        />
        <Kpi
          label="Oʻrtacha tayyorlash"
          value={avgPrep}
          unit="daqiqa"
          Icon={IconClock}
          tone="tone-warning"
          foot={<span>Barcha taomlar boʻyicha meʼyor</span>}
        />
      </div>

      {/* Category tabs */}
      <div className="tabs" role="tablist" aria-label="Kategoriyalar">
        <button
          type="button"
          role="tab"
          aria-selected={categoryId === ''}
          className={`tabs__btn${categoryId === '' ? ' tabs__btn--active' : ''}`}
          onClick={() => setCategoryId('')}
        >
          Barcha taomlar <span className="tabs__count">{all.length}</span>
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={categoryId === c.id}
            className={`tabs__btn${categoryId === c.id ? ' tabs__btn--active' : ''}`}
            onClick={() => setCategoryId(c.id)}
            style={c.isActive ? undefined : { opacity: 0.6 }}
          >
            {c.name}
            <span className="tabs__count">{all.filter((p) => p.categoryId === c.id).length}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search-input">
          <IconSearch size={16} />
          <input
            type="search"
            placeholder="Taom nomi yoki tarkibi boʻyicha qidirish…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Taomlarni qidirish"
          />
        </div>
        <Seg
          label="Holat"
          quiet
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Barchasi' },
            { value: 'active', label: 'Sotuvda' },
            { value: 'stopped', label: 'Stop-list', count: stoppedCount },
            { value: 'inactive', label: 'Nofaol' },
          ]}
        />
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} ta topildi</span>
        <Seg
          label="Koʻrinish"
          quiet
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: <IconList size={16} aria-label="Roʻyxat" /> },
            { value: 'grid', label: <IconGrid size={16} aria-label="Kartochkalar" /> },
          ]}
        />
      </div>

      {rowError && <div className="alert alert--error" style={{ margin: 0 }}>{rowError}</div>}

      <div className={`split${openId ? '' : ' split--single'}`}>
        <section className="card card--flush">
          {filtered.length === 0 ? (
            <p className="muted" style={{ padding: '56px 16px', textAlign: 'center' }}>Bu filtrlar boʻyicha taom topilmadi</p>
          ) : view === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, padding: 14 }}>
              {pageRows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="kanban__card"
                  style={{ padding: 0, overflow: 'hidden', textAlign: 'left', borderColor: p.id === openId ? 'var(--primary)' : undefined }}
                  onClick={() => open(p.id)}
                >
                  <div style={{ aspectRatio: '4 / 3', background: 'var(--surface-low)', display: 'grid', placeItems: 'center', position: 'relative' }}>
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <IconImage size={28} style={{ color: 'var(--text-subtle)' }} />
                    )}
                    {isStopped(p) && <span className="pill tone-danger" style={{ position: 'absolute', top: 8, left: 8 }}>STOP-LIST</span>}
                  </div>
                  <div style={{ padding: '8px 10px 10px', display: 'grid', gap: 2 }}>
                    <span className="cell-main ellipsis">{p.name}</span>
                    <span className="cell-sub">{p.category?.name ?? '—'}</span>
                    <span className="cell-main num" style={{ color: 'var(--primary-ink)' }}>{som(p.discountPrice ?? p.price)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Taom</th>
                    <th>Kategoriya</th>
                    <th className="td-right">Narxi</th>
                    <th>Vaqt</th>
                    <th>Filial holati</th>
                    <th>Faol</th>
                    <th className="td-right">Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => {
                    const stopped = stoppedAt(p);
                    return (
                      <tr key={p.id} className={`row--clickable${p.id === openId ? ' row--selected' : ''}`} onClick={() => open(p.id)}>
                        <td>
                          <div className="cell-person">
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt="" width={40} height={40} style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                            ) : (
                              <span className="avatar tone-neutral" style={{ borderRadius: 8, width: 40, height: 40 }}>
                                <IconImage size={16} />
                              </span>
                            )}
                            <div className="cell-stack" style={{ minWidth: 0 }}>
                              <span className="cell-main row" style={{ gap: 6 }}>
                                {p.name}
                                {stopped.length > 0 && <span className="pill tone-danger">STOP</span>}
                              </span>
                              <span className="cell-sub">
                                {p.portionSize && p.portionUnit ? `${p.portionSize} ${PORTION_LABELS[p.portionUnit]}` : 'Porsiya koʻrsatilmagan'}
                                {p.modifierGroups.length > 0 && ` · ${p.modifierGroups.length} ta qoʻshimcha guruhi`}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td><span className="pill tone-neutral">{p.category?.name ?? '—'}</span></td>
                        <td className="td-right">
                          <div className="cell-stack">
                            <span className="cell-main num">{som(p.discountPrice ?? p.price)}</span>
                            {p.discountPrice != null ? (
                              <s className="cell-sub">{som(p.price)}</s>
                            ) : (
                              <span className="cell-sub">Standart</span>
                            )}
                          </div>
                        </td>
                        <td className="cell-sub"><span className="row" style={{ gap: 4 }}><IconClock size={13} />{p.preparationTime} daq</span></td>
                        <td>
                          {stopped.length === 0 ? (
                            <span className="pill tone-success">{branchId ? 'Mavjud' : 'Barcha filiallarda'}</span>
                          ) : stopped.length === scopeIds.length ? (
                            <span className="pill tone-danger">{branchId ? 'Stop-list' : 'Hamma joyda stop'}</span>
                          ) : (
                            <span className="pill tone-warning">{stopped.length} ta filialda stop</span>
                          )}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <Switch
                            checked={p.isActive}
                            disabled={!can(Permission.PRODUCTS_UPDATE) || toggleActive.isPending}
                            onChange={(isActive) => toggleActive.mutate({ id: p.id, isActive })}
                            title={p.isActive ? 'Faol' : 'Nofaol'}
                          />
                        </td>
                        <td className="td-right" onClick={(event) => event.stopPropagation()}>
                          <div className="row" style={{ gap: 2, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                            <button type="button" className="icon-btn icon-btn--sm" title="Tahrirlash" aria-label="Tahrirlash" onClick={() => open(p.id)}>
                              <IconEdit size={16} />
                            </button>
                            {can(Permission.PRODUCTS_AVAILABILITY_UPDATE) && scopeIds.length > 0 && (
                              <button
                                type="button"
                                className="icon-btn icon-btn--sm"
                                title={stopped.length ? 'Stop-listdan chiqarish' : 'Stop-listga kiritish'}
                                aria-label={stopped.length ? 'Stop-listdan chiqarish' : 'Stop-listga kiritish'}
                                disabled={toggleStop.isPending}
                                onClick={() => toggleStop.mutate({ product: p, stop: stopped.length === 0 })}
                              >
                                {stopped.length ? <IconPlay size={16} /> : <IconPause size={16} />}
                              </button>
                            )}
                            {can(Permission.PRODUCTS_CREATE) && (
                              <button
                                type="button"
                                className="icon-btn icon-btn--sm"
                                title="Nusxa olish"
                                aria-label="Nusxa olish"
                                disabled={duplicate.isPending}
                                onClick={() => duplicate.mutate(p)}
                              >
                                <IconCopy size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="card__foot">
            <span>
              Koʻrsatilmoqda: {filtered.length ? `${(page - 1) * limit + 1}–${Math.min(page * limit, filtered.length)}` : 0} / {filtered.length}
            </span>
            <div className="row" style={{ gap: 10 }}>
              <select value={limit} onChange={(event) => setLimit(Number(event.target.value))} aria-label="Sahifadagi qatorlar" style={{ minHeight: 30 }}>
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} ta</option>)}
              </select>
              <Pager page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          </div>
        </section>

        {(isCreating || openProduct) && (
          <ProductPanel
            product={openProduct ?? null}
            categories={cats}
            branches={branches}
            currentBranchId={branchId}
            onClose={() => open(null)}
            onCreated={(p) => open(p.id)}
            onPrev={openIndex > 0 ? () => open(filtered[openIndex - 1]!.id) : undefined}
            onNext={openIndex >= 0 && openIndex < filtered.length - 1 ? () => open(filtered[openIndex + 1]!.id) : undefined}
          />
        )}
      </div>

      {drawer === 'categories' && (
        <Drawer title="Kategoriyalar" onClose={() => setDrawer(null)}>
          <CategoryManager
            categories={cats}
            canCreate={can(Permission.CATEGORIES_CREATE)}
            canUpdate={can(Permission.CATEGORIES_UPDATE)}
            canDelete={can(Permission.CATEGORIES_DELETE)}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['categories'] });
              invalidate();
            }}
          />
        </Drawer>
      )}
      {drawer === 'modifiers' && (
        <Drawer title="Qoʻshimcha guruhlari" onClose={() => setDrawer(null)}>
          <ModifierGroupManager
            canManage={can(Permission.MODIFIERS_MANAGE)}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
              invalidate();
            }}
          />
        </Drawer>
      )}
      {drawer === 'import' && (
        <Drawer title="Taomlarni import qilish" onClose={() => setDrawer(null)}>
          <ImportProducts
            categories={cats}
            onDone={() => {
              void queryClient.invalidateQueries({ queryKey: ['categories'] });
              invalidate();
            }}
          />
        </Drawer>
      )}
    </div>
  );
}

function exportMenu(products: Product[], categories: Array<{ id: string; name: string }>) {
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  downloadCsv(`menyu_${new Date().toISOString().slice(0, 10)}`, [
    ['Nomi', 'Kategoriya', 'Narxi', 'Tayyorlash (daq)', 'Tavsif', 'Chegirma narxi', 'Porsiya', 'Faol'],
    ...products.map((p) => [
      p.name,
      nameOf(p.categoryId),
      p.price,
      p.preparationTime,
      p.description ?? '',
      p.discountPrice ?? '',
      p.portionSize && p.portionUnit ? `${p.portionSize} ${PORTION_LABELS[p.portionUnit]}` : '',
      p.isActive ? 'ha' : 'yoʻq',
    ]),
  ]);
}
