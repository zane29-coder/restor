import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TableShape, type BranchSummary, type RestaurantTable } from '@restor/shared-types';
import { IconSave, IconTrash } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { SHAPE_LABELS } from '../../lib/tables';
import { Drawer } from '../Drawer';
import { Seg, Switch } from '../ui';

/**
 * Creates or edits a table.
 *
 * Numbers are free text — real floors have "12a" and "VIP-2". Moving a table
 * to another zone puts it on that zone's plan unplaced; the server clears its
 * old coordinates because they mean nothing on another floor.
 */
export function TableForm({
  table,
  branches,
  branchId,
  zones,
  onClose,
  onSaved,
}: {
  table: RestaurantTable | null;
  branches: BranchSummary[];
  branchId: string;
  /** Existing zone names, offered as suggestions so "Terrassa" stays one zone. */
  zones: string[];
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState(table?.branchId ?? branchId);
  const [number, setNumber] = useState(table?.number ?? '');
  const [name, setName] = useState(table?.name ?? '');
  const [seats, setSeats] = useState(table?.seats ? String(table.seats) : '4');
  const [zone, setZone] = useState(table?.zone ?? '');
  const [shape, setShape] = useState<TableShape>(table?.shape ?? TableShape.SQUARE);
  const [isActive, setIsActive] = useState(table?.isActive ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
  };
  const fail = (e: unknown, fallback: string) => setError(e instanceof RestorApiError ? e.message : fallback);

  const save = useMutation({
    mutationFn: () => {
      const seatCount = Number(seats.replace(/\D/g, ''));
      const body = {
        number: number.trim(),
        name: name.trim() || null,
        seats: seatCount > 0 ? seatCount : null,
        zone: zone.trim() || null,
        shape,
      };
      return table ? api.tables.update(table.id, { ...body, isActive }) : api.tables.create({ ...body, branchId: branch });
    },
    onSuccess: () => {
      refresh();
      onSaved(table ? `${number.trim()}-stol saqlandi` : `${number.trim()}-stol qoʻshildi`);
    },
    onError: (e) => fail(e, 'Saqlanmadi'),
  });

  const remove = useMutation({
    mutationFn: () => api.tables.remove(table!.id),
    onSuccess: () => {
      refresh();
      onSaved(`${table!.number}-stol oʻchirildi`);
    },
    onError: (e) => {
      setConfirmDelete(false);
      fail(e, 'Oʻchirilmadi');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!number.trim()) return setError('Stol raqamini kiriting');
    if (!branch) return setError('Filialni tanlang');
    setError(null);
    save.mutate();
  }

  return (
    <Drawer
      title={table ? `${table.number}-stol — tahrirlash` : 'Yangi stol'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          {table && !confirmDelete && (
            <button type="button" className="btn btn--danger-soft" onClick={() => setConfirmDelete(true)}>
              <IconTrash size={15} /> Oʻchirish
            </button>
          )}
          {table && confirmDelete && (
            <button type="button" className="btn btn--danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Ha, oʻchirilsin
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="table-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form id="table-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        {!table && branches.length > 1 && (
          <div className="field">
            <label htmlFor="tf-branch">Filial</label>
            <select id="tf-branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="tf-number">Raqami</label>
            <input id="tf-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="12, 12a, VIP-2" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="tf-seats">Oʻrinlar soni</label>
            <input id="tf-seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tf-zone">Zona / zal</label>
            <input id="tf-zone" list="tf-zones" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Asosiy zal" />
            <datalist id="tf-zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="tf-name">Izoh</label>
            <input id="tf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deraza yoni" />
          </div>
        </div>
        <div className="field">
          <span className="field__label">Sxemadagi shakli</span>
          <Seg
            label="Shakli"
            options={Object.values(TableShape).map((value) => ({ value, label: SHAPE_LABELS[value] }))}
            value={shape}
            onChange={setShape}
          />
        </div>
        {table && (
          <Switch
            checked={isActive}
            onChange={setIsActive}
            label={isActive ? 'Faol — QR kod ishlaydi' : 'Oʻchiq — QR kod mehmonni qabul qilmaydi'}
          />
        )}
      </form>
    </Drawer>
  );
}
