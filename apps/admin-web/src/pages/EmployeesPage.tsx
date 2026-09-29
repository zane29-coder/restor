import { useQuery } from '@tanstack/react-query';
import { formatPhone } from '@restor/shared-utils';
import { api } from '../lib/api';
import { ErrorState, Empty, Loading } from '../components/States';

/** Staff list with roles and branch scope (TZ §46). */
export function EmployeesPage() {
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.employees.list({ limit: 100 }),
  });

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.roles.list(),
  });

  if (employees.isLoading) return <Loading />;
  if (employees.isError) {
    return <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />;
  }

  const items = employees.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {roles.data && (
        <div className="card">
          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Rollar</h2>
          <div className="row" style={{ gap: 8 }}>
            {roles.data.map((role) => (
              <span
                key={role.id}
                className="badge"
                title={`${role.permissions.length} ruxsat`}
                style={{
                  background: role.isSystem ? 'var(--surface-alt)' : 'var(--primary-light)',
                  color: role.isSystem ? 'var(--text)' : '#9A3412',
                }}
              >
                {role.name} · {role.userCount ?? 0}
              </span>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
            Tizim rollari oʻzgartirilmaydi — nusxa olib, oʻz rolingizni yarating.
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <Empty title="Xodim yoʻq" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ism</th>
                <th>Telefon</th>
                <th>Lavozim</th>
                <th>Rollar</th>
                <th>Filial doirasi</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {items.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <strong>{employee.user?.fullName ?? '—'}</strong>
                  </td>
                  <td>{employee.user ? formatPhone(employee.user.phone) : '—'}</td>
                  <td>{employee.position ?? '—'}</td>
                  <td>
                    {employee.user?.roles.map((role) => (
                      <span key={role.id} className="badge" style={{ marginRight: 5 }}>
                        {role.name}
                      </span>
                    )) ?? '—'}
                  </td>
                  <td className="muted">
                    {/* Empty means every branch — how owners/admins are stored. */}
                    {employee.user?.branchIds.length
                      ? `${employee.user.branchIds.length} ta filial`
                      : 'Barcha filiallar'}
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: employee.isActive ? '#DCFCE7' : '#FEE2E2',
                        color: employee.isActive ? '#166534' : '#991B1B',
                      }}
                    >
                      {employee.isActive ? 'Faol' : 'Oʻchiq'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
