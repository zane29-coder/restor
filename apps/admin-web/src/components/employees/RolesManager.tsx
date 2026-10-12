import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, type Role } from '@restor/shared-types';
import { IconCheck, IconCopy, IconPlus, IconSave, IconShield, IconTrash } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/labels';
import { GROUP_LABELS, TENANT_GROUPS, permissionLabel } from '../../lib/permissions';
import { ErrorState, Loading } from '../States';

/**
 * Roles and their permissions, as a matrix.
 *
 * System roles are shown for reference and cannot be edited — they are
 * reconciled across every restaurant by the sync script. "Nusxa olish"
 * starts a custom role from one, which is how an owner gets "Cashier, but
 * may also give discounts".
 */
export function RolesManager() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.roles.list() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string | null; name: string; description: string; permissions: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = roles.data ?? [];
  const selected = all.find((r) => r.id === selectedId) ?? all[0];
  const editing = draft !== null;
  const shown = editing ? draft.permissions : new Set<string>(selected?.permissions ?? []);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['roles'] });
  const fail = (e: unknown) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi');

  const save = useMutation({
    mutationFn: () => {
      const body = { name: draft!.name.trim(), description: draft!.description.trim() || undefined, permissions: [...draft!.permissions] as Permission[] };
      return draft!.id ? api.roles.update(draft!.id, body) : api.roles.create(body);
    },
    onSuccess: (role) => {
      setError(null);
      setDraft(null);
      setSelectedId(role.id);
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.roles.remove(id),
    onSuccess: () => {
      setSelectedId(null);
      refresh();
    },
    onError: fail,
  });

  const toggle = (code: string) =>
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...d, permissions: next };
    });

  const counts = useMemo(() => new Map(all.map((r) => [r.id, r.permissions.length])), [all]);

  if (roles.isLoading) return <Loading />;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />;

  const roleName = (r: Role) => (r.isSystem ? (ROLE_LABELS[r.code] ?? r.name) : r.name);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 16 }}>
      <div className="stack" style={{ gap: 4, alignContent: 'start' }}>
        {all.map((role) => (
          <button
            key={role.id}
            type="button"
            className={`menu-item${!editing && selected?.id === role.id ? ' menu-item--active menu-item--selected' : ''}`}
            onClick={() => {
              setDraft(null);
              setSelectedId(role.id);
            }}
          >
            <span className="menu-item__icon"><IconShield size={15} /></span>
            <span className="menu-item__body">
              <span className="menu-item__title">{roleName(role)}</span>
              <span className="menu-item__sub">
                {role.isSystem ? 'Tizim roli' : 'Maxsus rol'} · {counts.get(role.id)} ruxsat · {role.userCount ?? 0} xodim
              </span>
            </span>
          </button>
        ))}
        {can(Permission.ROLES_CREATE) && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 8 }}
            onClick={() => setDraft({ id: null, name: '', description: '', permissions: new Set() })}
          >
            <IconPlus size={14} /> Yangi rol
          </button>
        )}
      </div>

      <div className="stack" style={{ minWidth: 0 }}>
        {editing ? (
          <div className="form-grid">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="role-name">Rol nomi</label>
              <input id="role-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Katta kassir" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="role-desc">Tavsif</label>
              <input id="role-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
          </div>
        ) : (
          selected && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3 className="card__title">{roleName(selected)}</h3>
                <p className="card__sub">{selected.description ?? (selected.isSystem ? 'Tizim roli — oʻzgartirib boʻlmaydi, nusxa oling' : '')}</p>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {can(Permission.ROLES_CREATE) && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setDraft({ id: null, name: `${roleName(selected)} (nusxa)`, description: selected.description ?? '', permissions: new Set(selected.permissions) })
                    }
                  >
                    <IconCopy size={14} /> Nusxa olish
                  </button>
                )}
                {!selected.isSystem && can(Permission.ROLES_UPDATE) && (
                  <button
                    type="button"
                    className="btn btn--soft btn--sm"
                    onClick={() => setDraft({ id: selected.id, name: selected.name, description: selected.description ?? '', permissions: new Set(selected.permissions) })}
                  >
                    Tahrirlash
                  </button>
                )}
                {!selected.isSystem && can(Permission.ROLES_DELETE) && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm icon-btn--danger"
                    aria-label="Rolni oʻchirish"
                    disabled={remove.isPending || (selected.userCount ?? 0) > 0}
                    title={(selected.userCount ?? 0) > 0 ? 'Avval xodimlarni boshqa rolga oʻtkazing' : 'Oʻchirish'}
                    onClick={() => remove.mutate(selected.id)}
                  >
                    <IconTrash size={15} />
                  </button>
                )}
              </div>
            </div>
          )
        )}

        {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}

        <div className="stack" style={{ gap: 10 }}>
          {TENANT_GROUPS.map(([group, codes]) => {
            const granted = codes.filter((c) => shown.has(c)).length;
            return (
              <section key={group} className="soft-box">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{GROUP_LABELS[group] ?? group}</strong>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="cell-sub">{granted}/{codes.length}</span>
                    {editing && (
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        style={{ minHeight: 24, padding: '2px 8px' }}
                        onClick={() =>
                          setDraft((d) => {
                            if (!d) return d;
                            const next = new Set(d.permissions);
                            const allOn = codes.every((c) => next.has(c));
                            codes.forEach((c) => (allOn ? next.delete(c) : next.add(c)));
                            return { ...d, permissions: next };
                          })
                        }
                      >
                        {granted === codes.length ? 'Hammasini olish' : 'Hammasi'}
                      </button>
                    )}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                  {codes.map((code) => {
                    const on = shown.has(code);
                    return editing ? (
                      <label key={code} className="row" style={{ gap: 8, fontSize: 13, flexWrap: 'nowrap', cursor: 'pointer' }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(code)} />
                        <span>{permissionLabel(code)}</span>
                      </label>
                    ) : (
                      <span key={code} className="row" style={{ gap: 6, fontSize: 13, flexWrap: 'nowrap', color: on ? 'var(--text)' : 'var(--text-subtle)' }}>
                        <span className={`avatar avatar--sm ${on ? 'tone-success' : 'tone-neutral'}`} style={{ width: 18, height: 18 }}>
                          {on ? <IconCheck size={11} /> : '–'}
                        </span>
                        {permissionLabel(code)}
                      </span>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {editing && (
          <div className="row" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', padding: '10px 0' }}>
            <button type="button" className="btn" disabled={save.isPending || draft.name.trim().length < 2 || draft.permissions.size === 0} onClick={() => save.mutate()}>
              <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Rolni saqlash'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDraft(null)}>Bekor</button>
            <span className="cell-sub">{draft.permissions.size} ta ruxsat tanlandi</span>
          </div>
        )}
      </div>
    </div>
  );
}
