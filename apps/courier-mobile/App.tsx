import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import {
  CourierStatus,
  type CashHandover,
  type CourierJob,
  type CourierProfile,
  type CourierTransaction,
  type CourierWallet,
} from '@restor/shared-types';
import { RestorApiError } from '@restor/api-client';
import { api } from './src/api';
import { colors, money, styles } from './src/theme';
import { LoginScreen } from './src/screens/LoginScreen';
import { JobsScreen, type JobAction } from './src/screens/JobsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';

type Tab = 'jobs' | 'wallet' | 'profile';

const TABS: { key: Tab; label: string }[] = [
  { key: 'jobs', label: 'BUYURTMA' },
  { key: 'wallet', label: 'KASSA' },
  { key: 'profile', label: 'PROFIL' },
];

/**
 * Courier app (TZ §23-§26).
 *
 * Every endpoint it calls is scoped to the signed-in courier server-side — the
 * app never sends its own courier id, so it cannot read another courier's
 * jobs, wallet or cash even if the screen were tampered with.
 */
export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>('jobs');

  const [profile, setProfile] = useState<CourierProfile | null>(null);
  const [jobs, setJobs] = useState<CourierJob[]>([]);
  const [wallet, setWallet] = useState<CourierWallet | null>(null);
  const [transactions, setTransactions] = useState<CourierTransaction[]>([]);
  const [handovers, setHandovers] = useState<CashHandover[]>([]);

  const [status, setStatus] = useState<CourierStatus>(CourierStatus.OFFLINE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        if (await api.http.isAuthenticated()) {
          await api.auth.me();
          setIsAuthed(true);
        }
      } catch {
        await api.http.clearTokens();
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  /**
   * One round trip per screen, fetched together.
   *
   * The wallet calls are allowed to fail on their own: a courier whose role is
   * missing the wallet permission should still see their jobs rather than an
   * error page.
   */
  const load = useCallback(async () => {
    try {
      const [loadedProfile, loadedJobs, loadedWallet, loadedTx, loadedHandovers] =
        await Promise.all([
          api.courierApp.myProfile(),
          api.courierApp.myJobs(),
          api.courierApp.myWallet().catch(() => null),
          api.courierApp
            .myTransactions({ limit: 50 })
            .then((page) => page.items)
            .catch(() => []),
          api.courierApp
            .myHandovers()
            .then((page) => page.items)
            .catch(() => []),
        ]);

      setProfile(loadedProfile);
      setJobs(loadedJobs);
      setWallet(loadedWallet);
      setTransactions(loadedTx);
      setHandovers(loadedHandovers);
      setError(null);
    } catch (caught) {
      setError(caught instanceof RestorApiError ? caught.message : 'Maʼlumot yuklanmadi');
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [isAuthed, load]);

  // The server knows whether this courier is on shift; the app should not
  // assume OFFLINE and quietly stop reporting location after a restart.
  useEffect(() => {
    if (profile) setStatus(profile.status);
  }, [profile?.status]);

  /**
   * Location reporting (TZ §25).
   *
   * Only started once the courier is on shift and only after they grant
   * permission — tracking someone who is off shift is neither needed nor
   * acceptable.
   */
  useEffect(() => {
    if (!isAuthed || status === CourierStatus.OFFLINE) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== 'granted' || cancelled) return;

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 20_000, distanceInterval: 50 },
        (position) => {
          void api.courierApp
            .reportLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyM: position.coords.accuracy ?? undefined,
              headingDeg: position.coords.heading ?? undefined,
              speedMps: position.coords.speed ?? undefined,
            })
            // A dropped ping is not worth interrupting the courier for.
            .catch(() => undefined);
        },
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [isAuthed, status]);

  function refresh() {
    setIsRefreshing(true);
    void load().finally(() => setIsRefreshing(false));
  }

  function fail(caught: unknown, fallback = 'Amal bajarilmadi') {
    Alert.alert('Xatolik', caught instanceof RestorApiError ? caught.message : fallback);
  }

  async function changeStatus(next: CourierStatus) {
    const previous = status;
    setStatus(next); // Optimistic: the toggle must feel instant on mobile data.
    try {
      await api.courierApp.setStatus(next);
    } catch (caught) {
      setStatus(previous);
      fail(caught);
    }
  }

  async function act(job: CourierJob, action: JobAction) {
    try {
      if (action === 'accept') await api.courierApp.accept(job.deliveryId);
      else if (action === 'start') await api.courierApp.startDelivery(job.deliveryId);
      else {
        // Cash collected on delivery credits the courier's wallet (TZ §26).
        await api.courierApp.complete(job.deliveryId, job.isPaid ? 0 : job.amountToCollect);
      }
      await load();
    } catch (caught) {
      fail(caught);
    }
  }

  async function declareHandover(amount: number) {
    try {
      await api.courierApp.declareHandover(amount);
      await load();
    } catch (caught) {
      fail(caught, 'Soʻrov yuborilmadi');
    }
  }

  async function savePhone(phone: string) {
    try {
      setProfile(await api.courierApp.updateMyProfile({ phone }));
    } catch (caught) {
      fail(caught, 'Raqam saqlanmadi');
      throw caught;
    }
  }

  async function logout() {
    await api.auth.logout().catch(() => undefined);
    setIsAuthed(false);
    setProfile(null);
    setJobs([]);
    setWallet(null);
    setTransactions([]);
    setHandovers([]);
    setTab('jobs');
  }

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!isAuthed) return <LoginScreen onSuccess={() => setIsAuthed(true)} />;

  const isOnline = status !== CourierStatus.OFFLINE;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>
            RES<Text style={styles.brandAccent}>TOR</Text>
          </Text>
          <Text style={styles.headerSub}>
            {wallet ? `Qoʻlingizda: ${money(wallet.balance)}` : (profile?.fullName ?? '')}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.statusChip, isOnline && styles.statusChipOn]}
          onPress={() =>
            void changeStatus(isOnline ? CourierStatus.OFFLINE : CourierStatus.AVAILABLE)
          }
        >
          <Text style={styles.statusText}>{isOnline ? 'Onlayn' : 'Oflayn'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {TABS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            {key === 'jobs' && jobs.length > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{jobs.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {tab === 'jobs' && (
        <JobsScreen
          jobs={jobs}
          status={status}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
          onAct={act}
        />
      )}
      {tab === 'wallet' && (
        <WalletScreen
          wallet={wallet}
          profile={profile}
          transactions={transactions}
          handovers={handovers}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
          onDeclare={declareHandover}
        />
      )}
      {tab === 'profile' && (
        <ProfileScreen
          profile={profile}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
          onSavePhone={savePhone}
          onLogout={() => void logout()}
        />
      )}
    </View>
  );
}
