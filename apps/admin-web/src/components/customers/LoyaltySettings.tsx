import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconSave } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { som } from '../../lib/format';
import { digits } from '../menu/CatalogManagers';
import { Switch } from '../ui';
import { Loading } from '../States';

/**
 * Cashback settings.
 *
 * The worked example under the fields is the point of this block: "5%" and
 * "one point = 1 soʻm" are two abstract numbers until you see that a 100 000
 * order returns 5 000 soʻm of value. Restaurants have given away far more
 * than they intended by not doing that multiplication.
 */
export function LoyaltySettings({ canManage, onSaved }: { canManage: boolean; onSaved: (text: string) => void }) {
  const queryClient = useQueryClient();
  const program = useQuery({ queryKey: ['loyalty', 'program'], queryFn: () => api.customers.loyaltyProgram() });
  const [cashback, setCashback] = useState('');
  const [pointValue, setPointValue] = useState('');
  const [maxRedeem, setMaxRedeem] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: Parameters<typeof api.customers.updateLoyaltyProgram>[0]) => api.customers.updateLoyaltyProgram(payload),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      onSaved('Sodiqlik dasturi saqlandi');
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  if (!program.data) return <Loading />;
  const current = program.data;
  const cashbackValue = cashback === '' ? current.cashbackPercent : digits(cashback);
  const pointValueNum = pointValue === '' ? current.pointValue : digits(pointValue);
  const maxRedeemValue = maxRedeem === '' ? current.maxRedeemPercent : digits(maxRedeem);
  const expiryValue = expiry === '' ? current.expiryDays : digits(expiry) || null;
  const points = Math.floor((100_000 * cashbackValue) / 100);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Switch
        checked={current.isActive}
        disabled={!canManage || save.isPending}
        onChange={(isActive) => save.mutate({ isActive })}
        label={current.isActive ? 'Dastur yoqilgan — har yakunlangan buyurtmaga ball yoziladi' : 'Dastur oʻchirilgan'}
      />
      <div className="form-grid">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="l-cb">Keshbek (%)</label>
          <input id="l-cb" inputMode="numeric" value={cashback} placeholder={String(current.cashbackPercent)} disabled={!canManage} onChange={(e) => setCashback(e.target.value)} />
          <span className="field__hint">Buyurtmaning necha foizi ball boʻlib qaytadi</span>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="l-pv">1 ball qiymati (soʻm)</label>
          <input id="l-pv" inputMode="numeric" value={pointValue} placeholder={String(current.pointValue)} disabled={!canManage} onChange={(e) => setPointValue(e.target.value)} />
          <span className="field__hint">Ball sarflanganda qancha chegirma beradi</span>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="l-mr">Maksimal toʻlov (%)</label>
          <input id="l-mr" inputMode="numeric" value={maxRedeem} placeholder={String(current.maxRedeemPercent)} disabled={!canManage} onChange={(e) => setMaxRedeem(e.target.value)} />
          <span className="field__hint">Hisobning necha foizini ball qoplaydi</span>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="l-exp">Ball muddati (kun)</label>
          <input id="l-exp" inputMode="numeric" value={expiry} placeholder={current.expiryDays ? String(current.expiryDays) : 'muddatsiz'} disabled={!canManage} onChange={(e) => setExpiry(e.target.value)} />
          <span className="field__hint">Boʻsh yoki 0 — ball hech qachon kuymaydi</span>
        </div>
      </div>

      <div className="soft-box" style={{ fontSize: 13 }}>
        <strong>{som(100_000)}</strong>lik buyurtma <strong>{points}</strong> ball beradi — bu <strong>{som(points * pointValueNum)}</strong> qiymatida.
        {maxRedeemValue < 100 && <> Keyingi hisobning eng koʻpi {maxRedeemValue}%i ball bilan toʻlanadi.</>}
        {expiryValue ? <> Ball {expiryValue} kundan keyin kuyadi.</> : null}
      </div>

      {current.levels.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="section-title" style={{ margin: 0 }}>Darajalar</div>
          {current.levels.map((level) => (
            <div key={level.id} className="soft-box row" style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
              <strong>{level.name}</strong>
              <span className="cell-sub">{som(level.thresholdSpent)} dan · {level.cashbackPercent}% keshbek</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
      {canManage && (
        <button
          type="button"
          className="btn"
          style={{ justifySelf: 'start' }}
          disabled={save.isPending}
          onClick={() =>
            save.mutate({ cashbackPercent: cashbackValue, pointValue: pointValueNum, maxRedeemPercent: maxRedeemValue, expiryDays: expiryValue })
          }
        >
          <IconSave size={16} /> Saqlash
        </button>
      )}
    </div>
  );
}
