import { IconChevronRight, IconPhone, IconTelegram } from '@restor/ui';
import { ScreenHeader } from '../components/ui';
import { useSession } from '../state/session';
import { openTelegram } from '../telegram';

/** "Yordam xizmati": how to reach this restaurant. */
export function HelpScreen() {
  const session = useSession();
  const { restaurant } = session.info;

  const phones = [
    ...(restaurant.phone ? [{ label: restaurant.name, phone: restaurant.phone }] : []),
    ...session.branches
      .filter((branch) => branch.phone && branch.phone !== restaurant.phone)
      .map((branch) => ({ label: branch.name, phone: branch.phone! })),
  ];

  return (
    <div className="screen screen--tinted">
      <ScreenHeader title="Yordam xizmati" />

      <section className="card-block">
        <p className="lead">
          Buyurtma boʻyicha savolingiz boʻlsa, restoran bilan bogʻlaning. Buyurtma raqamini aytsangiz,
          tezroq yordam berishadi.
        </p>
      </section>

      <nav className="menu-list" aria-label="Aloqa">
        {phones.map((entry) => (
          <a key={`${entry.label}-${entry.phone}`} className="menu-list__item" href={`tel:${entry.phone}`}>
            <IconPhone size={22} />
            <span className="menu-list__label">
              {entry.label}
              <span className="menu-list__sub">{entry.phone}</span>
            </span>
            <IconChevronRight size={18} />
          </a>
        ))}
        {restaurant.botUsername && (
          <button
            type="button"
            className="menu-list__item"
            onClick={() => openTelegram(`https://t.me/${restaurant.botUsername}`)}
          >
            <IconTelegram size={22} />
            <span className="menu-list__label">
              Telegram bot
              <span className="menu-list__sub">@{restaurant.botUsername}</span>
            </span>
            <IconChevronRight size={18} />
          </button>
        )}
        {phones.length === 0 && !restaurant.botUsername && (
          <p className="hint hint--padded">Restoran hali aloqa maʼlumotlarini kiritmagan.</p>
        )}
      </nav>
    </div>
  );
}

/** "Xizmat haqida": who runs what. */
export function AboutScreen() {
  const session = useSession();
  return (
    <div className="screen screen--tinted">
      <ScreenHeader title="Xizmat haqida" />
      <section className="card-block">
        <h2 className="block-title">{session.info.restaurant.name}</h2>
        <p className="lead">
          Buyurtmangizni {session.info.restaurant.name} tayyorlaydi va yetkazadi. Narxlar, aksiyalar va
          yetkazib berish shartlarini restoran belgilaydi.
        </p>
      </section>
      <section className="card-block">
        <h2 className="block-title">RESTOR</h2>
        <p className="lead">
          Ushbu ilova RESTOR platformasida ishlaydi. Profilingiz, manzillaringiz va tanlanganlaringiz
          RESTOR orqali ishlaydigan barcha restoranlarda bir xil — ularni bir marta kiritasiz.
        </p>
        <p className="lead">
          Restoranlar sizning maʼlumotlaringizni faqat oʻziga berilgan buyurtmani bajarish uchun koʻradi.
          Karta maʼlumotlari restoranda ham, RESTORda ham saqlanmaydi — toʻlov provayderida qoladi.
        </p>
        <p className="hint">Versiya {__APP_VERSION__}</p>
      </section>
    </div>
  );
}
