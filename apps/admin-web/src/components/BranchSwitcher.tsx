import { useCallback, useRef, useState } from 'react';
import { IconBranch, IconCheck, IconChevronDown } from '@restor/ui';
import { todaysHours, useBranch } from '../lib/branch';
import { useDismiss } from '../lib/useDismiss';

/** The top bar's branch picker; see `BranchProvider` for what it scopes. */
export function BranchSwitcher() {
  const { branches, branchId, setBranchId, current } = useBranch();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  if (branches.length === 0) return null;

  const single = branches.length === 1;

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className="top-select"
        onClick={() => !single && setOpen((v) => !v)}
        aria-haspopup={single ? undefined : 'listbox'}
        aria-expanded={single ? undefined : open}
        style={single ? { cursor: 'default' } : undefined}
      >
        <IconBranch size={17} style={{ color: 'var(--primary)' }} />
        <span className="top-select__label">
          {current ? current.name : `Barcha filiallar (${branches.length})`}
        </span>
        {current && <OpenPill open={current.isOpenNow} />}
        {!single && <IconChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
      </button>

      {open && (
        <div className="popover" role="listbox" aria-label="Filial">
          <div className="popover__title">Filialni tanlang</div>
          <BranchOption
            selected={branchId === ''}
            title="Barcha filiallar"
            sub={`${branches.length} ta filial`}
            onSelect={() => {
              setBranchId('');
              close();
            }}
          />
          <div className="menu-sep" />
          {branches.map((branch) => (
            <BranchOption
              key={branch.id}
              selected={branch.id === branchId}
              title={branch.name}
              sub={todaysHours(branch) ?? 'Bugun yopiq'}
              open={branch.isOpenNow}
              onSelect={() => {
                setBranchId(branch.id);
                close();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BranchOption({
  selected,
  title,
  sub,
  open,
  onSelect,
}: {
  selected: boolean;
  title: string;
  sub: string;
  open?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`menu-item${selected ? ' menu-item--selected' : ''}`}
      onClick={onSelect}
    >
      <span className="menu-item__body">
        <span className="menu-item__title">{title}</span>
        <span className="menu-item__sub">{sub}</span>
      </span>
      {open !== undefined && <OpenPill open={open} />}
      {selected && <IconCheck size={16} />}
    </button>
  );
}

export function OpenPill({ open }: { open: boolean }) {
  return (
    <span className={`pill pill--square ${open ? 'tone-success' : 'tone-neutral'}`}>
      {open ? 'Ochiq' : 'Yopiq'}
    </span>
  );
}
