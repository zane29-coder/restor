import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, type TelegramConfig, type TelegramRoute } from '@restor/shared-types';
import { IconAlert, IconCheckCircle, IconClose, IconPlus } from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading } from '../components/States';

/**
 * Telegram settings (TZ §15).
 *
 * Two things an admin configures here: the bot, and where each event goes.
 * Routing is per event AND per branch, which is what lets a chain send
 * Chilonzor's orders to Chilonzor's group.
 */
export function TelegramPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [branchId, setBranchId] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const branches = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
  });

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

  const canManage = can(Permission.TELEGRAM_MANAGE);

  if (config.isLoading || branches.isLoading) return <Loading />;
  if (config.isError) {
    return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['telegram'] });
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row">
        <label htmlFor="tg-branch" className="muted">
          Sozlama doirasi:
        </label>
        <select
          id="tg-branch"
          value={branchId}
          onChange={(event) => {
            setBranchId(event.target.value);
            setNotice(null);
          }}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
        >
          {/* Tenant-wide settings are the fallback for every branch. */}
          <option value="">Butun restoran (standart)</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </div>

      {notice && (
        <div
          className={`alert ${notice.ok ? 'alert--info' : 'alert--error'}`}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
        >
          {notice.ok ? <IconCheckCircle size={16} /> : <IconAlert size={16} />}
          {notice.text}
        </div>
      )}

      <BotForm
        config={config.data ?? null}
        branchId={branchId || null}
        canManage={canManage}
        onSaved={(message) => {
          setNotice({ ok: true, text: message });
          invalidate();
        }}
        onError={(message) => setNotice({ ok: false, text: message })}
      />

      <RoutesCard
        routes={routes.data ?? []}
        events={events.data ?? []}
        branchId={branchId || null}
        canManage={canManage}
        hasBot={Boolean(config.data?.hasToken)}
        onChanged={invalidate}
        onNotice={setNotice}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BotForm({
  config,
  branchId,
  canManage,
  onSaved,
  onError,
}: {
  config: TelegramConfig | null;
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
        // re-typing a token the UI never showed.
        ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
        defaultChatId: defaultChatId.trim() || null,
        isActive: true,
      }),
    onSuccess: () => {
      setBotToken('');
      onSaved('Sozlamalar saqlandi');
    },
    onError: (error) =>
      onError(error instanceof RestorApiError ? error.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>Bot</h2>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 16px' }}>
        Tokenni{' '}
        <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
          @BotFather
        </a>{' '}
        dan oling. Token shifrlangan holda saqlanadi va hech qachon qaytarilmaydi.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div className="field">
          <label htmlFor="tg-token">
            Bot token{' '}
            {config?.hasToken && (
              <span className="badge" style={{ background: '#DCFCE7', color: '#166534' }}>
                sozlangan
              </span>
            )}
          </label>
          <input
            id="tg-token"
            type="password"
            autoComplete="off"
            placeholder={config?.hasToken ? 'oʻzgartirish uchun yangisini kiriting' : '123456:ABC-DEF…'}
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
            disabled={!canManage}
          />
          {config?.botUsername && (
            <span className="muted" style={{ fontSize: 12 }}>
              @{config.botUsername}
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="tg-chat">Standart guruh (Chat ID)</label>
          <input
            id="tg-chat"
            placeholder="-1001234567890"
            value={defaultChatId}
            onChange={(event) => setDefaultChatId(event.target.value)}
            disabled={!canManage}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Alohida marshrut yoʻq hodisalar shu yerga boradi
          </span>
        </div>
      </div>

      {canManage && (
        <button type="submit" className="btn" disabled={save.isPending}>
          {save.isPending ? 'Tekshirilmoqda…' : 'Saqlash'}
        </button>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function RoutesCard({
  routes,
  events,
  branchId,
  canManage,
  hasBot,
  onChanged,
  onNotice,
}: {
  routes: TelegramRoute[];
  events: Array<{ value: string; label: string }>;
  branchId: string | null;
  canManage: boolean;
  hasBot: boolean;
  onChanged: () => void;
  onNotice: (notice: { ok: boolean; text: string }) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [event, setEvent] = useState('');
  const [chatId, setChatId] = useState('');
  const [topicId, setTopicId] = useState('');

  const upsert = useMutation({
    mutationFn: () =>
      api.telegram.upsertRoute({
        event: event as TelegramRoute['event'],
        chatId: chatId.trim(),
        topicId: topicId.trim() ? Number(topicId) : null,
        branchId,
        isActive: true,
      }),
    onSuccess: () => {
      setIsAdding(false);
      setEvent('');
      setChatId('');
      setTopicId('');
      onNotice({ ok: true, text: 'Marshrut saqlandi' });
      onChanged();
    },
    onError: (error) =>
      onNotice({
        ok: false,
        text: error instanceof RestorApiError ? error.message : 'Saqlanmadi',
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.telegram.deleteRoute(id),
    onSuccess: () => {
      onNotice({ ok: true, text: 'Marshrut oʻchirildi' });
      onChanged();
    },
  });

  const test = useMutation({
    mutationFn: (route: TelegramRoute) =>
      api.telegram.testRoute({ chatId: route.chatId, topicId: route.topicId }),
    onSuccess: (result) => onNotice({ ok: result.ok, text: result.message }),
    onError: (error) =>
      onNotice({
        ok: false,
        text: error instanceof RestorApiError ? error.message : 'Yuborilmadi',
      }),
  });

  const eventLabel = (value: string) =>
    events.find((entry) => entry.value === value)?.label ?? value;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, margin: '0 0 2px' }}>Hodisa marshrutlari</h2>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Har bir hodisani alohida guruh yoki topic'ga yoʻnaltiring
          </p>
        </div>
        <div className="spacer" />
        {canManage && (
          <button
            type="button"
            className="btn"
            disabled={!hasBot}
            title={hasBot ? undefined : 'Avval bot tokenini sozlang'}
            onClick={() => setIsAdding((value) => !value)}
          >
            {isAdding ? <IconClose size={16} /> : <IconPlus size={16} />}
            {isAdding ? 'Bekor qilish' : 'Marshrut'}
          </button>
        )}
      </div>

      {!hasBot && (
        <div className="alert alert--info" style={{ display: 'flex', gap: 8 }}>
          <IconAlert size={16} />
          Marshrut qoʻshishdan oldin bot tokenini saqlang.
        </div>
      )}

      {isAdding && (
        <form
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            upsert.mutate();
          }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 12,
            padding: 14,
            background: 'var(--surface-alt)',
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          <div className="field">
            <label htmlFor="r-event">Hodisa</label>
            <select
              id="r-event"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              required
            >
              <option value="" disabled>
                — tanlang —
              </option>
              {events.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="r-chat">Chat ID</label>
            <input
              id="r-chat"
              placeholder="-1001234567890"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="r-topic">Topic ID</label>
            <input
              id="r-topic"
              type="number"
              placeholder="ixtiyoriy"
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 14 }}>
            <button type="submit" className="btn" disabled={upsert.isPending}>
              {upsert.isPending ? 'Saqlanmoqda…' : 'Qoʻshish'}
            </button>
          </div>
        </form>
      )}

      {routes.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Marshrut yoʻq — barcha bildirishnomalar standart guruhga boradi.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hodisa</th>
                <th>Chat ID</th>
                <th>Topic</th>
                <th>Holat</th>
                <th>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.id}>
                  <td>
                    <strong>{eventLabel(route.event)}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      <code>{route.event}</code>
                    </div>
                  </td>
                  <td>
                    <code>{route.chatId}</code>
                  </td>
                  <td>{route.topicId ?? <span className="muted">General</span>}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: route.isActive ? '#DCFCE7' : '#FEE2E2',
                        color: route.isActive ? '#166534' : '#991B1B',
                      }}
                    >
                      {route.isActive ? 'Faol' : 'Oʻchiq'}
                    </span>
                  </td>
                  <td>
                    {canManage ? (
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          style={{ padding: '5px 10px', minHeight: 30, fontSize: 12 }}
                          disabled={test.isPending}
                          onClick={() => test.mutate(route)}
                        >
                          Sinash
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          style={{ padding: '5px 10px', minHeight: 30, fontSize: 12 }}
                          onClick={() => remove.mutate(route.id)}
                        >
                          Oʻchirish
                        </button>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
          Chat ID va Topic ID ni qanday topish mumkin?
        </summary>
        <ol className="muted" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 20 }}>
          <li>Botni guruhga qoʻshing va unga administrator huquqini bering.</li>
          <li>
            Guruhda istalgan xabar yozing, soʻng{' '}
            <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> ni oching.
          </li>
          <li>
            <code>chat.id</code> — guruh ID si (supergruppada manfiy, <code>-100…</code> bilan
            boshlanadi).
          </li>
          <li>
            <code>message_thread_id</code> — topic ID si. Topic'da yozilgan xabarda koʻrinadi.
          </li>
        </ol>
      </details>
    </div>
  );
}
