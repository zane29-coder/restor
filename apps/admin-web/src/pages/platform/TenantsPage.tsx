import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TenantStatus } from '@restor/shared-types';
import { formatMoney, formatPhone } from '@restor/shared-utils';
import { IconPlus, IconSearch } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { Drawer } from '../../components/Drawer';
import { Empty, ErrorState, Loading, Notice } from '../../components/States';

const STATUS_LABELS: Record<string, string> = {
  TRIAL: 'Sinov',
  ACTIVE: 'Faol',
  SUSPENDED: 'Toʻxtatilgan',
  BLOCKED: 'Bloklangan',
};

const STATUS_TONES: Record<string, { bg: string; fg: string }> = {
  TRIAL: { bg: '#DBEAFE', fg: '#1E40AF' },
  ACTIVE: { bg: '#DCFCE7', fg: '#166534' },
  SUSPENDED: { bg: '#FEF3C7', fg: '#92400E' },
  BLOCKED: { bg: '#FEE2E2', fg: '#991B1B' },
};

/**
 * The restaurants on the platform (TZ §6).
 *
 * This is the super admin's core screen: they put a company on the platform,
 * give it a tariff, and suspend it when it stops paying. They never open its
 * menu or its kitchen.
 */
export function TenantsPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const tenants = useQuery({
    queryKey: ['platform', 'tenants', query, status],
    queryFn: () =>
      api.platform.listTenants({
        search: query || undefined,
        status: status ? (status as TenantStatus) : undefined,
        limit: 50,
      }),
  });

  if (tenants.isLoading) return <Loading />;
  if (tenants.isError) {
    return <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />;
  }

  const items = tenants.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      <div className="row">
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setQuery(search.trim());
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nomi yoki slug"
            style={{ minWidth: 220 }}
          />
          <button type="submit" className="btn btn--ghost">
            <IconSearch size={16} />
            Qidirish
          </button>
        </form>

        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Barcha holatlar</option>
          {Object.values(TenantStatus).map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value] ?? value}
            </option>
          ))}
        </select>

        <div className="spacer" />
        <span className="muted">{tenants.data?.pagination.total ?? 0} ta korxona</span>
        <button type="button" className="btn" onClick={() => setIsCreating(true)}>
          <IconPlus size={16} />
          Yangi korxona
        </button>
      </div>

      {items.length === 0 ? (
        <Empty
          title="Korxona topilmadi"
          description={query || status ? 'Filtrlarni oʻzgartirib koʻring.' : 'Birinchi korxonani qoʻshing.'}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Korxona</th>
                <th>Slug</th>
                <th>Holati</th>
                <th>Telefon</th>
                <th>Bot</th>
                <th>Qoʻshilgan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((tenant) => (
                <tr key={tenant.id} onClick={() => setSelected(tenant.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <strong>{tenant.name}</strong>
                    {tenant.legalName && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {tenant.legalName}
                      </div>
                    )}
                  </td>
                  <td className="muted">
                    <code>{tenant.slug}</code>
                  </td>
                  <td>
                    <StatusBadge status={tenant.status} />
                  </td>
                  <td>{tenant.phone ? formatPhone(tenant.phone) : '—'}</td>
                  <td>
                    {tenant.branding.hasCustomBot ? (
                      <span className="badge" style={{ background: '#DCFCE7', color: '#166534' }}>
                        ulangan
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {new Date(tenant.createdAt).toLocaleDateString('uz-UZ')}
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setSelected(tenant.id)}
                    >
                      Batafsil
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <TenantDetail
          tenantId={selected}
          onClose={() => setSelected(null)}
          onNotice={setNotice}
        />
      )}

      {isCreating && (
        <TenantForm
          onClose={() => setIsCreating(false)}
          onCreated={(name) => {
            setIsCreating(false);
            setNotice({ ok: true, text: `"${name}" platformaga qoʻshildi` });
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? { bg: 'var(--surface-alt)', fg: 'var(--text)' };
  return (
    <span className="badge" style={{ background: tone.bg, color: tone.fg }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

function TenantDetail({
  tenantId,
  onClose,
  onNotice,
}: {
  tenantId: string;
  onClose: () => void;
  onNotice: (notice: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [blockReason, setBlockReason] = useState('');

  const tenant = useQuery({
    queryKey: ['platform', 'tenant', tenantId],
    queryFn: () => api.platform.getTenant(tenantId),
  });

  const usage = useQuery({
    queryKey: ['platform', 'tenant', tenantId, 'usage'],
    queryFn: () => api.platform.subscriptionUsage(tenantId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform'] });
  };

  const block = useMutation({
    mutationFn: (reason: string) => api.platform.blockTenant(tenantId, reason),
    onSuccess: (updated) => {
      setBlockReason('');
      invalidate();
      onNotice({ ok: true, text: `${updated.name} bloklandi` });
    },
  });

  const activate = useMutation({
    mutationFn: () => api.platform.activateTenant(tenantId),
    onSuccess: (updated) => {
      invalidate();
      onNotice({ ok: true, text: `${updated.name} faollashtirildi` });
    },
  });

  if (!tenant.data) {
    return (
      <Drawer title="Korxona" onClose={onClose}>
        {tenant.isError ? (
          <ErrorState error={tenant.error} onRetry={() => void tenant.refetch()} />
        ) : (
          <Loading />
        )}
      </Drawer>
    );
  }

  const detail = tenant.data;
  const isBlocked = detail.status === TenantStatus.BLOCKED;
  const actionError = block.error ?? activate.error;

  return (
    <Drawer title={detail.name} onClose={onClose}>
      {actionError && (
        <div className="alert alert--error">
          {actionError instanceof RestorApiError ? actionError.message : 'Amal bajarilmadi'}
        </div>
      )}

      <div className="row" style={{ marginBottom: 18 }}>
        <StatusBadge status={detail.status} />
        <code className="muted">{detail.slug}</code>
      </div>

      {isBlocked && detail.blockReason && (
        <div className="alert alert--error">
          Blok sababi: {detail.blockReason}
        </div>
      )}

      <h3 className="section-title">Maʼlumot</h3>
      <dl style={{ display: 'grid', gap: 5, margin: '0 0 20px' }}>
        <Row label="Yuridik nom" value={detail.legalName ?? '—'} />
        <Row label="Telefon" value={detail.phone ? formatPhone(detail.phone) : '—'} />
        <Row label="Email" value={detail.email ?? '—'} />
        <Row label="Valyuta" value={detail.currency} />
        <Row label="Vaqt zonasi" value={detail.timezone} />
        <Row label="Domen" value={detail.branding.domain ?? '—'} />
        <Row
          label="Telegram bot"
          value={detail.branding.hasCustomBot ? 'ulangan' : 'ulanmagan'}
        />
      </dl>

      <h3 className="section-title">Plandan foydalanish</h3>
      {usage.data ? (
        <dl style={{ display: 'grid', gap: 5, margin: '0 0 20px' }}>
          <Row label="Filiallar" value={String(usage.data.branches)} />
          <Row label="Xodimlar" value={String(usage.data.employees)} />
          <Row label="Kassalar" value={String(usage.data.posTerminals)} />
          <Row label="Botlar" value={String(usage.data.bots)} />
          <Row label="Xotira" value={`${usage.data.storageMb} MB`} />
        </dl>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: '0 0 20px' }}>
          Yuklanmoqda…
        </p>
      )}

      <SubscriptionForm tenantId={tenantId} onNotice={onNotice} />

      <Integrations tenantId={tenantId} onNotice={onNotice} />

      <h3 className="section-title" style={{ marginTop: 24 }}>
        Kirishni boshqarish
      </h3>
      {isBlocked ? (
        <>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
            Faollashtirilgandan soʻng korxona xodimlari yana tizimga kira oladi.
          </p>
          <button
            type="button"
            className="btn"
            disabled={activate.isPending}
            onClick={() => activate.mutate()}
          >
            {activate.isPending ? 'Bajarilmoqda…' : 'Faollashtirish'}
          </button>
        </>
      ) : (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            block.mutate(blockReason.trim());
          }}
        >
          <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
            Bloklash korxonaning barcha sessiyalarini tugatadi. Sabab audit jurnaliga yoziladi.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              placeholder="Sabab, masalan: toʻlov qilinmadi"
              required
              minLength={3}
              style={{ flex: 1, minWidth: 200 }}
            />
            <button
              type="submit"
              className="btn btn--danger"
              disabled={block.isPending || blockReason.trim().length < 3}
            >
              {block.isPending ? 'Bajarilmoqda…' : 'Bloklash'}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

/** Assigning or renewing a tariff — the super admin's billing action (TZ §6). */
function SubscriptionForm({
  tenantId,
  onNotice,
}: {
  tenantId: string;
  onNotice: (notice: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [planId, setPlanId] = useState('');

  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => api.platform.listPlans(),
  });

  const assign = useMutation({
    mutationFn: () => api.platform.assignSubscription(tenantId, { planId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
      onNotice({ ok: true, text: 'Obuna biriktirildi' });
      setPlanId('');
    },
  });

  const active = (plans.data ?? []).filter((plan) => plan.isActive);

  return (
    <>
      <h3 className="section-title">Obuna</h3>
      {active.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Faol tarif yoʻq — avval «Planlar» boʻlimida tarif yarating.
        </p>
      ) : (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            assign.mutate();
          }}
        >
          {assign.isError && (
            <div className="alert alert--error">
              {assign.error instanceof RestorApiError ? assign.error.message : 'Biriktirilmadi'}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <select
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
              required
              style={{ flex: 1, minWidth: 180 }}
            >
              <option value="">Tarifni tanlang</option>
              {active.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {formatMoney(plan.price)} / {plan.periodDays} kun
                </option>
              ))}
            </select>
            <button type="submit" className="btn" disabled={assign.isPending || !planId}>
              {assign.isPending ? 'Saqlanmoqda…' : 'Biriktirish'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The bot and the payment key the platform attaches on the restaurant's behalf
 * (TZ §6, §15).
 *
 * Both are write-only: the server verifies the bot token with Telegram and
 * encrypts both at rest, and neither is ever read back. So these fields show
 * only whether something is on file — there is nothing to pre-fill, and a
 * blank field means "leave what is stored alone".
 */
function Integrations({
  tenantId,
  onNotice,
}: {
  tenantId: string;
  onNotice: (notice: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [chatId, setChatId] = useState('');
  const [apiKey, setApiKey] = useState('');

  const provider = useQuery({
    queryKey: ['platform', 'tenant', tenantId, 'payment-provider'],
    queryFn: () => api.platform.tenantPaymentProvider(tenantId),
  });

  const saveBot = useMutation({
    mutationFn: () =>
      api.platform.saveTenantTelegram(tenantId, {
        botToken: botToken.trim(),
        ...(botUsername.trim() ? { botUsername: botUsername.trim().replace(/^@/, '') } : {}),
        ...(chatId.trim() ? { defaultChatId: chatId.trim() } : {}),
        isActive: true,
      }),
    onSuccess: () => {
      setBotToken('');
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
      onNotice({ ok: true, text: 'Telegram bot ulandi' });
    },
  });

  const saveKey = useMutation({
    mutationFn: () => api.platform.saveTenantPaymentProvider(tenantId, { apiKey: apiKey.trim() }),
    onSuccess: () => {
      setApiKey('');
      void provider.refetch();
      onNotice({ ok: true, text: 'Subo kaliti saqlandi' });
    },
  });

  return (
    <>
      <h3 className="section-title" style={{ marginTop: 24 }}>
        Telegram bot
      </h3>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          saveBot.mutate();
        }}
      >
        {saveBot.isError && (
          <div className="alert alert--error">
            {saveBot.error instanceof RestorApiError ? saveBot.error.message : 'Ulanmadi'}
          </div>
        )}
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
          Token @BotFather’dan olinadi. Saqlashdan oldin server uni Telegram’da tekshiradi.
        </p>
        <div className="form-grid">
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Bot tokeni</span>
            <input
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder="123456789:AA…"
              autoComplete="off"
              required
            />
          </label>
          <Field
            label="Bot username"
            value={botUsername}
            onChange={setBotUsername}
            placeholder="@osh_markazi_bot"
          />
          <Field
            label="Standart chat ID"
            hint="Oʻz yoʻnalishi yoʻq hodisalar shu chatga tushadi."
            value={chatId}
            onChange={setChatId}
            placeholder="-1001234567890"
          />
        </div>
        <button
          type="submit"
          className="btn"
          style={{ marginTop: 12 }}
          disabled={saveBot.isPending || !botToken.trim()}
        >
          {saveBot.isPending ? 'Tekshirilmoqda…' : 'Botni ulash'}
        </button>
      </form>

      <h3 className="section-title" style={{ marginTop: 24 }}>
        Subo (onlayn toʻlov)
      </h3>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          saveKey.mutate();
        }}
      >
        {saveKey.isError && (
          <div className="alert alert--error">
            {saveKey.error instanceof RestorApiError ? saveKey.error.message : 'Saqlanmadi'}
          </div>
        )}
        {provider.data && (
          <div className="row" style={{ marginBottom: 10 }}>
            <span
              className="badge"
              style={
                provider.data.hasKey
                  ? { background: '#DCFCE7', color: '#166534' }
                  : { background: 'var(--surface-alt)', color: 'var(--text-muted)' }
              }
            >
              {provider.data.hasKey ? 'kalit saqlangan' : 'kalit yoʻq'}
            </span>
            {provider.data.hasKey && provider.data.isSandbox && (
              <span className="badge" style={{ background: '#FEF3C7', color: '#92400E' }}>
                sandbox
              </span>
            )}
          </div>
        )}
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
          Kalit <code>sk_</code> bilan boshlanadi. <code>sk_test_</code> — sinov rejimi, server
          buni kalitning oʻzidan aniqlaydi.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk_live_…"
            autoComplete="off"
            required
            minLength={16}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button
            type="submit"
            className="btn"
            disabled={saveKey.isPending || apiKey.trim().length < 16}
          >
            {saveKey.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Creating a restaurant also creates its first owner account — the one thing
 * only the platform can do, since a tenant with no one able to sign in is
 * useless. The server does both in one transaction.
 */
function TenantForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [legalName, setLegalName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState('');

  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => api.platform.listPlans(),
  });

  const create = useMutation({
    mutationFn: () =>
      api.platform.createTenant({
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(planId ? { planId } : {}),
        owner: {
          fullName: ownerName.trim(),
          phone: ownerPhone.trim(),
          ...(ownerEmail.trim() ? { email: ownerEmail.trim() } : {}),
          password: ownerPassword,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
      onCreated(name.trim());
    },
  });

  const fieldErrors =
    create.error instanceof RestorApiError ? (create.error.details ?? {}) : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Drawer title="Yangi korxona" onClose={onClose}>
      <form onSubmit={submit}>
        {create.isError && (
          <div className="alert alert--error">
            {create.error instanceof RestorApiError ? create.error.message : 'Yaratilmadi'}
          </div>
        )}

        <h3 className="section-title">Korxona</h3>
        <div className="form-grid">
          <Field
            label="Nomi"
            value={name}
            onChange={setName}
            placeholder="Osh Markazi"
            error={fieldErrors.name?.[0]}
            required
          />
          <Field
            label="Slug"
            hint="Boʻsh qoldirilsa nomdan hosil qilinadi."
            value={slug}
            onChange={setSlug}
            placeholder="osh-markazi"
            error={fieldErrors.slug?.[0]}
          />
          <Field
            label="Yuridik nom"
            value={legalName}
            onChange={setLegalName}
            placeholder="MCHJ Osh Markazi"
            error={fieldErrors.legalName?.[0]}
          />
          <Field
            label="Telefon"
            value={phone}
            onChange={setPhone}
            placeholder="+998 90 123 45 67"
            error={fieldErrors.phone?.[0]}
          />
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            placeholder="info@oshmarkazi.uz"
            error={fieldErrors.email?.[0]}
          />
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Tarif</span>
            <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="">Keyinroq biriktiraman</option>
              {(plans.data ?? [])
                .filter((plan) => plan.isActive)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <h3 className="section-title" style={{ marginTop: 20 }}>
          Egasi
        </h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
          Bu hisob korxonaning birinchi admini boʻladi va oʻz xodimlarini oʻzi qoʻshadi.
        </p>

        <div className="form-grid">
          <Field
            label="Ism-familiya"
            value={ownerName}
            onChange={setOwnerName}
            placeholder="Aziz Karimov"
            error={fieldErrors['owner.fullName']?.[0]}
            required
          />
          <Field
            label="Telefon"
            hint="Tizimga kirish uchun ishlatiladi."
            value={ownerPhone}
            onChange={setOwnerPhone}
            placeholder="+998 90 123 45 67"
            error={fieldErrors['owner.phone']?.[0]}
            required
          />
          <Field
            label="Email"
            value={ownerEmail}
            onChange={setOwnerEmail}
            placeholder="aziz@oshmarkazi.uz"
            error={fieldErrors['owner.email']?.[0]}
          />
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Boshlangʻich parol</span>
            <input
              type="password"
              value={ownerPassword}
              onChange={(event) => setOwnerPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Egasiga yetkazing — birinchi kirishdan soʻng oʻzgartirsin.
            </span>
            {fieldErrors['owner.password']?.[0] && (
              <span className="field__error">{fieldErrors['owner.password'][0]}</span>
            )}
          </label>
        </div>

        <button
          type="submit"
          className="btn"
          style={{ marginTop: 20 }}
          disabled={create.isPending}
        >
          {create.isPending ? 'Yaratilmoqda…' : 'Korxona yaratish'}
        </button>
      </form>
    </Drawer>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  error,
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        required={required}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <span className="muted" style={{ fontSize: 12 }}>
          {hint}
        </span>
      )}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
