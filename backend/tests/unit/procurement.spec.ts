import { remainingByReceipt, daysUntil } from '../../src/modules/inventory/stock.math';
import { buildSupplierOrderMessage, formatQuantity } from '../../src/modules/inventory/procurement.service';

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9));

describe('remainingByReceipt (FIFO estimate)', () => {
  const receipts = [
    { id: 'old', quantity: 10, receivedAt: day(1) },
    { id: 'mid', quantity: 10, receivedAt: day(5) },
    { id: 'new', quantity: 10, receivedAt: day(9) },
  ];

  it('gives the current level to the newest receipts first', () => {
    const left = remainingByReceipt(15, receipts);
    expect(left.get('new')).toBe(10);
    expect(left.get('mid')).toBe(5);
    expect(left.get('old')).toBe(0);
  });

  it('does not care about input order', () => {
    const left = remainingByReceipt(15, [...receipts].reverse());
    expect(left.get('mid')).toBe(5);
  });

  it('leaves nothing when the shelf is empty or negative', () => {
    expect([...remainingByReceipt(0, receipts).values()].every((v) => v === 0)).toBe(true);
    expect([...remainingByReceipt(-3, receipts).values()].every((v) => v === 0)).toBe(true);
  });

  it('caps each batch at what was received, even with more on the shelf', () => {
    const left = remainingByReceipt(50, receipts);
    expect([...left.values()]).toEqual([10, 10, 10]);
  });

  it('keeps three decimals exact', () => {
    const left = remainingByReceipt(0.3, [
      { id: 'a', quantity: 0.1, receivedAt: day(1) },
      { id: 'b', quantity: 0.25, receivedAt: day(2) },
    ]);
    expect(left.get('b')).toBe(0.25);
    expect(left.get('a')).toBe(0.05);
  });
});

describe('daysUntil', () => {
  it('counts whole days and goes negative once passed', () => {
    const now = day(10);
    expect(daysUntil(new Date(now.getTime() + 2.5 * 86_400_000), now)).toBe(2);
    expect(daysUntil(new Date(now.getTime() + 3_600_000), now)).toBe(0);
    expect(daysUntil(new Date(now.getTime() - 3_600_000), now)).toBe(-1);
  });
});

describe('buildSupplierOrderMessage', () => {
  const base = {
    number: 7,
    restaurantName: 'Demo <Fast> Food',
    branchName: 'Chilonzor',
    branchAddress: 'Bunyodkor 1',
    branchPhone: '+998901112233',
    lines: [
      { name: 'Mol goʻshti', unit: 'KG', quantity: '50.000' },
      { name: 'Pishloq & sut', unit: 'G', quantity: '250.500' },
    ],
    note: null,
    expectedAt: null,
    timezone: 'Asia/Tashkent',
  };

  it('lists quantities a supplier can read, without prices', () => {
    const text = buildSupplierOrderMessage(base);
    expect(text).toContain('Buyurtma №7');
    expect(text).toContain('1. Mol goʻshti — <b>50 kg</b>');
    expect(text).toContain('250,5 g');
    expect(text).not.toMatch(/soʻm/);
  });

  it('escapes everything it interpolates', () => {
    const text = buildSupplierOrderMessage({ ...base, note: '<script>' });
    expect(text).toContain('Demo &lt;Fast&gt; Food');
    expect(text).toContain('Pishloq &amp; sut');
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });

  it('formats quantities the way people write them', () => {
    expect(formatQuantity('12.000', 'PCS')).toBe('12 dona');
    expect(formatQuantity('0.250', 'L')).toBe('0,25 l');
  });
});
