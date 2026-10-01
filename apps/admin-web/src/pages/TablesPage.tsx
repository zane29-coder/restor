import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  WaiterCallStatus,
  WaiterCallType,
  type RestaurantTable,
  type WaiterCall,
} from '@restor/shared-types';
import { IconAlert, IconCheckCircle, IconPlus } from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading } from '../components/States';

/**
 * Tables and QR service (TZ §20).
 *
 * Two jobs on one screen because they belong to the same person: the floor
 * manager who sets the tables up in the morning is the one watching the call
 * queue at service.
 *
 * The call queue polls every ten seconds. A guest who pressed the button is
 * waiting at a table, and a minute of staleness there is a minute of someone
 * looking around for staff.
 */
export function TablesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const branches = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
  });

  const tables = useQuery({
    queryKey: ['tables', branchId],
    queryFn: () => api.tables.list(branchId || undefined),
  });

  const calls = useQuery({
    queryKey: ['waiter-calls', branchId],
    queryFn: () => api.tables.listCalls(branchId ? { branchId } : undefined),
    refetchInterval: 10_000,
  });

  if (tables.isLoading) return <Loading />;
  if (tables.isError) {
    return <ErrorState error={tables.error} onRetry={() => void tables.refetch()} />;
  }

  const items = tables.data ?? [];
  const openCalls = calls.data ?? [];
  const canManage = can(Permission.TABLES_MANAGE);
  const canHandle = can(Permission.WAITER_CALLS_HANDLE);

  // Zones group the floor the way staff talk about it.
  const zones = [...new Set(items.map((table) => table.zone ?? ''))].sort();

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {notice && (
        <div
          className="card row"
          style={{
            gap: 10,
            background: notice.ok ? '#F0FDF4' : '#FEF2F2',
            borderColor: notice.ok ? '#BBF7D0' : '#FECACA',
          }}
        >
          {notice.ok ? <IconCheckCircle /> : <IconAlert />}
          <span style={{ fontSize: 14 }}>{notice.text}</span>
        </div>
      )}

      {canHandle && openCalls.length > 0 && (
        <CallQueue
          calls={openCalls}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['waiter-calls'] })}
          onError={(text) => setNotice({ ok: false, text })}
        />
      )}

      <div className="row">
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
        >
          <option value="">Barcha filiallar</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>

        <div className="spacer" />

        {canManage && (
          <button type="button" className="btn" onClick={() => setIsCreating((v) => !v)}>
            <IconPlus size={16} /> Stol qoʻshish
          </button>
        )}
      </div>

      {isCreating && (
        <CreateTableForm
          branches={branches.data ?? []}
          defaultBranchId={branchId}
          onSaved={(text) => {
            setIsCreating(false);
            setNotice({ ok: true, text });
            void queryClient.invalidateQueries({ queryKey: ['tables'] });
          }}
          onCancel={() => setIsCreating(false)}
          onError={(text) => setNotice({ ok: false, text })}
        />
      )}

      {items.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Stol qoʻshilmagan. Har bir stolga QR kod beriladi — mehmon uni
            skanerlab menyuni koʻradi va ofitsiantni chaqiradi.
          </p>
        </div>
      ) : (
        zones.map((zone) => (
          <section key={zone}>
            <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
              {zone || 'Asosiy zal'}{' '}
              <span className="muted">
                ({items.filter((t) => (t.zone ?? '') === zone).length})
              </span>
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {items
                .filter((table) => (table.zone ?? '') === zone)
                .map((table) => (
                  <TableCard
                    key={table.id}
                    table={table}
                    canManage={canManage}
                    hasCall={openCalls.some((call) => call.tableId === table.id)}
                    onChanged={(text) => {
                      setNotice({ ok: true, text });
                      void queryClient.invalidateQueries({ queryKey: ['tables'] });
                    }}
                    onError={(text) => setNotice({ ok: false, text })}
                  />
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TableCard({
  table,
  canManage,
  hasCall,
  onChanged,
  onError,
}: {
  table: RestaurantTable;
  canManage: boolean;
  hasCall: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [showQr, setShowQr] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const fail = (caught: unknown, fallback: string) =>
    onError(caught instanceof RestorApiError ? caught.message : fallback);

  const rotate = useMutation({
    mutationFn: () => api.tables.rotateQr(table.id),
    onSuccess: () => {
      setConfirmRotate(false);
      onChanged(`${table.number}-stol QR kodi yangilandi — eski chop etilganlari ishlamaydi`);
    },
    onError: (caught) => fail(caught, 'Yangilanmadi'),
  });

  const toggle = useMutation({
    mutationFn: () => api.tables.update(table.id, { isActive: !table.isActive }),
    onSuccess: () =>
      onChanged(`${table.number}-stol ${table.isActive ? 'oʻchirildi' : 'yoqildi'}`),
    onError: (caught) => fail(caught, 'Oʻzgartirilmadi'),
  });

  return (
    <div
      className="card"
      style={{
        // A table with a guest waiting has to be findable at a glance across a
        // floor plan of forty.
        borderColor: hasCall ? '#F59E0B' : undefined,
        borderWidth: hasCall ? 2 : 1,
      }}
    >
      <div className="row" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: 18 }}>{table.number}</strong>
        <div className="spacer" />
        {hasCall && (
          <span className="badge" style={{ background: '#FEF3C7', color: '#B45309' }}>
            chaqirdi
          </span>
        )}
        {!table.isActive && (
          <span className="badge" style={{ background: '#F3F4F6', color: '#6B7280' }}>
            oʻchiq
          </span>
        )}
      </div>

      {table.name && <div style={{ fontSize: 13 }}>{table.name}</div>}
      <div className="muted" style={{ fontSize: 12 }}>
        {table.seats ? `${table.seats} oʻrin` : 'oʻrin koʻrsatilmagan'}
      </div>

      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn--ghost"
          style={smallBtn}
          onClick={() => setShowQr((v) => !v)}
        >
          {showQr ? 'Yopish' : 'QR kod'}
        </button>

        {canManage && (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              style={smallBtn}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate()}
            >
              {table.isActive ? 'Oʻchirish' : 'Yoqish'}
            </button>

            {confirmRotate ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={smallBtn}
                  onClick={() => setConfirmRotate(false)}
                >
                  Bekor
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  style={smallBtn}
                  disabled={rotate.isPending}
                  onClick={() => rotate.mutate()}
                >
                  Ha, yangilash
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--ghost"
                style={smallBtn}
                title="Eski chop etilgan QR kodlar ishlamay qoladi"
                onClick={() => setConfirmRotate(true)}
              >
                QR ni yangilash
              </button>
            )}
          </>
        )}
      </div>

      {showQr && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          {/*
            The QR image comes from a public generator rather than a bundled
            encoder: it is printed once per table and never rendered at scale,
            so a dependency for it would cost more than it returns. The URL it
            encodes is built server-side, so a printed code can never point at
            a stale path.
          */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(table.qrUrl)}`}
            alt={`${table.number}-stol QR kodi`}
            width={180}
            height={180}
            style={{ borderRadius: 8, background: '#fff' }}
          />
          <p className="muted" style={{ fontSize: 11, wordBreak: 'break-all', margin: '8px 0 0' }}>
            {table.qrUrl}
          </p>
          <button
            type="button"
            className="btn btn--ghost"
            style={{ ...smallBtn, marginTop: 8 }}
            onClick={() => window.print()}
          >
            Chop etish
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The call queue.
 *
 * Two steps rather than one: acknowledging tells the floor somebody is on the
 * way, resolving says it is done. With a single button a second waiter cannot
 * tell whether a call is being handled or has been ignored for four minutes.
 */
function CallQueue({
  calls,
  onChanged,
  onError,
}: {
  calls: WaiterCall[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const fail = (caught: unknown) =>
    onError(caught instanceof RestorApiError ? caught.message : 'Amal bajarilmadi');

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.tables.acknowledgeCall(id),
    onSuccess: onChanged,
    onError: fail,
  });

  const resolve = useMutation({
    mutationFn: (id: string) => api.tables.resolveCall(id),
    onSuccess: onChanged,
    onError: fail,
  });

  return (
    <section>
      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
        Chaqiruvlar <span className="muted">({calls.length})</span>
      </h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {calls.map((call) => (
          <div
            key={call.id}
            className="card row"
            style={{
              gap: 12,
              flexWrap: 'wrap',
              background: call.status === WaiterCallStatus.PENDING ? '#FFFBEB' : undefined,
              borderColor: call.status === WaiterCallStatus.PENDING ? '#FDE68A' : undefined,
            }}
          >
            <strong style={{ fontSize: 17, minWidth: 60 }}>{call.tableNumber}</strong>

            <span style={{ fontSize: 14 }}>
              {call.type === WaiterCallType.REQUEST_BILL
                ? 'Hisob soʻradi'
                : 'Ofitsiantni chaqirdi'}
            </span>

            <span className="muted" style={{ fontSize: 13 }}>
              {waitedFor(call.createdAt)}
            </span>

            <div className="spacer" />

            {call.status === WaiterCallStatus.PENDING ? (
              <button
                type="button"
                className="btn"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate(call.id)}
              >
                Ketdim
              </button>
            ) : (
              <>
                <span className="badge" style={{ background: '#DBEAFE', color: '#1E40AF' }}>
                  yoʻlda
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate(call.id)}
                >
                  Bajarildi
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CreateTableForm({
  branches,
  defaultBranchId,
  onSaved,
  onCancel,
  onError,
}: {
  branches: Array<{ id: string; name: string }>;
  defaultBranchId: string;
  onSaved: (message: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId || branches[0]?.id || '');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('');
  const [zone, setZone] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.tables.create({
        branchId,
        number: number.trim(),
        name: name.trim() || null,
        seats: seats.trim() ? Number(seats.replace(/\D/g, '')) : null,
        zone: zone.trim() || null,
      }),
    onSuccess: () => onSaved(`${number.trim()}-stol qoʻshildi`),
    onError: (caught) =>
      onError(caught instanceof RestorApiError ? caught.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!branchId || number.trim().length === 0) return;
    save.mutate();
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Yangi stol</h3>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Yopish
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 14,
        }}
      >
        <Labelled label="Filial">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={field}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Labelled>

        <Labelled label="Raqami" hint="12, 12a, VIP-2 — xohlagan koʻrinishda">
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="12" style={field} />
        </Labelled>

        <Labelled label="Nomi" hint="Ixtiyoriy">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deraza yoni" style={field} />
        </Labelled>

        <Labelled label="Oʻrin soni" hint="Ixtiyoriy">
          <input inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="4" style={field} />
        </Labelled>

        <Labelled label="Zona" hint="Terrassa, 2-qavat, VIP">
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Asosiy zal" style={field} />
        </Labelled>
      </div>

      <button type="submit" className="btn" style={{ marginTop: 16 }} disabled={save.isPending}>
        {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </form>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
    </label>
  );
}

const field = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 14,
} as const;

const smallBtn = { padding: '5px 10px', minHeight: 30, fontSize: 12 } as const;

/** "3 daqiqa kutmoqda" — the number a waiter is actually judged on. */
function waitedFor(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} soniya kutmoqda`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} daqiqa kutmoqda`;
}
