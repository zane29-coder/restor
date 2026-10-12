import { useState } from 'react';
import type { Category } from '@restor/shared-types';
import { IconDownload, IconUpload } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { som } from '../../lib/format';
import { downloadCsv } from '../ui';
import { digits } from './CatalogManagers';

interface Row {
  name: string;
  category: string;
  price: number;
  preparationTime: number;
  description: string;
}

const TEMPLATE_HEADER = ['Nomi', 'Kategoriya', 'Narxi', 'Tayyorlash (daq)', 'Tavsif'];

/** Splits one CSV line, honouring quotes; accepts `;` (Excel UZ/RU) or `,`. */
function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

function parse(text: string): Row[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0]!.includes(';') ? ';' : ',';
  return lines.slice(1).map((line) => {
    const [name = '', category = '', price = '', prep = '', description = ''] = splitLine(line, sep);
    return { name, category, price: digits(price), preparationTime: digits(prep) || 10, description };
  });
}

/**
 * Bulk-adds dishes from a spreadsheet.
 *
 * Every row goes through the ordinary create endpoint, one at a time, so the
 * server validates and audits each dish exactly as if it were typed in —
 * there is no bulk path that could skip a rule. Categories are matched by
 * name and created when missing.
 */
export function ImportProducts({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; failed: string[] } | null>(null);
  const [running, setRunning] = useState(false);

  const invalid = (row: Row) => row.name.length < 2 || !row.category || row.price <= 0;

  async function run() {
    setRunning(true);
    const failed: string[] = [];
    const known = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    let done = 0;
    for (const row of rows) {
      if (invalid(row)) {
        failed.push(`${row.name || '(nomsiz)'}: maʼlumot toʻliq emas`);
        continue;
      }
      try {
        let categoryId = known.get(row.category.toLowerCase());
        if (!categoryId) {
          const created = await api.catalog.createCategory({ name: row.category });
          categoryId = created.id;
          known.set(row.category.toLowerCase(), categoryId);
        }
        await api.catalog.createProduct({
          categoryId,
          name: row.name,
          price: row.price,
          preparationTime: row.preparationTime,
          description: row.description || null,
        });
        done++;
      } catch (e) {
        failed.push(`${row.name}: ${e instanceof RestorApiError ? e.message : 'xato'}`);
      }
      setProgress({ done, failed: [...failed] });
    }
    setProgress({ done, failed });
    setRunning(false);
    onDone();
  }

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 13 }}>
        Excel yoki Google Sheets’dan CSV koʻrinishida saqlang. Ustunlar: Nomi; Kategoriya; Narxi; Tayyorlash (daq); Tavsif. Yoʻq kategoriya avtomatik yaratiladi.
      </p>
      <div className="row">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => downloadCsv('menyu_shablon', [TEMPLATE_HEADER, ['Chizburger', 'Burgerlar', '35000', '12', 'Mol goʻshti, cheddar']])}
        >
          <IconDownload size={14} /> Shablonni yuklab olish
        </button>
        <label className="btn btn--sm" style={{ cursor: 'pointer' }}>
          <IconUpload size={14} /> CSV faylni tanlash
          <input
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setRows(parse(await file.text()));
              setProgress(null);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {rows.length > 0 && (
        <>
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr><th>Nomi</th><th>Kategoriya</th><th className="td-right">Narxi</th><th>Daq</th></tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={invalid(row) ? { color: 'var(--danger-ink)' } : undefined}>
                    <td>{row.name || '—'}</td>
                    <td>{row.category || '—'}</td>
                    <td className="td-right num">{row.price ? som(row.price) : '—'}</td>
                    <td>{row.preparationTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn" disabled={running} onClick={() => void run()}>
            {running ? `Qoʻshilmoqda… ${progress?.done ?? 0}/${rows.length}` : `${rows.length} ta taomni qoʻshish`}
          </button>
        </>
      )}

      {progress && !running && (
        <div className={`alert ${progress.failed.length ? 'alert--error' : 'alert--info'}`} style={{ margin: 0 }}>
          {progress.done} ta taom qoʻshildi.
          {progress.failed.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {progress.failed.slice(0, 8).map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
