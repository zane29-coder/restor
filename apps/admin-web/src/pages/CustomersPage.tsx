import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, type Customer, type CustomerSegment, type CustomerSummary } from '@restor/shared-types';
import {
  IconBan,
  IconCheck,
  IconDownload,
  IconEdit,
  IconMapPin,
  IconNote,
  IconPhone,
  IconSearch,
  IconStar,
  IconTelegram,
  IconTrendUp,
  IconUsers,
  IconWallet,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { count, dateOf, dayTimeOf, initialsOf, percent, phone, som } from '../lib/format';
import { Drawer } from '../components/Drawer';
import { LoyaltySettings } from '../components/customers/LoyaltySettings';
import { StatusBadge } from '../components/StatusBadge';
import { ErrorState, Loading, Notice } from '../components/States';
import { Kpi, LivePill, PageHeader, Pager, Seg, SidePanel, downloadCsv } from '../components/ui';

type SegmentFilter = 'ALL' | 'VIP' | 'FREQUENT' | 'NEW' | 'INACTIVE_30D';
type Sort = 'recent' | 'spent' | 'orders';

const SEGMENT_META: Record<string, { label: string; tone: string }> = {
  VIP: { label: 'VIP', tone: 'tone-violet' },
  FREQUENT: { label: 'Doimiy', tone: 'tone-success' },
  NEW: { label: 'Yangi', tone: 'tone-info' },
  INACTIVE_30D: { label: 'Yoʻqotilayotgan', tone: 'tone-danger' },
};

/** The most telling segment for one row, by the same rules the API filters on. */
function segmentOf(c: Customer, summary: CustomerSummary | undefined): keyof typeof SEGMENT_META | null {
  if (summary && c.ordersCount >= 1 && summary.vipFrom > 0 && c.totalSpent >= summary.vipFrom) return 'VIP';
  if (c.ordersCount >= 2 && c.lastOrderAt && Date.now() - new Date(c.lastOrderAt).getTime() > 30 * 86_400_000) return 'INACTIVE_30D';
  if (c.ordersCount >= 3) return 'FREQUENT';
  if (c.ordersCount <= 1) return 'NEW';
  return null;
}

/**
 * Customers and loyalty (TZ §10, §31-33).
 *
 * Search stays the primary action — a manager opens this while someone is on
 * the phone, with a number in hand — but the segments make the base usable
 * for more than lookups: who is slipping away, who the best guests are.
 * Segment rules live in the API, so the tab counts and the rows agree.
 */
export function CustomersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<SegmentFilter>('ALL');
  const [sort, setSort] = useState<Sort>('recent');
  const [blocked, setBlocked] = useState(false);
  const [page, setPage] = useState(1);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const limit = 20;

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setPage(1), [search, segment, sort, blocked]);

  const summary = useQuery({ queryKey: ['customers', 'summary'], queryFn: () => api.customers.summary() });
  const program = useQuery({ queryKey: ['loyalty', 'program'], queryFn: () => api.customers.loyaltyProgram(), enabled: can(Permission.LOYALTY_VIEW) });
  const query = {
    search: search || undefined,
    segment: segment === 'ALL' ? undefined : (segment as CustomerSegment),
    sort,
    isBlocked: blocked ? true : undefined,
  };
  const list = useQuery({
    queryKey: ['customers', 'list', query, page],
    queryFn: () => api.customers.list({ ...query, page, limit }),
    placeholderData: (prev) => prev,
  });

  const openId = params.get('id');
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  const exportAll = useMutation({
    mutationFn: async () => {
      const rows: Customer[] = [];
      for (let p = 1; p <= 50; p++) {
        const res = await api.customers.list({ ...query, page: p, limit: 100 });
        rows.push(...res.items);
        if (!res.pagination.hasNext) break;
      }
      return rows;
    },
    onSuccess: (rows) => exportCustomers(rows, summary.data),
    onError: (e) => setNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Eksport boʻlmadi' }),
  });

  const s = summary.data;
  const rows = list.data?.items ?? [];
  const total = list.data?.pagination.total ?? 0;

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <PageHeader
        crumb="Mijozlar CRM"
        title="Mijozlar CRM va sodiqlik"
        badge={<LivePill label="Jonli baza" />}
        subtitle="Mijozlar bazasi, segmentlar, sodiqlik ballari va xarid tarixi"
        actions={
          <>
            {can(Permission.CUSTOMERS_EXPORT) && (
              <button type="button" className="btn btn--ghost" disabled={exportAll.isPending} onClick={() => exportAll.mutate()}>
                <IconDownload size={16} /> {exportAll.isPending ? 'Tayyorlanmoqda…' : 'Eksport (Excel)'}
              </button>
            )}
            {can(Permission.LOYALTY_VIEW) && (
              <button type="button" className="btn" onClick={() => setLoyaltyOpen(true)}>
                <IconStar size={16} /> Sodiqlik dasturi
              </button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Jami mijozlar" value={s ? count(s.total) : '…'} unit="nafar" Icon={IconUsers} tone="tone-primary" foot={<span className="kpi__foot-text"><IconTrendUp size={14} /> +{s ? count(s.newThisMonth) : '…'} soʻnggi 30 kunda</span>} />
        <Kpi label="Qaytgan mijozlar" value={s ? percent(s.returningPercent) : '…'} Icon={IconCheck} tone="tone-success" foot={<span>Ikki va undan koʻp buyurtma bergan xaridorlar</span>} />
        <Kpi label="Oʻrtacha LTV" value={s ? som(s.averageLifetimeValue) : '…'} Icon={IconWallet} tone="tone-warning" foot={<span>Bir mijozning umumiy xaridi</span>} />
        <Kpi
          label="Sodiqlik ballari"
          value={s ? count(s.pointsOutstanding) : '…'}
          unit="ball"
          Icon={IconStar}
          tone="tone-violet"
          foot={<span>{program.data ? `≈ ${som((s?.pointsOutstanding ?? 0) * program.data.pointValue)} — dastur qarzi` : 'Mijozlardagi jami ball'}</span>}
        />
      </div>

      <div className="toolbar">
        <div className="search-input">
          <IconSearch size={16} />
          <input type="search" placeholder="Ism, telefon yoki Telegram username…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Mijozlarni qidirish" />
        </div>
        <Seg
          label="Segment"
          quiet
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'ALL', label: 'Barchasi', count: s?.total },
            { value: 'VIP', label: 'VIP', count: s?.segments.VIP },
            { value: 'FREQUENT', label: 'Doimiylar', count: s?.segments.FREQUENT },
            { value: 'NEW', label: 'Yangilar', count: s?.segments.NEW },
            { value: 'INACTIVE_30D', label: 'Yoʻqotilayotgan', count: s?.segments.INACTIVE_30D },
          ]}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Saralash">
          <option value="recent">Saralash: soʻnggi tashrif</option>
          <option value="spent">Saralash: LTV yuqori</option>
          <option value="orders">Saralash: buyurtmalar soni</option>
        </select>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} /> Faqat bloklanganlar
        </label>
      </div>

      <div className={`split${openId ? '' : ' split--single'}`}>
        <section className="card card--flush">
          <div className="card__head">
            <h2 className="card__title">Mijozlar reyestri</h2>
            <span className="cell-sub">{count(total)} ta topildi</span>
          </div>
          {list.isLoading ? (
            <Loading />
          ) : list.isError ? (
            <div style={{ padding: 16 }}><ErrorState error={list.error} onRetry={() => void list.refetch()} /></div>
          ) : rows.length === 0 ? (
            <p className="muted" style={{ padding: '56px 16px', textAlign: 'center' }}>{search ? 'Hech narsa topilmadi' : 'Bu segmentda mijoz yoʻq'}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mijoz</th>
                    <th>Segment</th>
                    <th className="td-right">Buyurtmalar</th>
                    <th className="td-right">Jami xarid (LTV)</th>
                    <th className="td-right">Oʻrtacha chek</th>
                    <th>Oxirgi tashrif</th>
                    <th className="td-right">Ball</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const seg = segmentOf(c, s);
                    return (
                      <tr key={c.id} className={`row--clickable${c.id === openId ? ' row--selected' : ''}`} onClick={() => open(c.id)}>
                        <td>
                          <div className="cell-person">
                            <span className="avatar">{initialsOf(c.fullName ?? c.phone)}</span>
                            <div className="cell-stack">
                              <span className="cell-main row" style={{ gap: 6 }}>
                                {c.fullName ?? 'Ismsiz mijoz'}
                                {c.isBlocked && <span className="pill tone-danger">bloklangan</span>}
                              </span>
                              <span className="cell-sub">{phone(c.phone)}{c.telegramUsername ? ` · @${c.telegramUsername}` : ''}</span>
                            </div>
                          </div>
                        </td>
                        <td>{seg ? <span className={`pill ${SEGMENT_META[seg]!.tone}`}>{SEGMENT_META[seg]!.label}</span> : <span className="subtle">—</span>}</td>
                        <td className="td-right num">{c.ordersCount} ta</td>
                        <td className="td-right cell-main num">{som(c.totalSpent)}</td>
                        <td className="td-right num">{som(c.averageCheck)}</td>
                        <td className="cell-sub">{c.lastOrderAt ? dayTimeOf(c.lastOrderAt) : '—'}</td>
                        <td className="td-right">{c.loyaltyPoints ? <span className="pill tone-violet">{count(c.loyaltyPoints)}</span> : <span className="subtle">0</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="card__foot">
            <span>Koʻrsatilmoqda: {total ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)}` : 0} / {count(total)}</span>
            <Pager page={page} totalPages={list.data?.pagination.totalPages ?? 1} onChange={setPage} />
          </div>
        </section>

        {openId && (
          <CustomerPanel
            key={openId}
            id={openId}
            summary={s}
            onClose={() => open(null)}
            onNotice={setNotice}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: ['customers'] })}
          />
        )}
      </div>

      {loyaltyOpen && (
        <Drawer title="Sodiqlik dasturi" onClose={() => setLoyaltyOpen(false)}>
          <LoyaltySettings canManage={can(Permission.LOYALTY_MANAGE)} onSaved={(text) => setNotice({ ok: true, text })} />
        </Drawer>
      )}
    </div>
  );
}

function CustomerPanel({
  id,
  summary,
  onClose,
  onNotice,
  onChanged,
}: {
  id: string;
  summary: CustomerSummary | undefined;
  onClose: () => void;
  onNotice: (n: { ok: boolean; text: string }) => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customers.get(id) });
  const orders = useQuery({ queryKey: ['customer', id, 'orders'], queryFn: () => api.customers.orders(id, { limit: 6 }) });
  const points = useQuery({ queryKey: ['customer', id, 'loyalty'], queryFn: () => api.customers.loyaltyTransactions(id, { limit: 6 }), enabled: can(Permission.LOYALTY_VIEW) });
  const program = useQuery({ queryKey: ['loyalty', 'program'], queryFn: () => api.customers.loyaltyProgram(), enabled: can(Permission.LOYALTY_VIEW) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['customer', id] });
    onChanged();
  };
  const fail = (e: unknown) => setError(e instanceof RestorApiError ? e.message : 'Amal bajarilmadi');

  const toggleBlock = useMutation({
    mutationFn: (block: boolean) => (block ? api.customers.block(id, reason.trim() || undefined) : api.customers.unblock(id)),
    onSuccess: (_r, block) => {
      setBlocking(false);
      setReason('');
      setError(null);
      onNotice({ ok: true, text: block ? 'Mijoz bloklandi' : 'Blok olib tashlandi' });
      refresh();
    },
    onError: fail,
  });

  if (!customer.data) {
    return (
      <SidePanel title="Mijoz" onClose={onClose}>
        {customer.isError ? <ErrorState error={customer.error} onRetry={() => void customer.refetch()} /> : <Loading />}
      </SidePanel>
    );
  }

  const c = customer.data;
  const seg = segmentOf(c, summary);
  const level = c.loyalty?.levelName;
  const cashback = program.data
    ? (program.data.levels.find((l) => l.id === c.loyalty?.levelId)?.cashbackPercent ?? program.data.cashbackPercent)
    : null;

  return (
    <SidePanel
      title={c.fullName ?? phone(c.phone)}
      sub={`Mijoz ${dateOf(c.createdAt)} dan beri`}
      onClose={onClose}
      footer={
        <>
          {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
          {blocking && (
            <div className="stack" style={{ gap: 6 }}>
              <input placeholder="Bloklash sababi" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Bloklash sababi" />
              <div className="row">
                <button type="button" className="btn btn--sm btn--danger" disabled={toggleBlock.isPending} onClick={() => toggleBlock.mutate(true)}>Bloklash</button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setBlocking(false)}>Bekor</button>
              </div>
            </div>
          )}
          {can(Permission.CUSTOMERS_UPDATE) && (
            <button type="button" className="btn btn--block" onClick={() => setEditing(true)}>
              <IconEdit size={16} /> Profil va eslatmani tahrirlash
            </button>
          )}
          {can(Permission.CUSTOMERS_UPDATE) && !blocking && (
            c.isBlocked ? (
              <button type="button" className="btn btn--soft btn--block" disabled={toggleBlock.isPending} onClick={() => toggleBlock.mutate(false)}>
                <IconCheck size={16} /> Blokni ochish
              </button>
            ) : (
              <button type="button" className="btn btn--danger-soft btn--block" onClick={() => setBlocking(true)}>
                <IconBan size={16} /> Bloklash
              </button>
            )
          )}
        </>
      }
    >
      <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
        <span className="avatar avatar--lg">{initialsOf(c.fullName ?? c.phone)}</span>
        <div className="stack" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 6 }}>
            {seg && <span className={`pill ${SEGMENT_META[seg]!.tone}`}>{SEGMENT_META[seg]!.label}</span>}
            {c.isBlocked && <span className="pill tone-danger">Bloklangan</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <a className="btn btn--sm btn--ghost" href={`tel:${c.phone}`}><IconPhone size={13} /> {phone(c.phone)}</a>
            {c.telegramUsername && (
              <a className="btn btn--sm btn--ghost" href={`https://t.me/${encodeURIComponent(c.telegramUsername)}`} target="_blank" rel="noreferrer">
                <IconTelegram size={13} /> @{c.telegramUsername}
              </a>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <div className="soft-box stat-mini"><span className="stat-mini__label">Jami LTV</span><span className="stat-mini__value">{som(c.totalSpent)}</span></div>
        <div className="soft-box stat-mini"><span className="stat-mini__label">Buyurtmalar</span><span className="stat-mini__value">{c.ordersCount} ta</span></div>
        <div className="soft-box stat-mini"><span className="stat-mini__label">Oʻrtacha chek</span><span className="stat-mini__value">{som(c.averageCheck)}</span></div>
      </div>

      {c.loyalty && (
        <div className="soft-box" style={{ background: 'linear-gradient(135deg, var(--sidebar-bg), #3b2a5c)', color: '#fff' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 6, fontWeight: 700 }}><IconStar size={16} /> {level ? `${level} daraja` : 'Sodiqlik dasturi'}</span>
            {cashback !== null && <span className="pill" style={{ background: 'rgb(255 255 255 / 15%)' }}>{cashback}% keshbek</span>}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }} className="num">{count(c.loyalty.points)} ball</div>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            {program.data ? `≈ ${som(c.loyalty.points * program.data.pointValue)} · ` : ''}jami yigʻilgan: {count(c.loyalty.lifetimePoints)} · taklif kodi {c.loyalty.referralCode}
          </div>
        </div>
      )}

      {c.notes && (
        <div className="banner banner--warning" style={{ padding: 10 }}>
          <IconNote size={16} />
          <span><strong>Xizmat eslatmasi:</strong> {c.notes}</span>
        </div>
      )}

      {c.favoriteProducts && c.favoriteProducts.length > 0 && (
        <section className="detail-section">
          <div className="detail-section__title">Sevimli taomlari</div>
          <div className="row" style={{ gap: 6 }}>
            {c.favoriteProducts.slice(0, 5).map((p) => <span key={p.productId} className="pill tone-neutral pill--lg">{p.name} · {p.orderCount}</span>)}
          </div>
        </section>
      )}

      {(c.addresses ?? []).length > 0 && (
        <section className="detail-section">
          <div className="detail-section__title">Manzillar</div>
          {c.addresses!.map((a) => (
            <div key={a.id} className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start', fontSize: 13 }}>
              <IconMapPin size={14} style={{ marginTop: 2, color: 'var(--text-muted)' }} />
              <div>
                {a.label && <strong>{a.label}: </strong>}
                {a.address}
                {a.landmark && <div className="cell-sub">Moʻljal: {a.landmark}</div>}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="detail-section">
        <div className="detail-section__title"><span>Soʻnggi buyurtmalar</span><span>{c.ordersCount} ta</span></div>
        {(orders.data?.items ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Buyurtma yoʻq</p>
        ) : (
          orders.data!.items.map((o) => (
            <Link key={o.id} to={`/orders?id=${o.id}`} className="soft-box row" style={{ flexWrap: 'nowrap', padding: '8px 12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-main">#{o.displayNumber}</div>
                <div className="cell-sub">{dayTimeOf(o.createdAt)}</div>
              </div>
              <div className="stack" style={{ gap: 2, justifyItems: 'end' }}>
                <span className="cell-main num">{som(o.total)}</span>
                <StatusBadge status={o.status} />
              </div>
            </Link>
          ))
        )}
      </section>

      {points.data && points.data.items.length > 0 && (
        <section className="detail-section">
          <div className="detail-section__title">Ball harakatlari</div>
          {points.data.items.map((t) => (
            <div key={t.id} className="row cell-sub" style={{ justifyContent: 'space-between' }}>
              <span>{t.comment ?? LOYALTY_LABELS[t.type] ?? t.type} · {dateOf(t.createdAt)}</span>
              <strong style={{ color: t.points >= 0 ? 'var(--success-ink)' : 'var(--danger-ink)' }}>{t.points >= 0 ? '+' : ''}{count(t.points)}</strong>
            </div>
          ))}
        </section>
      )}

      {editing && <EditCustomer customerId={c.id} initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onNotice({ ok: true, text: 'Mijoz maʼlumotlari saqlandi' }); refresh(); }} />}
    </SidePanel>
  );
}

const LOYALTY_LABELS: Record<string, string> = {
  EARN: 'Buyurtma uchun',
  REDEEM: 'Sarflandi',
  EXPIRE: 'Muddati tugadi',
  ADJUSTMENT: 'Tuzatish',
  REFERRAL_BONUS: 'Taklif bonusi',
};

function EditCustomer({
  customerId,
  initial,
  onClose,
  onSaved,
}: {
  customerId: string;
  initial: Customer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(initial.fullName ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [birthDate, setBirthDate] = useState(initial.birthDate ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.customers.update(customerId, {
        fullName: fullName.trim() || null,
        email: email.trim() || null,
        birthDate: birthDate || null,
        notes: notes.trim() || null,
      } as Partial<Customer>),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  return (
    <Drawer
      title="Mijoz profili"
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate()}>Saqlash</button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Telefon raqami oʻzgartirilmaydi — u mijozni va uning buyurtmalar tarixini bogʻlab turadi.
      </p>
      <div className="field">
        <label htmlFor="cu-name">Ism-familiya</label>
        <input id="cu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cu-email">Email</label>
          <input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cu-birth">Tugʻilgan sana</label>
          <input id="cu-birth" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cu-notes">Xizmat eslatmasi</label>
        <textarea id="cu-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Masalan: piyozsiz tayyorlansin, domofon ishlamaydi" />
        <span className="field__hint">Xodimlar mijozni ochganda koʻradi</span>
      </div>
    </Drawer>
  );
}

function exportCustomers(rows: Customer[], summary: CustomerSummary | undefined) {
  downloadCsv(`mijozlar_${new Date().toISOString().slice(0, 10)}`, [
    ['Ism', 'Telefon', 'Telegram', 'Segment', 'Buyurtmalar', 'Jami xarid (soʻm)', 'Oʻrtacha chek (soʻm)', 'Oxirgi buyurtma', 'Ball', 'Bloklangan'],
    ...rows.map((c) => {
      const seg = segmentOf(c, summary);
      return [
        c.fullName ?? '',
        c.phone,
        c.telegramUsername ? `@${c.telegramUsername}` : '',
        seg ? SEGMENT_META[seg]!.label : '',
        c.ordersCount,
        c.totalSpent,
        c.averageCheck,
        c.lastOrderAt ? dateOf(c.lastOrderAt) : '',
        c.loyaltyPoints ?? 0,
        c.isBlocked ? 'ha' : '',
      ];
    }),
  ]);
}
