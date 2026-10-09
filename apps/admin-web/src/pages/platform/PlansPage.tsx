import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@restor/shared-utils';
import { IconPlus } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { Drawer } from '../../components/Drawer';
import { Empty, ErrorState, Loading, Notice } from '../../components/States';

/** Tariffs a restaurant can be put on (TZ §6). */
export function PlansPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => api.platform.listPlans(),
  });

  if (plans.isLoading) return <Loading />;
  if (plans.isError) {
    return <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />;
  }

  const items = plans.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      <div className="row">
        <span className="muted">{items.length} ta tarif</span>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => setIsCreating(true)}>
          <IconPlus size={16} />
          Yangi tarif
        </button>
      </div>

      {items.length === 0 ? (
        <Empty title="Tarif yoʻq" description="Korxonaga obuna berish uchun avval tarif yarating." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kod</th>
                <th>Nomi</th>
                <th>Narxi</th>
                <th>Muddati</th>
                <th>Limitlar</th>
                <th>Holati</th>
              </tr>
            </thead>
            <tbody>
              {items.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <strong>{plan.code}</strong>
                  </td>
                  <td>
                    {plan.name}
                    {plan.description && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {plan.description}
                      </div>
                    )}
                  </td>
                  <td>{formatMoney(plan.price)}</td>
                  <td>{plan.periodDays} kun</td>
                  <td className="muted" style={{ fontSize: 13, whiteSpace: 'normal' }}>
                    {describeLimits(plan.limits)}
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={
                        plan.isActive
                          ? { background: '#DCFCE7', color: '#166534' }
                          : { background: 'var(--surface-alt)', color: 'var(--text-muted)' }
                      }
                    >
                      {plan.isActive ? 'Faol' : 'Oʻchirilgan'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isCreating && (
        <PlanForm
          onClose={() => setIsCreating(false)}
          onCreated={(name) => {
            setIsCreating(false);
            setNotice({ ok: true, text: `"${name}" tarifi yaratildi` });
          }}
        />
      )}
    </div>
  );
}

/** "3 filial · 10 xodim · cheksiz bot" — `null` means unlimited. */
function describeLimits(limits: {
  maxBranches: number | null;
  maxEmployees: number | null;
  maxPosTerminals: number | null;
  maxBots: number | null;
}): string {
  return [
    `${limits.maxBranches ?? 'cheksiz'} filial`,
    `${limits.maxEmployees ?? 'cheksiz'} xodim`,
    `${limits.maxPosTerminals ?? 'cheksiz'} kassa`,
    `${limits.maxBots ?? 'cheksiz'} bot`,
  ].join(' · ');
}

function PlanForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [periodDays, setPeriodDays] = useState('30');
  const [maxBranches, setMaxBranches] = useState('');
  const [maxEmployees, setMaxEmployees] = useState('');
  const [maxPosTerminals, setMaxPosTerminals] = useState('');
  const [maxBots, setMaxBots] = useState('');
  const [maxStorageMb, setMaxStorageMb] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.platform.createPlan({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        price: digits(price),
        periodDays: digits(periodDays) || 30,
        limits: {
          maxBranches: limit(maxBranches),
          maxEmployees: limit(maxEmployees),
          maxPosTerminals: limit(maxPosTerminals),
          maxBots: limit(maxBots),
          maxStorageMb: limit(maxStorageMb),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
      onCreated(name.trim());
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Drawer title="Yangi tarif" onClose={onClose}>
      <form onSubmit={submit}>
        {create.isError && (
          <div className="alert alert--error">
            {create.error instanceof RestorApiError ? create.error.message : 'Saqlanmadi'}
          </div>
        )}

        <div className="form-grid">
          <Field label="Kod" hint="Oʻzgarmaydi, masalan BASIC." value={code} onChange={setCode} placeholder="BASIC" required />
          <Field label="Nomi" hint="Mijoz koʻradigan nom." value={name} onChange={setName} placeholder="Boshlangʻich" required />
          <Field label="Narxi (UZS)" hint="Bir davr uchun." value={price} onChange={setPrice} placeholder="300000" />
          <Field label="Davr (kun)" hint="30 — oylik, 365 — yillik." value={periodDays} onChange={setPeriodDays} placeholder="30" />
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="plan-desc">Izoh</label>
          <input
            id="plan-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Kichik kafelar uchun"
          />
        </div>

        <h3 className="section-title" style={{ marginTop: 20 }}>
          Limitlar
        </h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
          Boʻsh qoldirilgan maydon — cheksiz.
        </p>

        <div className="form-grid">
          <Field label="Filiallar" hint="" value={maxBranches} onChange={setMaxBranches} placeholder="cheksiz" />
          <Field label="Xodimlar" hint="" value={maxEmployees} onChange={setMaxEmployees} placeholder="cheksiz" />
          <Field label="Kassalar" hint="" value={maxPosTerminals} onChange={setMaxPosTerminals} placeholder="cheksiz" />
          <Field label="Telegram botlar" hint="" value={maxBots} onChange={setMaxBots} placeholder="cheksiz" />
          <Field label="Xotira (MB)" hint="" value={maxStorageMb} onChange={setMaxStorageMb} placeholder="cheksiz" />
        </div>

        <button
          type="submit"
          className="btn"
          style={{ marginTop: 20 }}
          disabled={create.isPending || !code.trim() || !name.trim()}
        >
          {create.isPending ? 'Saqlanmoqda…' : 'Yaratish'}
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
  required,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <span className="muted" style={{ fontSize: 12 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function digits(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}

/** Blank means "no limit"; the server stores null. */
function limit(value: string): number | null {
  const parsed = digits(value);
  return parsed > 0 ? parsed : null;
}
