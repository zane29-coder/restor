import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  PromoCodeType,
  PromotionType,
  type PromoCode,
  type Promotion,
  type PromotionStats,
} from '@restor/shared-types';
import {
  IconBranch,
  IconClock,
  IconCopy,
  IconEdit,
  IconPercent,
  IconPlus,
  IconTag,
  IconTrash,
  IconTruck,
  IconUserPlus,
  IconWallet,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { compactSom, count, dateOf, percent, som } from '../lib/format';
import { WEEKDAY_SHORT } from '../lib/labels';
import { PROMOTION_TYPE_LABELS, PromoCodeForm, PromotionForm } from '../components/marketing/PromotionForms';
import { ErrorState, Loading, Notice } from '../components/States';
import { Kpi, PageHeader, PeriodPicker, Switch, Tabs, downloadCsv, periodFor, type Period } from '../components/ui';

type Tab = 'active' | 'codes' | 'auto' | 'archive';

const isHappyHour = (p: Promotion) => p.type === PromotionType.HAPPY_HOUR || Boolean(p.timeFrom);
const expired = (endsAt: string | null) => Boolean(endsAt && new Date(endsAt).getTime() < Date.now());
const daysLeft = (endsAt: string | null) => (endsAt ? Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000) : null);
const dateRange = (from: string | null, to: string | null) =>
  from && to ? `${dateOf(from)} — ${dateOf(to)}` : to ? `${dateOf(to)} gacha` : from ? `${dateOf(from)} dan` : '';

/**
 * Promotions and promo codes (TZ §10, §34), with what each one did.
 *
 * The pricing engine applies them on every order; this screen creates them
 * and, from `/reports/promotions`, shows their uses, the discount they cost
 * and the revenue of the orders they were on — so an offer that is costing
 * more than it brings in is visible.
 */
