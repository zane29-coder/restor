import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, type Employee } from '@restor/shared-types';
import {
  IconBadge,
  IconBan,
  IconBranch,
  IconCheck,
  IconCourier,
  IconDownload,
  IconEdit,
  IconKey,
  IconKitchen,
  IconPhone,
  IconPos,
  IconSearch,
  IconShield,
  IconUserPlus,
  IconUsers,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { dateOf, dayTimeOf, initialsOf, phone } from '../lib/format';
import { ROLE_LABELS } from '../lib/labels';
import { GROUP_LABELS, TENANT_GROUPS, permissionLabel } from '../lib/permissions';
import { Drawer } from '../components/Drawer';
import { EmployeeForm } from '../components/employees/EmployeeForm';
import { RolesManager } from '../components/employees/RolesManager';
import { ErrorState, Loading, Notice } from '../components/States';
import { Kpi, PageHeader, Pager, Seg, SidePanel, downloadCsv } from '../components/ui';

type StatusFilter = 'active' | 'blocked' | 'all';

const roleOf = (code: string, name: string, isSystem: boolean) => (isSystem ? (ROLE_LABELS[code] ?? name) : name);

/**
 * Staff and what each may do (TZ §5, §46).
 *
 * The permission list in the panel is the union of the person's roles — the
 * same set the API resolves into their token — so what it shows is what they
 * can actually do, not what someone intended.
 */
export function EmployeesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { branches } = useBranch();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ employee: Employee | null } | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const limit = 20;

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () => {
      const all: Employee[] = [];
      for (let p = 1; p <= 10; p++) {
        const res = await api.employees.list({ page: p, limit: 100 });
        all.push(...res.items);
        if (!res.pagination.hasNext) break;
      }
      return all;
    },
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.roles.list(), enabled: can(Permission.ROLES_VIEW) });

  const openId = params.get('id');
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  const all = employees.data ?? [];
  const hasRole = (e: Employee, ...codes: string[]) => e.user?.roles.some((r) => codes.includes(r.code)) ?? false;

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase().replace(/\s/g, '');
    return all.filter((e) => {
      if (status === 'active' && !e.isActive) return false;
      if (status === 'blocked' && e.isActive) return false;
      if (roleFilter && !e.user?.roles.some((r) => r.id === roleFilter)) return false;
      if (branchFilter && e.user?.branchIds.length && !e.user.branchIds.includes(branchFilter)) return false;
      if (!needle) return true;
      const hay = `${e.user?.fullName ?? ''}${e.user?.phone ?? ''}${e.employeeCode ?? ''}${e.position ?? ''}`.toLowerCase().replace(/\s/g, '');
      return hay.includes(needle);
    });
  }, [all, text, status, roleFilter, branchFilter]);

  const pageRows = filtered.slice((page - 1) * limit, page * limit);
  const active = all.filter((e) => e.isActive);
  const share = (n: number) => (active.length ? `${Math.round((n / active.length) * 100)}%` : '—');
  const managers = active.filter((e) => hasRole(e, 'BRANCH_MANAGER', 'COMPANY_ADMIN', 'OWNER')).length;
  const cashiers = active.filter((e) => hasRole(e, 'CASHIER', 'OPERATOR')).length;
  const kitchen = active.filter((e) => hasRole(e, 'KITCHEN')).length;
  const couriers = active.filter((e) => hasRole(e, 'COURIER')).length;
  const openEmployee = all.find((e) => e.id === openId);

  if (employees.isLoading) return <Loading />;
  if (employees.isError) return <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />;

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <PageHeader
        crumb="Xodimlar"
        title="Xodimlar va huquqlar"
        badge={<span className="pill tone-primary">{active.length} xodim</span>}
        subtitle="Restoran xodimlari, rollar, filialga biriktirish va tizimga kirish huquqlari"
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => exportStaff(filtered, branches)}>
              <IconDownload size={16} /> Eksport
            </button>
            {can(Permission.ROLES_VIEW) && (
              <button type="button" className="btn btn--ghost" onClick={() => setRolesOpen(true)}>
                <IconShield size={16} /> Rollar va huquqlar
              </button>
            )}
            {can(Permission.EMPLOYEES_CREATE) && (
              <button type="button" className="btn" onClick={() => setForm({ employee: null })}>
                <IconUserPlus size={17} /> Yangi xodim
              </button>
            )}
          </>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        <Kpi label="Jami xodimlar" value={active.length} unit="nafar" Icon={IconUsers} tone="tone-primary" foot={<span>{all.length - active.length} ta bloklangan</span>} />
        <Kpi label="Rahbarlar va menejerlar" value={managers} unit="nafar" Icon={IconShield} tone="tone-violet" foot={<span>{share(managers)}</span>} />
        <Kpi label="Kassir va operatorlar" value={cashiers} unit="nafar" Icon={IconPos} tone="tone-info" foot={<span>{share(cashiers)}</span>} />
        <Kpi label="Oshxona" value={kitchen} unit="nafar" Icon={IconKitchen} tone="tone-warning" foot={<span>{share(kitchen)}</span>} />
        <Kpi label="Kuryerlar" value={couriers} unit="nafar" Icon={IconCourier} tone="tone-success" foot={<span>Kuryerlar boʻlimida boshqariladi</span>} />
      </div>

      <div className="toolbar">
        <div className="search-input">
          <IconSearch size={16} />
          <input type="search" placeholder="Ism, telefon yoki xodim ID…" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} aria-label="Xodimlarni qidirish" />
        </div>
        <select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }} aria-label="Filial">
          <option value="">Barcha filiallar</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} aria-label="Rol">
          <option value="">Barcha rollar</option>
          {roles.data?.map((r) => <option key={r.id} value={r.id}>{roleOf(r.code, r.name, r.isSystem)}</option>)}
        </select>
        <Seg
          label="Holat"
          quiet
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: 'active', label: 'Faol', count: active.length },
            { value: 'blocked', label: 'Bloklangan', count: all.length - active.length },
            { value: 'all', label: 'Barchasi' },
          ]}
        />
      </div>

      <div className={`split${openEmployee ? '' : ' split--single'}`}>
        <section className="card card--flush">
          {filtered.length === 0 ? (
            <p className="muted" style={{ padding: '56px 16px', textAlign: 'center' }}>Xodim topilmadi</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Xodim</th>
                    <th>Telefon va login</th>
                    <th>Lavozim va rol</th>
                    <th>Filial</th>
                    <th>Oxirgi kirish</th>
                    <th>Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((e) => (
                    <tr key={e.id} className={`row--clickable${e.id === openId ? ' row--selected' : ''}`} onClick={() => open(e.id)}>
                      <td>
                        <div className="cell-person">
                          {e.user?.avatarUrl ? <img className="avatar" src={e.user.avatarUrl} alt="" /> : <span className="avatar">{initialsOf(e.user?.fullName)}</span>}
                          <div className="cell-stack">
                            <span className="cell-main">{e.user?.fullName ?? '—'}</span>
                            <span className="cell-sub">{e.employeeCode ? `ID: ${e.employeeCode}` : 'ID berilmagan'}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span>{phone(e.user?.phone)}</span>
                          <span className="cell-sub">{e.user?.email ?? '—'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <span>{e.position ?? '—'}</span>
                          <span className="row" style={{ gap: 4 }}>
                            {e.user?.roles.map((r) => (
                              <span key={r.id} className={`pill ${r.isSystem ? 'tone-info' : 'tone-primary'}`}>{roleOf(r.code, r.name, r.isSystem)}</span>
                            ))}
                          </span>
                        </div>
                      </td>
                      <td className="cell-sub">
                        <span className="row" style={{ gap: 4 }}>
                          <IconBranch size={13} />
                          {e.user?.branchIds.length
                            ? e.user.branchIds.map((id) => branches.find((b) => b.id === id)?.name ?? '—').join(', ')
                            : 'Barcha filiallar'}
                        </span>
                      </td>
                      <td className="cell-sub">{e.user?.lastLoginAt ? dayTimeOf(e.user.lastLoginAt) : 'Hali kirmagan'}</td>
                      <td><span className={`pill ${e.isActive ? 'tone-success' : 'tone-danger'}`}>{e.isActive ? 'Faol' : 'Bloklangan'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card__foot">
            <span>Koʻrsatilmoqda: {filtered.length ? `${(page - 1) * limit + 1}–${Math.min(page * limit, filtered.length)}` : 0} / {filtered.length}</span>
            <Pager page={page} totalPages={Math.max(1, Math.ceil(filtered.length / limit))} onChange={setPage} />
          </div>
        </section>

        {openEmployee && (
          <EmployeePanel
            employee={openEmployee}
            rolePermissions={new Map((roles.data ?? []).map((r) => [r.id, r.permissions]))}
            onClose={() => open(null)}
            onEdit={() => setForm({ employee: openEmployee })}
            onNotice={setNotice}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: ['employees'] })}
          />
        )}
      </div>

      {form && (
        <EmployeeForm
          employee={form.employee}
          branches={branches}
          onClose={() => setForm(null)}
          onSaved={(text) => {
            setForm(null);
            setNotice({ ok: true, text });
          }}
        />
      )}
      {rolesOpen && (
        <Drawer title="Rollar va huquqlar matritsasi" onClose={() => setRolesOpen(false)} width="full">
          <RolesManager />
        </Drawer>
      )}
    </div>
  );
}

function EmployeePanel({
  employee,
  rolePermissions,
  onClose,
  onEdit,
  onNotice,
  onChanged,
}: {
  employee: Employee;
  rolePermissions: Map<string, string[]>;
  onClose: () => void;
  onEdit: () => void;
  onNotice: (n: { ok: boolean; text: string }) => void;
  onChanged: () => void;
}) {
  const { can, user: me } = useAuth();
  const { branches } = useBranch();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const user = employee.user;
  const isMe = user?.id === me?.id;

  const granted = new Set((user?.roles ?? []).flatMap((r) => rolePermissions.get(r.id) ?? []));
  const fail = (e: unknown) => setError(e instanceof RestorApiError ? e.message : 'Amal bajarilmadi');

  const reset = useMutation({
    mutationFn: () => api.employees.resetPassword(employee.id, password),
    onSuccess: () => {
      setResetting(false);
      setPassword('');
      setError(null);
      onNotice({ ok: true, text: `${user?.fullName}: parol yangilandi` });
    },
    onError: fail,
  });
  const block = useMutation({
    mutationFn: () => (employee.isActive ? api.employees.deactivate(employee.id) : api.employees.update(employee.id, { isActive: true })),
    onSuccess: () => {
      setError(null);
      onChanged();
      onNotice({ ok: true, text: employee.isActive ? `${user?.fullName} bloklandi` : `${user?.fullName} qayta faollashtirildi` });
    },
    onError: fail,
  });

  return (
    <SidePanel
      title="Xodim tafsilotlari"
      onClose={onClose}
      footer={
        <>
          {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
          {resetting && (
            <div className="stack" style={{ gap: 6 }}>
              <input type="password" autoComplete="new-password" placeholder="Yangi parol (kamida 8 belgi)" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Yangi parol" />
              <div className="row">
                <button type="button" className="btn btn--sm" disabled={password.length < 8 || reset.isPending} onClick={() => reset.mutate()}>Parolni saqlash</button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setResetting(false)}>Bekor</button>
              </div>
            </div>
          )}
          {can(Permission.EMPLOYEES_UPDATE) && (
            <button type="button" className="btn btn--block" onClick={onEdit}>
              <IconEdit size={16} /> Rollar va maʼlumotlarni tahrirlash
            </button>
          )}
          {can(Permission.EMPLOYEES_UPDATE) && !resetting && (
            <button type="button" className="btn btn--ghost btn--block" onClick={() => setResetting(true)}>
              <IconKey size={16} /> Parolni tiklash
            </button>
          )}
          {can(Permission.EMPLOYEES_DELETE) && !isMe && (
            <button type="button" className={`btn btn--block ${employee.isActive ? 'btn--danger-soft' : 'btn--soft'}`} disabled={block.isPending} onClick={() => block.mutate()}>
              {employee.isActive ? <><IconBan size={16} /> Xodimni bloklash</> : <><IconCheck size={16} /> Qayta faollashtirish</>}
            </button>
          )}
        </>
      }
    >
      <div className="row" style={{ flexWrap: 'nowrap', gap: 12 }}>
        {user?.avatarUrl ? <img className="avatar avatar--lg" src={user.avatarUrl} alt="" /> : <span className="avatar avatar--lg">{initialsOf(user?.fullName)}</span>}
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>{user?.fullName}</h3>
          <div className="cell-sub">
            {employee.position ?? 'Lavozim koʻrsatilmagan'} ·{' '}
            {user?.branchIds.length ? user.branchIds.map((id) => branches.find((b) => b.id === id)?.name ?? '—').join(', ') : 'Barcha filiallar'}
          </div>
          <div className="row cell-sub" style={{ gap: 6, marginTop: 2 }}>
            <IconPhone size={13} /> {phone(user?.phone)}
            {employee.employeeCode && <> · <IconBadge size={13} /> {employee.employeeCode}</>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        <div className="soft-box stat-mini">
          <span className="stat-mini__label">Oxirgi kirish</span>
          <span className="stat-mini__value" style={{ fontSize: 13 }}>{user?.lastLoginAt ? dayTimeOf(user.lastLoginAt) : 'Hali kirmagan'}</span>
        </div>
        <div className="soft-box stat-mini">
          <span className="stat-mini__label">Ishga olingan</span>
          <span className="stat-mini__value" style={{ fontSize: 13 }}>{employee.hiredAt ? dateOf(employee.hiredAt) : dateOf(employee.createdAt)}</span>
        </div>
      </div>

      <section className="detail-section">
        <div className="detail-section__title">Rollar</div>
        <div className="row" style={{ gap: 6 }}>
          {user?.roles.map((r) => <span key={r.id} className={`pill pill--lg ${r.isSystem ? 'tone-info' : 'tone-primary'}`}>{roleOf(r.code, r.name, r.isSystem)}</span>)}
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__title">
          <span>Huquqlar (rollardan)</span>
          <span>{granted.size} ta</span>
        </div>
        {rolePermissions.size === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Rollarni koʻrish huquqi kerak</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {TENANT_GROUPS.map(([group, codes]) => {
              const on = codes.filter((c) => granted.has(c));
              if (on.length === 0) return null;
              return (
                <div key={group} className="soft-box" style={{ padding: '8px 12px' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 12.5 }}>{GROUP_LABELS[group] ?? group}</strong>
                    <span className="cell-sub">{on.length}/{codes.length}</span>
                  </div>
                  <div className="cell-sub" style={{ marginTop: 4 }}>{on.map(permissionLabel).join(' · ')}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </SidePanel>
  );
}

function exportStaff(rows: Employee[], branches: Array<{ id: string; name: string }>) {
  downloadCsv(`xodimlar_${new Date().toISOString().slice(0, 10)}`, [
    ['Ism-familiya', 'Telefon', 'Email', 'Lavozim', 'Rollar', 'Filiallar', 'Xodim ID', 'Holat', 'Oxirgi kirish'],
    ...rows.map((e) => [
      e.user?.fullName ?? '',
      e.user?.phone ?? '',
      e.user?.email ?? '',
      e.position ?? '',
      e.user?.roles.map((r) => roleOf(r.code, r.name, r.isSystem)).join(', ') ?? '',
      e.user?.branchIds.length ? e.user.branchIds.map((id) => branches.find((b) => b.id === id)?.name ?? id).join(', ') : 'Barchasi',
      e.employeeCode ?? '',
      e.isActive ? 'Faol' : 'Bloklangan',
      e.user?.lastLoginAt ? dayTimeOf(e.user.lastLoginAt) : '',
    ]),
  ]);
}
