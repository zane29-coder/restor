import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchSummary, Employee } from '@restor/shared-types';
import { IconSave } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { ROLE_LABELS } from '../../lib/labels';
import { Drawer } from '../Drawer';

/**
 * Create a staff account or change one (TZ §46).
 *
 * Branch scope is part of the role grant: no branch ticked means every
 * branch, which is how owners and company admins are stored. The password
 * is set here only on creation — a later change goes through "Parolni
 * tiklash", so the audit log records it as what it is.
 */
export function EmployeeForm({
  employee,
  branches,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  branches: BranchSummary[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.roles.list() });
  const user = employee?.user;
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '+998');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [position, setPosition] = useState(employee?.position ?? '');
  const [code, setCode] = useState(employee?.employeeCode ?? '');
  const [roleIds, setRoleIds] = useState<string[]>(user?.roles.map((r) => r.id) ?? []);
  const [branchIds, setBranchIds] = useState<string[]>(user?.branchIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const problem =
    fullName.trim().length < 2
      ? 'Ism-familiyani kiriting'
      : phone.replace(/\D/g, '').length < 9
        ? 'Telefon raqamini toʻliq kiriting'
        : !employee && password.length < 8
          ? 'Parol kamida 8 belgidan iborat boʻlsin'
          : roleIds.length === 0
            ? 'Kamida bitta rol tanlang'
            : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        position: position.trim() || undefined,
        employeeCode: code.trim() || undefined,
        roleIds,
        branchIds,
      };
      return employee ? api.employees.update(employee.id, body) : api.employees.create({ ...body, password });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      onSaved(employee ? `${fullName.trim()}: saqlandi` : `${fullName.trim()} qoʻshildi`);
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problem) return setError(problem);
    setError(null);
    save.mutate();
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Drawer
      title={employee ? `${user?.fullName ?? 'Xodim'} — tahrirlash` : 'Yangi xodim'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="employee-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} className="stack" style={{ gap: 0 }}>
        <div className="field">
          <label htmlFor="e-name">Ism-familiya</label>
          <input id="e-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="e-phone">Telefon (login)</label>
            <input id="e-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="e-email">Email</label>
            <input id="e-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ixtiyoriy" />
          </div>
          <div className="field">
            <label htmlFor="e-position">Lavozim</label>
            <input id="e-position" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Bosh kassir" />
          </div>
          <div className="field">
            <label htmlFor="e-code">Xodim ID</label>
            <input id="e-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="EMP-104" />
          </div>
        </div>
        {!employee && (
          <div className="field">
            <label htmlFor="e-pass">Boshlangʻich parol</label>
            <input id="e-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="field__hint">Kamida 8 belgi. Xodim birinchi kirishdan keyin oʻzgartirishi mumkin.</span>
          </div>
        )}

        <div className="field">
          <span className="field__label">Rollar</span>
          <div className="stack" style={{ gap: 6 }}>
            {roles.data?.map((role) => (
              <label key={role.id} className="soft-box row" style={{ gap: 10, padding: '8px 12px', flexWrap: 'nowrap', cursor: 'pointer' }}>
                <input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => setRoleIds(toggle(roleIds, role.id))} />
                <span style={{ flex: 1 }}>
                  <span className="cell-main">{role.isSystem ? (ROLE_LABELS[role.code] ?? role.name) : role.name}</span>
                  <span className="cell-sub" style={{ display: 'block' }}>{role.permissions.length} ta ruxsat{role.isSystem ? ' · tizim roli' : ''}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Filiallar</span>
          <span className="field__hint">Hech biri tanlanmasa — barcha filiallar</span>
          <div className="row" style={{ gap: 14 }}>
            {branches.map((b) => (
              <label key={b.id} className="row" style={{ gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={branchIds.includes(b.id)} onChange={() => setBranchIds(toggle(branchIds, b.id))} />
                {b.name}
              </label>
            ))}
          </div>
        </div>
      </form>
    </Drawer>
  );
}
