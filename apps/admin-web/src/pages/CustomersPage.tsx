import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, type Customer } from '@restor/shared-types';
import { formatMoney, formatPhone } from '@restor/shared-utils';
import { IconSearch } from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Drawer } from '../components/Drawer';
import { ErrorState, Loading, Notice } from '../components/States';

/**
 * Customers and loyalty (TZ §10).
 *
 * Customer rows have accumulated since the first order — every phone order
 * creates or matches one — so this screen exposes data that was already there
 * rather than asking anyone to enter it.
 *
 * Search is the primary action, not browsing: a manager opens this while
 * someone is on the phone, and they have a number, not a position in a list.
 */
export function CustomersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const customers = useQuery({
    queryKey: ['customers', query],
    queryFn: () => api.customers.list({ search: query || undefined, limit: 50 }),
  });

  if (customers.isLoading) return <Loading />;
  if (customers.isError) {
    return <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />;
  }

  const items = customers.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      {can(Permission.LOYALTY_VIEW) && (
        <LoyaltySettings
          canManage={can(Permission.LOYALTY_MANAGE)}
          onNotice={setNotice}
        />
      )}

      <form
        className="row"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Telefon, ism yoki Telegram username"
          style={{
            flex: 1,
            padding: '9px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            fontSize: 14,
          }}
        />
        <button type="submit" className="btn">
          <IconSearch size={16} /> Qidirish
        </button>
        {query && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setSearch('');
              setQuery('');
            }}
          >
            Tozalash
          </button>
        )}
      </form>

      {items.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {query ? 'Hech narsa topilmadi.' : 'Hali mijoz yoʻq.'}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mijoz</th>
                <th>Telefon</th>
                <th>Buyurtma</th>
                <th>Jami xarid</th>
                <th>Oʻrtacha chek</th>
                <th>Oxirgi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.fullName ?? '—'}</strong>
                    {customer.isBlocked && (
                      <span
                        className="badge"
                        style={{ background: '#FEE2E2', color: '#991B1B', marginLeft: 8 }}
                      >
                        bloklangan
                      </span>
                    )}
                    {customer.telegramUsername && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        @{customer.telegramUsername}
                      </div>
                    )}
                  </td>
                  <td>{formatPhone(customer.phone)}</td>
                  <td>{customer.ordersCount}</td>
                  <td>{formatMoney(customer.totalSpent)}</td>
                  <td>{formatMoney(customer.averageCheck)}</td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {customer.lastOrderAt
                      ? new Date(customer.lastOrderAt).toLocaleDateString('uz-UZ')
                      : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '5px 10px', minHeight: 30, fontSize: 12 }}
                      onClick={() =>
                        setSelected(selected === customer.id ? null : customer.id)
                      }
                    >
                      {selected === customer.id ? 'Yopish' : 'Batafsil'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <CustomerDetail
          customerId={selected}
          canUpdate={can(Permission.CUSTOMERS_UPDATE)}
          onNotice={setNotice}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CustomerDetail({
  customerId,
  canUpdate,
  onNotice,
  onClose,
}: {
  customerId: string;
  canUpdate: boolean;
  onNotice: (n: { ok: boolean; text: string }) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const customer = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api.customers.get(customerId),
  });

  const orders = useQuery({
    queryKey: ['customer', customerId, 'orders'],
    queryFn: () => api.customers.orders(customerId, { limit: 10 }),
  });

  const points = useQuery({
    queryKey: ['customer', customerId, 'loyalty'],
    queryFn: () => api.customers.loyaltyTransactions(customerId, { limit: 10 }),
  });

  const toggleBlock = useMutation({
    mutationFn: (block: boolean) =>
      block ? api.customers.block(customerId) : api.customers.unblock(customerId),
    onSuccess: (_result, block) => {
      onNotice({ ok: true, text: block ? 'Mijoz bloklandi' : 'Blok olib tashlandi' });
      void queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (error) =>
      onNotice({
        ok: false,
        text: error instanceof RestorApiError ? error.message : 'Amal bajarilmadi',
      }),
  });

  if (!customer.data) {
    return (
      <Drawer title="Mijoz" onClose={onClose}>
        {customer.isError ? (
          <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />
        ) : (
          <Loading />
        )}
      </Drawer>
    );
  }

  const detail = customer.data as Customer;

  return (
    <Drawer title={detail.fullName ?? formatPhone(detail.phone)} onClose={onClose}>
      {/* The page notice sits behind the drawer; show a failed block here too. */}
      {toggleBlock.isError && (
        <div className="alert alert--error">
          {toggleBlock.error instanceof RestorApiError
            ? toggleBlock.error.message
            : 'Amal bajarilmadi'}
        </div>
      )}

      <div className="row" style={{ marginBottom: 18 }}>
        <span className="muted">{formatPhone(detail.phone)}</span>
        <div className="spacer" />
        {detail.loyalty && (
          <span className="badge" style={{ background: '#EDE9FE', color: '#5B21B6' }}>
            {detail.loyalty.points} ball
          </span>
        )}
        {canUpdate && (
          <button
            type="button"
            className={detail.isBlocked ? 'btn btn--ghost' : 'btn btn--danger'}
            disabled={toggleBlock.isPending}
            onClick={() => toggleBlock.mutate(!detail.isBlocked)}
          >
            {detail.isBlocked ? 'Blokni ochish' : 'Bloklash'}
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 20,
        }}
      >
        <div>
          <h4 style={sectionTitle}>OXIRGI BUYURTMALAR</h4>
          {(orders.data?.items ?? []).length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Buyurtma yoʻq.</p>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {orders.data?.items.map((order) => (
                <div key={order.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>{order.displayNumber}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {new Date(order.createdAt).toLocaleDateString('uz-UZ')}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {formatMoney(order.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 style={sectionTitle}>BALL HARAKATLARI</h4>
          {(points.data?.items ?? []).length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Hali ball yigʻilmagan.</p>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {points.data?.items.map((entry) => (
                <div key={entry.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>{entry.comment ?? entry.type}</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: entry.points >= 0 ? '#166534' : '#991B1B',
                    }}
                  >
                    {entry.points >= 0 ? '+' : ''}
                    {entry.points}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 style={sectionTitle}>MANZILLAR</h4>
          {(detail.addresses ?? []).length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Manzil saqlanmagan.</p>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {detail.addresses?.map((address) => (
                <div key={address.id} style={{ fontSize: 13 }}>
                  {address.label && <strong>{address.label}: </strong>}
                  {address.address}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/**
 * Cashback settings.
 *
 * The worked example under the fields is the point of this block: "5%" and
 * "one point = 1 soʻm" are two abstract numbers until you see that a 100 000
 * order returns 5 000 soʻm of value. Restaurants have given away far more
 * than they intended by not doing that multiplication.
 */
function LoyaltySettings({
  canManage,
  onNotice,
}: {
  canManage: boolean;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const program = useQuery({
    queryKey: ['loyalty', 'program'],
    queryFn: () => api.customers.loyaltyProgram(),
  });

  const [cashback, setCashback] = useState('');
  const [pointValue, setPointValue] = useState('');
  const [maxRedeem, setMaxRedeem] = useState('');

  const save = useMutation({
    mutationFn: (payload: Parameters<typeof api.customers.updateLoyaltyProgram>[0]) =>
      api.customers.updateLoyaltyProgram(payload),
    onSuccess: () => {
      onNotice({ ok: true, text: 'Sodiqlik dasturi saqlandi' });
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
    },
    onError: (error) =>
      onNotice({
        ok: false,
        text: error instanceof RestorApiError ? error.message : 'Saqlanmadi',
      }),
  });

  if (!program.data) return null;
  const current = program.data;

  const cashbackValue = cashback === '' ? current.cashbackPercent : digits(cashback);
  const pointValueNum = pointValue === '' ? current.pointValue : digits(pointValue);
  const maxRedeemValue = maxRedeem === '' ? current.maxRedeemPercent : digits(maxRedeem);

  const example = Math.floor((100_000 * cashbackValue) / 100) * pointValueNum;

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ fontSize: 15, margin: 0 }}>Sodiqlik dasturi</h3>
        <span
          className="badge"
          style={{
            background: current.isActive ? '#DCFCE7' : '#F3F4F6',
            color: current.isActive ? '#166534' : '#6B7280',
            marginLeft: 8,
          }}
        >
          {current.isActive ? 'Yoqilgan' : 'Oʻchiq'}
        </span>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? 'Yopish' : 'Sozlash'}
        </button>
      </div>

      {isOpen && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 14,
              marginTop: 16,
            }}
          >
            <Field label="Keshbek (%)" hint="Buyurtmaning necha foizi ball boʻlib qaytadi">
              <input
                inputMode="numeric"
                value={cashback}
                onChange={(e) => setCashback(e.target.value)}
                placeholder={String(current.cashbackPercent)}
                disabled={!canManage}
                style={fieldStyle}
              />
            </Field>

            <Field label="1 ball qiymati (soʻm)" hint="Ball sarflanganda qancha chegirma beradi">
              <input
                inputMode="numeric"
                value={pointValue}
                onChange={(e) => setPointValue(e.target.value)}
                placeholder={String(current.pointValue)}
                disabled={!canManage}
                style={fieldStyle}
              />
            </Field>

            <Field label="Maksimal toʻlov (%)" hint="Hisobning necha foizini ball qoplaydi">
              <input
                inputMode="numeric"
                value={maxRedeem}
                onChange={(e) => setMaxRedeem(e.target.value)}
                placeholder={String(current.maxRedeemPercent)}
                disabled={!canManage}
                style={fieldStyle}
              />
            </Field>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg, #F9FAFB)',
              border: '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            <strong>{formatMoney(100_000)}</strong> lik buyurtma{' '}
            <strong>{Math.floor((100_000 * cashbackValue) / 100)}</strong> ball beradi —
            bu <strong>{formatMoney(example)}</strong> qiymatida.
            {maxRedeemValue < 100 && (
              <> Keyingi hisobning eng koʻpi {maxRedeemValue}% i ball bilan toʻlanadi.</>
            )}
          </div>

          {canManage && (
            <div className="row" style={{ gap: 10, marginTop: 14 }}>
              <button
                type="button"
                className="btn"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    cashbackPercent: cashbackValue,
                    pointValue: pointValueNum,
                    maxRedeemPercent: maxRedeemValue,
                  })
                }
              >
                Saqlash
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={save.isPending}
                onClick={() => save.mutate({ isActive: !current.isActive })}
              >
                {current.isActive ? 'Dasturni oʻchirish' : 'Dasturni yoqish'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
    </label>
  );
}

const sectionTitle = {
  fontSize: 11,
  letterSpacing: 0.8,
  fontWeight: 800,
  color: '#6B7280',
  margin: '0 0 8px',
} as const;

const fieldStyle = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 14,
} as const;

function digits(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}
