import { useQuery } from '@tanstack/react-query';
import { formatMoney, formatPhone } from '@restor/shared-utils';
import { api } from '../lib/api';
import { ErrorState, Empty, Loading } from '../components/States';

/** Branch list (TZ §8). */
export function BranchesPage() {
  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.branches.list({ limit: 100 }),
  });

  if (branches.isLoading) return <Loading />;
  if (branches.isError) {
    return <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />;
  }

  const items = branches.data?.items ?? [];
  if (items.length === 0) {
    return <Empty title="Filial yoʻq" description="Birinchi filialni qoʻshing." />;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
      {items.map((branch) => (
        <div key={branch.id} className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>{branch.name}</h2>
            <div className="spacer" />
            <span
              className="badge"
              style={{
                background: branch.isOpenNow ? '#DCFCE7' : '#FEE2E2',
                color: branch.isOpenNow ? '#166534' : '#991B1B',
              }}
            >
              {branch.isOpenNow ? 'Ochiq' : 'Yopiq'}
            </span>
          </div>

          <p className="muted" style={{ margin: '0 0 4px' }}>{branch.address}</p>
          {branch.phone && (
            <p className="muted" style={{ margin: '0 0 12px' }}>{formatPhone(branch.phone)}</p>
          )}

          <dl style={{ display: 'grid', gap: 5, margin: 0 }}>
            <Row label="Minimal buyurtma" value={formatMoney(branch.minOrderAmount)} />
            <Row label="Yetkazish narxi" value={formatMoney(branch.deliveryPrice)} />
            <Row
              label="Radius"
              value={branch.deliveryRadiusM ? `${(branch.deliveryRadiusM / 1000).toFixed(1)} km` : '—'}
            />
            <Row label="Tayyorlash" value={`${branch.averagePrepMinutes} min`} />
          </dl>

          <div className="row" style={{ marginTop: 12, gap: 6 }}>
            {branch.acceptsDelivery && <span className="badge" style={tone}>Yetkazish</span>}
            {branch.acceptsPickup && <span className="badge" style={tone}>Olib ketish</span>}
            {branch.acceptsDineIn && <span className="badge" style={tone}>Zalda</span>}
          </div>

          {branch.workingHours.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                Ish vaqti
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {branch.workingHours.map((hours) => (
                  <li key={hours.id} className="muted">
                    {WEEKDAYS[hours.dayOfWeek - 1]}:{' '}
                    {hours.isClosed ? 'yopiq' : `${hours.opensAt}–${hours.closesAt}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

const tone = { background: 'var(--primary-light)', color: '#9A3412' } as const;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
