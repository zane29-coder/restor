import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OrderSource, Permission, type TelegramBotStatus, type TelegramConfig, type TelegramRoute } from '@restor/shared-types';
import {
  IconAlert,
  IconCheckCircle,
  IconCopy,
  IconExternal,
  IconKey,
  IconLink,
  IconPlus,
  IconRefresh,
  IconSave,
  IconTelegram,
  IconTrendUp,
  IconUsers,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { compactSom, count, dateTimeOf, percent } from '../lib/format';
import { Drawer } from '../components/Drawer';
import { ErrorState, Loading, Notice } from '../components/States';
import { MiniAppSettings } from '../components/telegram/MiniAppSettings';
import { Card, Kpi, PageHeader, periodFor } from '../components/ui';

type Notify = (notice: { ok: boolean; text: string }) => void;
const BOT_SOURCES: string[] = [OrderSource.TELEGRAM_BOT, OrderSource.TELEGRAM_MINI_APP];

/**
 * Telegram (TZ 14, 15, 48).
 *
 * The bot, where each event is posted, and how the customers' Mini App looks.
 * Routing is per event AND per branch, which is what lets a chain send
 * Chilonzor's orders to Chilonzor's group.
 *
 * The status figures exist because "the bot does not answer" has several
 * causes that look identical from the settings alone — no webhook, a webhook
 * pointing at another deployment, a token Telegram has revoked. The page
 * names which one it is.
 */
export function TelegramPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { branches } = useBranch();
  const [branchId, setBranchId] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [routeForm, setRouteForm] = useState<{ chatId: string; topicId: number | null } | null>(null);

  const config = useQuery({
    queryKey: ['telegram', 'config', branchId],
    queryFn: () => api.telegram.getConfig(branchId || undefined),
  });
  const routes = useQuery({
    queryKey: ['telegram', 'routes', branchId],
    queryFn: () => api.telegram.listRoutes(branchId || undefined),
  });
  const events = useQuery({
    queryKey: ['telegram', 'events'],
    queryFn: () => api.http.get<Array<{ value: string; label: string }>>('telegram/events'),
  });
  /*
   * Two round trips to Telegram, so not folded into the config query. A
   * failure here is informative rather than fatal — the settings still work
   * while Telegram is unreachable.
   */
  const botStatus = useQuery({
    queryKey: ['telegram', 'bot-status', branchId],
    queryFn: () => api.telegram.getBotStatus(branchId || undefined),
    retry: false,
  });
  const today = periodFor('today');
  const month = periodFor('30d');
  const salesToday = useQuery({
    queryKey: ['reports', 'sales', 'telegram', today.dateFrom, branchId],
    queryFn: () => api.reports.sales({ branchId: branchId || undefined, dateFrom: today.dateFrom, dateTo: today.dateTo, granularity: 'day' }),
    enabled: can(Permission.REPORTS_VIEW),
  });
  const salesMonth = useQuery({
    queryKey: ['reports', 'sales', 'telegram', month.dateFrom, branchId],
    queryFn: () => api.reports.sales({ branchId: branchId || undefined, dateFrom: month.dateFrom, dateTo: month.dateTo, granularity: 'day' }),
    enabled: can(Permission.REPORTS_VIEW),
  });

  /*
   * Two rights, not one (TZ 6): the bot token is attached by the platform,
   * while routing events to the restaurant's own groups is the restaurant's
   * call. A tenant admin reads the bot's status but cannot change it.
   */
  const canManageBot = can(Permission.TELEGRAM_MANAGE);
  const canManageRoutes = can(Permission.TELEGRAM_ROUTES_MANAGE);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['telegram'] });
  const fail = (e: unknown, fallback: string) => setNotice({ ok: false, text: e instanceof RestorApiError ? e.message : fallback });

  const connect = useMutation({
    mutationFn: () => api.telegram.connectBot(branchId || undefined),
    onSuccess: (result) => {
      setNotice({ ok: result.isConnected, text: result.message });
      invalidate();
    },
    onError: (e) => fail(e, 'Ulanmadi'),
  });
  const testDefault = useMutation({
    mutationFn: () => api.telegram.testRoute({ chatId: config.data!.defaultChatId!, topicId: null }),
    onSuccess: (result) => setNotice({ ok: result.ok, text: result.message }),
    onError: (e) => fail(e, 'Yuborilmadi'),
  });

  if (config.isLoading) return <Loading />;
  if (config.isError) return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;

  const status = botStatus.data ?? null;
  const botOrders = (s: typeof salesToday.data) => {
    const rows = s?.bySource.filter((r) => BOT_SOURCES.includes(r.source)) ?? [];
    return { count: rows.reduce((sum, r) => sum + r.count, 0), revenue: rows.reduce((sum, r) => sum + r.revenue, 0) };
  };
  const todayBot = botOrders(salesToday.data);
  const monthBot = botOrders(salesMonth.data);
  const eventLabel = (value: string) => events.data?.find((e) => e.value === value)?.label ?? value;

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <PageHeader
        crumb="Telegram bot"
        title="Telegram bot integratsiyasi"
        subtitle="Buyurtma qabul qiluvchi bot va Mini App, xodimlar guruhlariga bildirishnomalar"
        actions={
          <>
            <button type="button" className="btn btn--ghost" disabled={botStatus.isFetching} onClick={() => void botStatus.refetch()}>
              <IconRefresh size={16} /> {botStatus.isFetching ? 'Tekshirilmoqda…' : 'Holatni tekshirish'}
            </button>
            {canManageRoutes && config.data?.defaultChatId && (
              <button type="button" className="btn btn--ghost" disabled={testDefault.isPending} onClick={() => testDefault.mutate()}>
                <IconTelegram size={16} /> Test xabar yuborish
              </button>
            )}
            {canManageBot && status?.hasToken && (
              <button type="button" className="btn" disabled={connect.isPending} onClick={() => connect.mutate()}>
                <IconLink size={16} /> {connect.isPending ? 'Ulanmoqda…' : 'Qayta ulash'}
              </button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <label htmlFor="tg-branch" className="muted" style={{ fontSize: 13 }}>Sozlama doirasi:</label>
        {/* Tenant-wide settings are the fallback for every branch. */}
        <select id="tg-branch" value={branchId} onChange={(e) => { setBranchId(e.target.value); setNotice(null); }}>
          <option value="">Butun restoran (standart)</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="kpi-grid">
        <Kpi
          label="Bot holati"
          value={!status ? (botStatus.isLoading ? '…' : '—') : status.isConnected ? 'Faol' : status.hasToken ? 'Uzilgan' : 'Yoʻq'}
          Icon={IconTelegram}
          tone={status?.isConnected ? 'tone-success' : status?.hasToken ? 'tone-warning' : 'tone-neutral'}
          alert={Boolean(status?.hasToken && !status.isConnected)}
          foot={
            status?.botLink ? (
              <a className="kpi__foot-text" href={status.botLink} target="_blank" rel="noreferrer">@{status.botUsername} <IconExternal size={12} /></a>
            ) : (
              <span>{status?.message ?? 'Holat tekshirilmoqda'}</span>
            )
          }
        />
        <Kpi
          label="Bugungi bot buyurtmalari"
          value={count(todayBot.count)}
          unit="ta"
          Icon={IconTrendUp}
          tone="tone-primary"
          foot={<span>{salesToday.data?.ordersCount ? `${percent((todayBot.count / salesToday.data.ordersCount) * 100, 0)} jami buyurtmalardan` : 'Bugun buyurtma yoʻq'}</span>}
        />
        <Kpi
          label="30 kunlik bot savdosi"
          value={compactSom(monthBot.revenue)}
          unit="soʻm"
          Icon={IconUsers}
          tone="tone-info"
          foot={<span>{count(monthBot.count)} ta buyurtma · bot va Mini App</span>}
        />
        <Kpi
          label="Webhook"
          value={status?.isConnected ? 'Ulangan' : status?.hasToken ? 'Yoʻq' : '—'}
          Icon={status?.isConnected ? IconCheckCircle : IconAlert}
          tone={status?.isConnected ? 'tone-success' : 'tone-warning'}
          foot={<span>{status ? `Navbatdagi xabarlar: ${status.pendingUpdateCount}` : ''}{status?.lastErrorAt ? ` · oxirgi xato ${dateTimeOf(status.lastErrorAt)}` : ''}</span>}
        />
      </div>

      {status?.hasToken && !status.isConnected && <WebhookMismatch status={status} />}

      <div className="grid-main-side">
        <div className="stack" style={{ gap: 16 }}>
          <GroupsCard
            routes={routes.data ?? []}
            defaultChatId={config.data?.defaultChatId ?? null}
            eventLabel={eventLabel}
            canManage={canManageRoutes}
            hasBot={Boolean(config.data?.hasToken)}
            onAdd={(chatId, topicId) => setRouteForm({ chatId, topicId })}
            onChanged={invalidate}
            onNotice={setNotice}
          />
          <BotForm
            key={`${branchId}-${config.data?.id ?? 'none'}`}
            config={config.data ?? null}
            status={status}
            branchId={branchId || null}
            canManage={canManageBot}
            onSaved={(text) => {
              setNotice({ ok: true, text });
              invalidate();
            }}
            onError={(text) => setNotice({ ok: false, text })}
          />
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <EventsCard
            events={events.data ?? []}
            routes={routes.data ?? []}
            defaultChatId={config.data?.defaultChatId ?? null}
          />
          {can(Permission.SETTINGS_VIEW) && <MiniAppSettings canEdit={can(Permission.SETTINGS_UPDATE)} onNotice={setNotice} />}
        </div>
      </div>

      {routeForm && (
        <RouteForm
          initial={routeForm}
          events={events.data ?? []}
          routes={routes.data ?? []}
          branchId={branchId || null}
          onClose={() => setRouteForm(null)}
          onSaved={(text) => {
            setRouteForm(null);
            setNotice({ ok: true, text });
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Telegram allows exactly one webhook per bot, so pasting the same token into
 * a second deployment silently redirects every update there and this one goes
 * quiet with no error on either side. "Qayta ulash" reverses it.
 */
function WebhookMismatch({ status }: { status: TelegramBotStatus }) {
  return (
    <div className="banner banner--warning" style={{ alignItems: 'flex-start' }}>
      <IconAlert size={18} />
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>
        <div><b>{status.message}</b></div>
        <div>Kerakli manzil: <code style={{ wordBreak: 'break-all' }}>{status.expectedWebhookUrl}</code></div>
        <div>Hozirgi manzil: {status.webhookUrl ? <code style={{ wordBreak: 'break-all' }}>{status.webhookUrl}</code> : 'yoʻq'}</div>
        {status.webhookUrl && status.webhookUrl !== status.expectedWebhookUrl && (
          <div>Bu token boshqa serverga ulangan. Telegram bitta botga faqat bitta manzil beradi — “Qayta ulash” uni shu serverga qaytaradi.</div>
        )}
        {status.lastErrorMessage && <div className="muted">Telegram oxirgi xatosi: {status.lastErrorMessage}</div>}
      </div>
    </div>
  );
}

/** Routes grouped by the chat they post to — the way staff think about their groups. */
function GroupsCard({
  routes,
  defaultChatId,
  eventLabel,
  canManage,
  hasBot,
  onAdd,
  onChanged,
  onNotice,
}: {
  routes: TelegramRoute[];
  defaultChatId: string | null;
  eventLabel: (value: string) => string;
  canManage: boolean;
  hasBot: boolean;
  onAdd: (chatId: string, topicId: number | null) => void;
  onChanged: () => void;
  onNotice: Notify;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { chatId: string; topicId: number | null; routes: TelegramRoute[] }>();
    for (const r of routes) {
      const key = `${r.chatId}:${r.topicId ?? ''}`;
      const entry = map.get(key) ?? { chatId: r.chatId, topicId: r.topicId, routes: [] };
      entry.routes.push(r);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [routes]);

  const remove = useMutation({
    mutationFn: (id: string) => api.telegram.deleteRoute(id),
    onSuccess: () => {
      onNotice({ ok: true, text: 'Yoʻnalish oʻchirildi' });
      onChanged();
    },
    onError: (e) => onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Oʻchirilmadi' }),
  });
  const test = useMutation({
    mutationFn: (g: { chatId: string; topicId: number | null }) => api.telegram.testRoute(g),
    onSuccess: (result) => onNotice({ ok: result.ok, text: result.message }),
    onError: (e) => onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Yuborilmadi' }),
  });

  return (
    <Card
      title="Ulangan guruhlar va kanallar"
      sub="Qaysi hodisa qaysi guruhga (yoki topic'ga) yuboriladi"
      actions={
        canManage && (
          <button type="button" className="btn btn--sm" disabled={!hasBot} title={hasBot ? undefined : 'Avval bot tokenini sozlang'} onClick={() => onAdd('', null)}>
            <IconPlus size={14} /> Guruh ulash
          </button>
        )
      }
    >
      {!hasBot && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          <IconAlert size={16} /> Bot hali ulanmagan — guruhlarga xabar ketishi uchun platforma administratori botni biriktirishi kerak.
        </div>
      )}
      <div className="stack" style={{ gap: 10 }}>
        {defaultChatId && (
          <div className="tg-group">
            <span className="tg-group__icon"><IconTelegram size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}><b>Standart guruh</b><span className="pill tone-neutral">zaxira</span></div>
              <div className="cell-sub">Alohida yoʻnalishi yoʻq barcha hodisalar shu yerga boradi</div>
              <code className="cell-sub">ID: {defaultChatId}</code>
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div key={`${g.chatId}:${g.topicId ?? ''}`} className="tg-group">
            <span className="tg-group__icon"><IconUsers size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <code style={{ fontWeight: 700 }}>{g.chatId}</code>
                {g.topicId !== null && <span className="pill tone-info">topic {g.topicId}</span>}
              </div>
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {g.routes.map((r) => (
                  <span key={r.id} className={`pill ${r.isActive ? 'tone-success' : 'tone-neutral'}`}>
                    {eventLabel(r.event)}
                    {canManage && (
                      <button type="button" className="pill__x" aria-label={`${eventLabel(r.event)} yoʻnalishini oʻchirish`} disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
            {canManage && (
              <span className="row" style={{ gap: 4, flex: 'none' }}>
                <button type="button" className="btn btn--sm btn--ghost" disabled={test.isPending} onClick={() => test.mutate({ chatId: g.chatId, topicId: g.topicId })}>Sinash</button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label="Hodisa qoʻshish" title="Hodisa qoʻshish" onClick={() => onAdd(g.chatId, g.topicId)}><IconPlus size={14} /></button>
              </span>
            )}
          </div>
        ))}
        {groups.length === 0 && !defaultChatId && <p className="muted" style={{ margin: 0 }}>Hali guruh ulanmagan.</p>}
      </div>
      <details style={{ marginTop: 14 }}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Chat ID va Topic ID ni qanday topish mumkin?</summary>
        {/* Not getUpdates: the bot holds a webhook, so getUpdates answers 409. The bot reports the ids itself. */}
        <ol className="muted" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>Botni guruhga qoʻshing va unga administrator huquqini bering.</li>
          <li>Bot qoʻshilgan zahoti guruhga <b>Chat ID</b> ni oʻzi yozadi.</li>
          <li>Keyinroq kerak boʻlsa, guruhda <code>/id</code> yuboring — bot Chat ID va (topic ichida boʻlsa) Topic ID ni qaytaradi.</li>
          <li>Supergruppa ID si manfiy boʻladi va <code>-100…</code> bilan boshlanadi.</li>
        </ol>
      </details>
    </Card>
  );
}

/** Where each event ends up: its own route, the default group, or nowhere. */
function EventsCard({
  events,
  routes,
  defaultChatId,
}: {
  events: Array<{ value: string; label: string }>;
  routes: TelegramRoute[];
  defaultChatId: string | null;
}) {
  const routed = events.filter((e) => routes.some((r) => r.event === e.value && r.isActive)).length;
  return (
    <Card title="Hodisalar va bildirishnomalar" actions={<span className="pill tone-info">{routed}/{events.length} alohida</span>}>
      <div className="stack" style={{ gap: 8 }}>
        {events.map((e) => {
          const own = routes.filter((r) => r.event === e.value && r.isActive);
          return (
            <div key={e.value} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8, fontSize: 13 }}>
              <span>{e.label}</span>
              {own.length > 0 ? (
                <span className="pill tone-success" title={own.map((r) => r.chatId).join(', ')}>{own.length > 1 ? `${own.length} guruh` : 'Oʻz guruhi'}</span>
              ) : defaultChatId ? (
                <span className="pill tone-neutral">Standart guruh</span>
              ) : (
                <span className="pill tone-warning">Yuborilmaydi</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Connect a group: one chat, any number of events posted to it. */
function RouteForm({
  initial,
  events,
  routes,
  branchId,
  onClose,
  onSaved,
}: {
  initial: { chatId: string; topicId: number | null };
  events: Array<{ value: string; label: string }>;
  routes: TelegramRoute[];
  branchId: string | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [chatId, setChatId] = useState(initial.chatId);
  const [topicId, setTopicId] = useState(initial.topicId === null ? '' : String(initial.topicId));
  const already = new Set(routes.filter((r) => r.chatId === initial.chatId && (r.topicId ?? null) === initial.topicId).map((r) => r.event));
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      for (const event of picked) {
        await api.telegram.upsertRoute({
          event: event as TelegramRoute['event'],
          chatId: chatId.trim(),
          topicId: topicId.trim() ? Number(topicId) : null,
          branchId,
          isActive: true,
        });
      }
    },
    onSuccess: () => onSaved(`${picked.length} ta hodisa guruhga ulandi`),
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^-?\d{5,20}$|^@\w{5,32}$/.test(chatId.trim())) return setError('Chat ID notoʻgʻri (masalan -1001234567890)');
    if (picked.length === 0) return setError('Kamida bitta hodisani tanlang');
    setError(null);
    save.mutate();
  }

  return (
    <Drawer
      title={initial.chatId ? 'Guruhga hodisa qoʻshish' : 'Guruh ulash'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="route-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form id="route-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="rf-chat">Chat ID</label>
            <input id="rf-chat" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" disabled={Boolean(initial.chatId)} autoFocus={!initial.chatId} />
          </div>
          <div className="field">
            <label htmlFor="rf-topic">Topic ID</label>
            <input id="rf-topic" inputMode="numeric" value={topicId} onChange={(e) => setTopicId(e.target.value.replace(/\D/g, ''))} placeholder="ixtiyoriy" disabled={Boolean(initial.chatId)} />
          </div>
        </div>
        <div className="field">
          <span className="field__label">Hodisalar</span>
          <div className="stack" style={{ gap: 8 }}>
            {events.map((e) => (
              <label key={e.value} className="row" style={{ gap: 8, fontSize: 13.5, opacity: already.has(e.value as TelegramRoute['event']) ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  disabled={already.has(e.value as TelegramRoute['event'])}
                  checked={already.has(e.value as TelegramRoute['event']) || picked.includes(e.value)}
                  onChange={() => setPicked((p) => (p.includes(e.value) ? p.filter((x) => x !== e.value) : [...p, e.value]))}
                />
                {e.label}
                {already.has(e.value as TelegramRoute['event']) && <span className="muted">· ulangan</span>}
              </label>
            ))}
          </div>
        </div>
      </form>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

function BotForm({
  config,
  status,
  branchId,
  canManage,
  onSaved,
  onError,
}: {
  config: TelegramConfig | null;
  status: TelegramBotStatus | null;
  branchId: string | null;
  canManage: boolean;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [botToken, setBotToken] = useState('');
  const [defaultChatId, setDefaultChatId] = useState(config?.defaultChatId ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.telegram.saveConfig({
        branchId,
        // Omitted when blank, so saving the chat id does not require
        // re-typing a token the UI never shows.
        ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
        defaultChatId: defaultChatId.trim() || null,
        isActive: true,
      }),
    onSuccess: () => {
      setBotToken('');
      onSaved('Sozlamalar saqlandi');
    },
    onError: (error) => onError(error instanceof RestorApiError ? error.message : 'Saqlanmadi'),
  });

  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <Card title="Bot token va webhook" actions={<IconKey size={18} style={{ color: 'var(--text-subtle)' }} />}>
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {canManage ? (
            <>
              Tokenni <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>@BotFather</a> dan oling. Token shifrlangan holda saqlanadi va hech qachon qaytarilmaydi.
            </>
          ) : (
            'Botni platforma administratori ulaydi. Oʻzgartirish kerak boʻlsa, qoʻllab-quvvatlashga murojaat qiling — guruhlarni esa oʻzingiz boshqarasiz.'
          )}
        </p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="tg-token">
              Bot token {config?.hasToken && <span className="pill tone-success">sozlangan</span>}
            </label>
            <input
              id="tg-token"
              type="password"
              autoComplete="off"
              placeholder={config?.hasToken ? 'oʻzgartirish uchun yangisini kiriting' : '123456:ABC-DEF…'}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              disabled={!canManage}
            />
            {config?.botUsername && <span className="field__hint">@{config.botUsername}</span>}
          </div>
          <div className="field">
            <label htmlFor="tg-chat">Standart guruh (Chat ID)</label>
            <input id="tg-chat" placeholder="-1001234567890" value={defaultChatId} onChange={(e) => setDefaultChatId(e.target.value)} disabled={!canManage} />
            <span className="field__hint">Alohida yoʻnalishi yoʻq hodisalar shu yerga boradi</span>
          </div>
        </div>
        {status && (
          <dl className="kv">
            <dt>Webhook</dt>
            <dd>
              <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{status.expectedWebhookUrl}</code>{' '}
              <span className={`pill ${status.isConnected ? 'tone-success' : 'tone-warning'}`}>{status.isConnected ? 'ulangan' : 'ulanmagan'}</span>
            </dd>
            <dt>Mini App havolasi</dt>
            <dd className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
              <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{status.miniAppUrl}</code>
              <button type="button" className="icon-btn icon-btn--sm" aria-label="Nusxa olish" onClick={() => copy(status.miniAppUrl)}><IconCopy size={13} /></button>
            </dd>
          </dl>
        )}
        {canManage && (
          <button type="submit" className="btn" style={{ justifySelf: 'start' }} disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Tekshirilmoqda…' : 'Saqlash'}
          </button>
        )}
      </form>
    </Card>
  );
}