export function MarketingPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { branches } = useBranch();
  const [tab, setTab] = useState<Tab>('active');
  const [period, setPeriod] = useState<Period>(() => periodFor('30d'));
  const [form, setForm] = useState<{ kind: 'promotion'; item: Promotion | null; happyHour?: boolean } | { kind: 'code'; item: PromoCode | null } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const promotions = useQuery({ queryKey: ['promotions', 'all'], queryFn: () => api.marketing.listPromotions({ limit: 100 }) });
  const codes = useQuery({ queryKey: ['promo-codes', 'all'], queryFn: () => api.marketing.listPromoCodes({ limit: 100 }), enabled: can(Permission.PROMO_CODES_VIEW) });
  const stats = useQuery({
    queryKey: ['reports', 'promotions', period],
    queryFn: () => api.reports.promotions({ dateFrom: period.dateFrom, dateTo: period.dateTo }),
  });

  const fail = (e: unknown, fallback: string) => setNotice({ ok: false, text: e instanceof RestorApiError ? e.message : fallback });
  const togglePromotion = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.marketing.updatePromotion(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['promotions'] }),
    onError: (e) => fail(e, 'Oʻzgartirilmadi'),
  });
  const removePromotion = useMutation({
    mutationFn: (id: string) => api.marketing.deletePromotion(id),
    onSuccess: () => {
      setNotice({ ok: true, text: 'Aksiya arxivga oʻtkazildi' });
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (e) => fail(e, 'Oʻchirilmadi'),
  });
  const toggleCode = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.marketing.updatePromoCode(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['promo-codes'] }),
    onError: (e) => fail(e, 'Oʻzgartirilmadi'),
  });

  const all = promotions.data?.items ?? [];
  const allCodes = codes.data?.items ?? [];
  const live = (p: Promotion) => p.isActive && !expired(p.endsAt);
  const lists = useMemo(
    () => ({
      active: all.filter((p) => live(p) && !isHappyHour(p)),
      auto: all.filter((p) => live(p) && isHappyHour(p)),
      archive: all.filter((p) => !live(p)),
    }),
    [all], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (promotions.isLoading) return <Loading />;
  if (promotions.isError) return <ErrorState error={promotions.error} onRetry={() => void promotions.refetch()} />;

  const s = stats.data;
  const activeCount = lists.active.length + lists.auto.length;
  const coveredBranches = new Set(all.filter(live).flatMap((p) => (p.branchIds.length ? p.branchIds : branches.map((b) => b.id)))).size;
  const avgDiscount = s && s.discountedRevenue + s.discountTotal > 0 ? (s.discountTotal / (s.discountedRevenue + s.discountTotal)) * 100 : null;
  const newViaCodes = s?.promoCodes.reduce((sum, c) => sum + c.newCustomers, 0) ?? 0;
  const statOf = (id: string) => s?.promotions.find((x) => x.promotionId === id);
  const codeStat = (id: string) => s?.promoCodes.find((x) => x.promoCodeId === id);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '—';

  const canPromo = can(Permission.PROMOTIONS_MANAGE);

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <PageHeader
        crumb="Aksiyalar"
        title="Aksiyalar va promokodlar"
        subtitle="Avtomatik chegirmalar, promokodlar va ularning tushumga taʼsiri"
        actions={
          <>
            {can(Permission.PROMO_CODES_MANAGE) && (
              <button type="button" className="btn btn--ghost" onClick={() => setForm({ kind: 'code', item: null })}>
                <IconTag size={16} /> Yangi promokod
              </button>
            )}
            {canPromo && (
              <button type="button" className="btn" onClick={() => setForm({ kind: 'promotion', item: null, happyHour: tab === 'auto' })}>
                <IconPlus size={17} /> Yangi aksiya
              </button>
            )}
          </>
        }
      />

      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Natijalar davri — yakunlangan buyurtmalar boʻyicha</span>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <div className="kpi-grid">
        <Kpi
          label="Faol kampaniyalar"
          value={activeCount}
          unit="ta"
          Icon={IconTag}
          tone="tone-primary"
          foot={<span className="kpi__foot-text"><IconBranch size={13} /> {coveredBranches} / {branches.length} filialda · {allCodes.filter((c) => c.isActive && !expired(c.endsAt)).length} promokod</span>}
        />
        <Kpi
          label="Chegirmali buyurtmalar tushumi"
          value={s ? compactSom(s.discountedRevenue) : '…'}
          unit="soʻm"
          Icon={IconWallet}
          tone="tone-success"
          foot={<span>{s ? `${count(s.ordersWithDiscount)} ta buyurtma · tushumning ${percent(s.revenueTotal ? (s.discountedRevenue / s.revenueTotal) * 100 : null, 0)}` : '…'}</span>}
        />
        <Kpi
          label="Oʻrtacha chegirma"
          value={percent(avgDiscount)}
          Icon={IconPercent}
          tone={avgDiscount !== null && avgDiscount > 15 ? 'tone-danger' : 'tone-info'}
          foot={<span>{s ? `Jami berilgan: ${som(s.discountTotal)}` : '…'}</span>}
        />
        <Kpi
          label="Promokod bilan kelgan yangi mijozlar"
          value={newViaCodes}
          unit="nafar"
          Icon={IconUserPlus}
          tone="tone-violet"
          foot={<span>Birinchi buyurtmasi promokod bilan boʻlganlar</span>}
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: 'Faol aksiyalar', count: lists.active.length },
          { value: 'codes', label: 'Promokodlar', count: allCodes.length },
          { value: 'auto', label: 'Avtomatik chegirmalar (Happy hour)', count: lists.auto.length },
          { value: 'archive', label: 'Arxiv va nofaol', count: lists.archive.length },
        ]}
      />

      {tab === 'codes' ? (
        allCodes.length === 0 ? (
          <p className="card muted" style={{ textAlign: 'center' }}>Promokod yoʻq</p>
        ) : (
          <div className="promo-grid">
            {allCodes.map((c) => {
              const st = codeStat(c.id);
              const done = expired(c.endsAt);
              return (
                <article key={c.id} className="card stack" style={{ gap: 12, opacity: c.isActive && !done ? 1 : 0.65 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="row" style={{ gap: 6 }}>
                      <code className="pill pill--lg tone-primary" style={{ fontSize: 14, letterSpacing: 1 }}>{c.code}</code>
                      <button type="button" className="icon-btn icon-btn--sm" aria-label="Nusxa olish" onClick={() => void navigator.clipboard?.writeText(c.code)}>
                        <IconCopy size={14} />
                      </button>
                    </span>
                    <span className={`pill ${done ? 'tone-neutral' : c.isActive ? 'tone-success' : 'tone-neutral'}`}>{done ? 'Muddati tugagan' : c.isActive ? 'Faol' : 'Oʻchiq'}</span>
                  </div>
                  <div className="cell-main">{describeCode(c)}{c.isPublic && <span className="pill tone-info" style={{ marginLeft: 6 }}>Ommaviy</span>}</div>
                  <dl className="kv">
                    <dt>Min. buyurtma</dt><dd>{c.minOrderAmount ? som(c.minOrderAmount) : '—'}</dd>
                    <dt>Bir mijozga</dt><dd>{c.userLimit ? `${c.userLimit} marta` : 'cheklanmagan'}</dd>
                    <dt>Filiallar</dt><dd>{c.branchIds.length ? c.branchIds.map(branchName).join(', ') : 'Barchasi'}</dd>
                    <dt>Muddat</dt><dd>{c.startsAt || c.endsAt ? dateRange(c.startsAt, c.endsAt) : 'muddatsiz'}</dd>
                  </dl>
                  <div className="bar-row">
                    <div className="bar-row__head"><span>Ishlatilgan</span><span className="bar-row__value">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</span></div>
                    {c.usageLimit && <div className="progress"><div className="progress__bar" style={{ width: `${Math.min(100, (c.usedCount / c.usageLimit) * 100)}%` }} /></div>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div className="soft-box stat-mini"><span className="stat-mini__label">Davrdagi tushum</span><span className="stat-mini__value">{st ? compactSom(st.revenue) : '0'}</span></div>
                    <div className="soft-box stat-mini"><span className="stat-mini__label">Yangi mijozlar</span><span className="stat-mini__value">{st?.newCustomers ?? 0}</span></div>
                  </div>
                  {can(Permission.PROMO_CODES_MANAGE) && (
                    <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <Switch checked={c.isActive} disabled={toggleCode.isPending} onChange={(isActive) => toggleCode.mutate({ id: c.id, isActive })} label={c.isActive ? 'Faol' : 'Oʻchiq'} />
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm({ kind: 'code', item: c })}><IconEdit size={13} /> Tahrirlash</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )
      ) : (
        <PromotionGrid
          items={tab === 'active' ? lists.active : tab === 'auto' ? lists.auto : lists.archive}
          empty={tab === 'archive' ? 'Arxiv boʻsh' : tab === 'auto' ? 'Vaqtli chegirma yoʻq — masalan tushlik payti 15% chegirma' : 'Faol aksiya yoʻq'}
          statOf={statOf}
          branchName={branchName}
          canManage={canPromo}
          onToggle={(id, isActive) => togglePromotion.mutate({ id, isActive })}
          onEdit={(p) => setForm({ kind: 'promotion', item: p })}
          onArchive={(id) => removePromotion.mutate(id)}
        />
      )}

      {s && s.byBranch.length > 0 && (
        <section className="card card--flush">
          <div className="card__head">
            <div>
              <h2 className="card__title">Filiallar boʻyicha aksiya taqsimoti</h2>
              <p className="card__sub">Qaysi filialda chegirmalar qancha tushum keltirdi</p>
            </div>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => exportStats(s, all, allCodes)}>Eksport</button>
          </div>
          <div className="table-wrap">
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr><th>Filial</th><th className="td-right">Chegirmali cheklar</th><th className="td-right">Chegirma summasi</th><th className="td-right">Sof tushum</th><th className="td-right">Chegirma ulushi</th></tr>
              </thead>
              <tbody>
                {s.byBranch.map((b) => (
                  <tr key={b.branchId}>
                    <td className="cell-main">{b.branchName}</td>
                    <td className="td-right num">{count(b.ordersWithDiscount)} ta</td>
                    <td className="td-right num">{som(b.discountTotal)}</td>
                    <td className="td-right num cell-main">{som(b.revenue)}</td>
                    <td className="td-right">{percent(b.revenue + b.discountTotal ? (b.discountTotal / (b.revenue + b.discountTotal)) * 100 : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {form?.kind === 'promotion' && (
        <PromotionForm promotion={form.item} happyHour={form.happyHour} branches={branches} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); setNotice({ ok: true, text }); }} />
      )}
      {form?.kind === 'code' && (
        <PromoCodeForm code={form.item} branches={branches} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); setNotice({ ok: true, text }); }} />
      )}
    </div>
  );
}

function PromotionGrid({
  items,
  empty,
  statOf,
  branchName,
  canManage,
  onToggle,
  onEdit,
  onArchive,
}: {
  items: Promotion[];
  empty: string;
  statOf: (id: string) => { uses: number; discountTotal: number; revenue: number } | undefined;
  branchName: (id: string) => string;
  canManage: boolean;
  onToggle: (id: string, isActive: boolean) => void;
  onEdit: (p: Promotion) => void;
  onArchive: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  if (items.length === 0) return <p className="card muted" style={{ textAlign: 'center' }}>{empty}</p>;

  return (
    <div className="promo-grid">
      {items.map((p) => {
        const st = statOf(p.id);
        const left = daysLeft(p.endsAt);
        const done = expired(p.endsAt);
        return (
          <article key={p.id} className="card stack" style={{ gap: 12, opacity: p.isActive && !done ? 1 : 0.7 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="pill pill--lg tone-primary">
                {p.type === PromotionType.FREE_DELIVERY ? <><IconTruck size={13} /> Bepul yetkazish</> : badgeOf(p)}
              </span>
              <span className={`pill ${done ? 'tone-neutral' : p.isActive ? 'tone-success' : 'tone-neutral'}`}>{done ? 'Tugagan' : p.isActive ? 'Faol' : 'Pauza'}</span>
            </div>
            <div>
              <h3 className="card__title">{p.name}</h3>
              {p.description && <p className="card__sub">{p.description}</p>}
            </div>
            <div className="row cell-sub" style={{ gap: 8 }}>
              {p.timeFrom && <span className="row" style={{ gap: 4 }}><IconClock size={13} /> {p.timeFrom}–{p.timeTo}</span>}
              {p.daysOfWeek.length > 0 && p.daysOfWeek.length < 7 && <span>{p.daysOfWeek.map((d) => WEEKDAY_SHORT[d]).join(', ')}</span>}
              {left !== null && !done && <span className={left <= 3 ? 'pill tone-warning' : ''}>{left} kun qoldi</span>}
              {(p.startsAt || p.endsAt) && <span>{dateRange(p.startsAt, p.endsAt)}</span>}
            </div>
            <dl className="kv">
              <dt>Turi</dt><dd>{PROMOTION_TYPE_LABELS[p.type] ?? p.type}</dd>
              <dt>Min. buyurtma</dt><dd>{p.minOrderAmount ? som(p.minOrderAmount) : '—'}</dd>
              <dt>Filiallar</dt><dd>{p.branchIds.length ? p.branchIds.map(branchName).join(', ') : 'Barchasi'}</dd>
              <dt>Yakka</dt><dd>{p.isExclusive ? 'Ha — boshqasi qoʻshilmaydi' : 'Yoʻq — boshqalar bilan birga'}</dd>
            </dl>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div className="soft-box stat-mini"><span className="stat-mini__label">Qoʻllanish</span><span className="stat-mini__value">{st?.uses ?? 0} marta</span></div>
              <div className="soft-box stat-mini"><span className="stat-mini__label">Tushum</span><span className="stat-mini__value">{compactSom(st?.revenue ?? 0)}</span></div>
              <div className="soft-box stat-mini"><span className="stat-mini__label">Chegirma</span><span className="stat-mini__value">{compactSom(st?.discountTotal ?? 0)}</span></div>
            </div>
            {canManage && (
              <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <Switch checked={p.isActive} onChange={(v) => onToggle(p.id, v)} label={p.isActive ? 'Faol' : 'Pauza'} />
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => onEdit(p)}><IconEdit size={13} /> Tahrirlash</button>
                  {confirm === p.id ? (
                    <>
                      <button type="button" className="btn btn--sm btn--danger" onClick={() => onArchive(p.id)}>Ha</button>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(null)}>Yoʻq</button>
                    </>
                  ) : (
                    <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" aria-label="Arxivga" title="Arxivga" onClick={() => setConfirm(p.id)}><IconTrash size={14} /></button>
                  )}
                </span>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function badgeOf(p: Promotion): string {
  if (p.type === PromotionType.FIXED_DISCOUNT) return `−${som(p.value)}`;
  if (p.type === PromotionType.PERCENTAGE_DISCOUNT || p.type === PromotionType.HAPPY_HOUR) return `−${p.value}% chegirma`;
  return PROMOTION_TYPE_LABELS[p.type] ?? p.type;
}

function describeCode(code: PromoCode): string {
  switch (code.type) {
    case PromoCodeType.PERCENTAGE:
      return `${code.discount}% chegirma${code.maxDiscount ? `, maksimal ${som(code.maxDiscount)}` : ''}`;
    case PromoCodeType.FIXED:
      return `${som(code.discount)} chegirma`;
    case PromoCodeType.FREE_DELIVERY:
      return 'Bepul yetkazish';
    default:
      return code.type;
  }
}

function exportStats(s: PromotionStats, promotions: Promotion[], codes: PromoCode[]) {
  const name = (id: string) => promotions.find((p) => p.id === id)?.name ?? id;
  const code = (id: string) => codes.find((c) => c.id === id)?.code ?? id;
  downloadCsv(`aksiyalar_${s.dateFrom.slice(0, 10)}_${s.dateTo.slice(0, 10)}`, [
    ['Aksiya', 'Qoʻllanish', 'Chegirma (soʻm)', 'Tushum (soʻm)'],
    ...s.promotions.map((p) => [name(p.promotionId), p.uses, p.discountTotal, p.revenue]),
    [],
    ['Promokod', 'Qoʻllanish', 'Chegirma (soʻm)', 'Tushum (soʻm)', 'Yangi mijozlar'],
    ...s.promoCodes.map((c) => [code(c.promoCodeId), c.uses, c.discountTotal, c.revenue, c.newCustomers]),
    [],
    ['Filial', 'Chegirmali cheklar', 'Chegirma (soʻm)', 'Tushum (soʻm)'],
    ...s.byBranch.map((b) => [b.branchName, b.ordersWithDiscount, b.discountTotal, b.revenue]),
  ]);
}
