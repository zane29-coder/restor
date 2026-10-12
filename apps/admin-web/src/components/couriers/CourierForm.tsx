import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VehicleType, type BranchSummary, type Courier } from '@restor/shared-types';
import { IconSave } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { VEHICLE_LABELS } from '../../lib/labels';
import { Drawer } from '../Drawer';
import { Switch } from '../ui';

/**
 * Add a courier or change one. Creating also provisions their app login
 * (phone + password), exactly like an employee.
 */
export function CourierForm({
  courier,
  branches,
  onClose,
  onSaved,
}: {
  courier: Courier | null;
  branches: BranchSummary[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(courier?.fullName ?? '');
  const [phone, setPhone] = useState(courier?.phone ?? '+998');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState(courier?.branchId ?? branches[0]?.id ?? '');
  const [vehicle, setVehicle] = useState<VehicleType>(courier?.vehicleType ?? VehicleType.SCOOTER);
  const [isActive, setIsActive] = useState(courier?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const problem =
    fullName.trim().length < 2
      ? 'Ism-familiyani kiriting'
      : phone.replace(/\D/g, '').length < 9
        ? 'Telefon raqamini toʻliq kiriting'
        : !courier && password.length < 8
          ? 'Parol kamida 8 belgidan iborat boʻlsin'
          : null;

  const save = useMutation({
    mutationFn: () => {
      const body = { fullName: fullName.trim(), phone: phone.trim(), branchId: branchId || null, vehicleType: vehicle };
      return courier
        ? api.couriers.update(courier.id, { ...body, isActive, ...(password ? { password } : {}) })
        : api.couriers.create({ ...body, password });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['couriers'] });
      onSaved(courier ? `${fullName.trim()}: saqlandi` : `${fullName.trim()} kuryer sifatida qoʻshildi`);
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problem) return setError(problem);
    setError(null);
    save.mutate();
  }

  return (
    <Drawer
      title={courier ? `${courier.fullName} — tahrirlash` : 'Yangi kuryer'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="courier-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form id="courier-form" onSubmit={submit} className="stack" style={{ gap: 0 }}>
        <div className="field">
          <label htmlFor="c-name">Ism-familiya</label>
          <input id="c-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="c-phone">Telefon (ilovaga kirish)</label>
            <input id="c-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-pass">{courier ? 'Yangi parol' : 'Parol'}</label>
            <input id="c-pass" type="password" autoComplete="new-password" value={password} placeholder={courier ? 'oʻzgartirmaslik uchun boʻsh' : ''} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-branch">Filial</label>
            <select id="c-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Barcha filiallar</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-vehicle">Transport</label>
            <select id="c-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleType)}>
              {Object.values(VehicleType).map((v) => <option key={v} value={v}>{VEHICLE_LABELS[v] ?? v}</option>)}
            </select>
          </div>
        </div>
        {courier && <Switch checked={isActive} onChange={setIsActive} label="Faol (ilovaga kira oladi)" />}
      </form>
    </Drawer>
  );
}
