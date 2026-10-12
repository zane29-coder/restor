import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OnlinePaymentProvider, type StorefrontSettings } from '@restor/shared-types';
import { IconImage, IconSave, IconTrash, IconUpload } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { Loading } from '../States';
import { Card, Switch } from '../ui';

const PRESETS = ['#FF6B00', '#E53935', '#2E7D32', '#1E66F5', '#7B3FE4', '#1F2937'];

const PROVIDER_LABELS: Record<OnlinePaymentProvider, string> = {
  ATMOS: 'Bank kartasi (Atmos)',
  CLICK: 'Click',
  PAYME: 'Payme',
};

/** WCAG contrast of white text on a colour — buttons in the Mini App are white on the accent. */
function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (l + 0.05);
}

type Draft = Omit<StorefrontSettings, 'onlineAvailable' | 'brandColor'>;

/**
 * How the Mini App looks and what its checkout asks: accent colour, promo
 * banner, the map-pin rule, cutlery, "leave at the door" and payment options.
 *
 * The accent is the storefront's own; clearing it falls back to the tenant's
 * white-label colour, which stays with the platform's branding permission.
 */
export function MiniAppSettings({ canEdit, onNotice }: { canEdit: boolean; onNotice: (n: { ok: boolean; text: string }) => void }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['storefront', 'settings'], queryFn: () => api.storefront.settings() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!settings.data) return;
    const { onlineAvailable: _a, brandColor: _b, ...rest } = settings.data;
    setDraft(rest);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.storefront.updateSettings(draft!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storefront'] });
      onNotice({ ok: true, text: 'Mini App sozlamalari saqlandi — mijozlar keyingi ochishda koʻradi' });
    },
    onError: (e) => onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Saqlanmadi' }),
  });

  if (settings.isLoading || !draft) return <Card title="Mini App sozlamalari"><Loading /></Card>;
  if (!settings.data) return null;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const color = draft.accentColor ?? settings.data.brandColor;
  // Below 2.5:1 white button text genuinely struggles (yellows, pastels);
  // the RESTOR orange sits just under 3:1 and reads fine in bold.
  const lowContrast = contrastWithWhite(color) < 2.5;

  async function upload(file: File) {
    setUploading(true);
    try {
      const result = await api.catalog.uploadImage(file, file.name);
      set('bannerUrl', result.url);
    } catch (e) {
      onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Rasm yuklanmadi' });
    } finally {
      setUploading(false);
    }
  }

  const toggleProvider = (provider: OnlinePaymentProvider) =>
    set(
      'onlineProviders',
      draft.onlineProviders.includes(provider) ? draft.onlineProviders.filter((p) => p !== provider) : [...draft.onlineProviders, provider],
    );

  return (
    <Card title="Mijozlar Mini App sozlamalari" sub="Telegram Mini App va sayt koʻrinishi va buyurtma qoidalari">
      <fieldset disabled={!canEdit} className="stack" style={{ gap: 16, border: 0, padding: 0, margin: 0 }}>
        <div className="miniapp-preview" style={{ ['--accent' as string]: color }}>
          <div className="miniapp-preview__banner">
            {draft.bannerUrl && <img src={draft.bannerUrl} alt="" />}
            <div className="miniapp-preview__banner-text">
              <b>{draft.bannerTitle || 'Banner sarlavhasi'}</b>
              <span>{draft.bannerText || 'Qisqa taklif matni'}</span>
            </div>
          </div>
          <div className="miniapp-preview__row">
            <span>Tovuqli lavash</span>
            <span className="miniapp-preview__price">32 000 soʻm</span>
          </div>
          <span className="miniapp-preview__button">Savatga qoʻshish</span>
        </div>

        <div className="field">
          <span className="field__label">Brend rangi (tugmalar va urgʻu)</span>
          <div className="row" style={{ gap: 8 }}>
            {PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`swatch-btn${color.toUpperCase() === hex ? ' is-active' : ''}`}
                style={{ background: hex }}
                aria-label={hex}
                aria-pressed={color.toUpperCase() === hex}
                onClick={() => set('accentColor', hex)}
              />
            ))}
            <input
              type="color"
              aria-label="Boshqa rang"
              value={color}
              style={{ width: 44, height: 30, padding: 2, flex: 'none' }}
              onChange={(e) => set('accentColor', e.target.value.toUpperCase())}
            />
            {draft.accentColor && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => set('accentColor', null)}>
                Brend rangiga qaytarish
              </button>
            )}
          </div>
          <span className="field__hint">
            {draft.accentColor ? `Tanlangan: ${draft.accentColor}` : `Restoran brend rangi: ${settings.data.brandColor}`}
            {lowContrast && ' · Ehtiyot boʻling: bu rangda oq matn yaxshi oʻqilmaydi'}
          </span>
        </div>

        <div className="field">
          <span className="field__label">Menyu banneri</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn btn--sm btn--ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {draft.bannerUrl ? <IconImage size={14} /> : <IconUpload size={14} />} {uploading ? 'Yuklanmoqda…' : draft.bannerUrl ? 'Rasmni almashtirish' : 'Rasm yuklash'}
            </button>
            {(draft.bannerUrl || draft.bannerTitle || draft.bannerText) && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setDraft((d) => (d ? { ...d, bannerUrl: null, bannerTitle: null, bannerText: null } : d))}
              >
                <IconTrash size={14} /> Bannerni olib tashlash
              </button>
            )}
          </div>
          <input aria-label="Banner sarlavhasi" value={draft.bannerTitle ?? ''} maxLength={80} placeholder="Masalan: Har dushanba −20%" onChange={(e) => set('bannerTitle', e.target.value || null)} />
          <input aria-label="Banner matni" value={draft.bannerText ?? ''} maxLength={160} placeholder="Qisqa izoh (ixtiyoriy)" onChange={(e) => set('bannerText', e.target.value || null)} />
          <span className="field__hint">Tavsiya: 1200×500 px. Banner boʻsh boʻlsa menyuda koʻrsatilmaydi.</span>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <Switch checked={draft.requireMapPin} onChange={(v) => set('requireMapPin', v)} label="Manzilni xaritada belgilash majburiy" />
          <Switch checked={draft.cutleryEnabled} onChange={(v) => set('cutleryEnabled', v)} label="Vilka-qoshiq sonini soʻrash" />
          <Switch checked={draft.leaveAtDoorEnabled} onChange={(v) => set('leaveAtDoorEnabled', v)} label="“Eshik oldida qoldirish” imkoniyati" />
        </div>

        <div className="field">
          <span className="field__label">Toʻlov usullari</span>
          <div className="stack" style={{ gap: 8 }}>
            <Switch checked={draft.cashEnabled} onChange={(v) => set('cashEnabled', v)} label="Naqd (kuryerga yoki kassaga)" />
            {Object.values(OnlinePaymentProvider).map((p) => (
              <Switch key={p} checked={draft.onlineProviders.includes(p)} onChange={() => toggleProvider(p)} label={PROVIDER_LABELS[p]} />
            ))}
          </div>
          {!settings.data.onlineAvailable && draft.onlineProviders.length > 0 && (
            <span className="field__hint" style={{ color: 'var(--warning)' }}>
              Onlayn toʻlov kaliti hali ulanmagan — tanlangan usullar mijozlarga koʻrsatilmaydi.
            </span>
          )}
        </div>

        {canEdit && (
          <button type="button" className="btn" style={{ justifyContent: 'center' }} disabled={save.isPending} onClick={() => save.mutate()}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Sozlamalarni saqlash'}
          </button>
        )}
      </fieldset>
    </Card>
  );
}
