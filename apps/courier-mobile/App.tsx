import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import {
  CourierStatus,
  DeliveryStatus,
  type CourierJob,
  type CourierWallet,
} from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { api } from './src/api';

/**
 * Courier app (TZ §23-§26).
 *
 * Every endpoint it calls is scoped to the signed-in courier server-side — the
 * app never sends its own courier id, so it cannot read another courier's
 * jobs even if the screen were tampered with.
 */
export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [jobs, setJobs] = useState<CourierJob[]>([]);
  const [wallet, setWallet] = useState<CourierWallet | null>(null);
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

  const load = useCallback(async () => {
    try {
      const [loadedJobs, loadedWallet] = await Promise.all([
        api.courierApp.myJobs(),
        api.courierApp.myWallet().catch(() => null),
      ]);
      setJobs(loadedJobs);
      setWallet(loadedWallet);
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

  /**
   * Location reporting (TZ §25).
   *
   * Only started once the courier goes AVAILABLE and only after they grant
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

  async function changeStatus(next: CourierStatus) {
    try {
      await api.courierApp.setStatus(next);
      setStatus(next);
    } catch (caught) {
      Alert.alert('Xatolik', caught instanceof RestorApiError ? caught.message : 'Amal bajarilmadi');
    }
  }

  async function act(job: CourierJob, action: 'accept' | 'start' | 'complete') {
    try {
      if (action === 'accept') await api.courierApp.accept(job.deliveryId);
      else if (action === 'start') await api.courierApp.startDelivery(job.deliveryId);
      else {
        // Cash collected on delivery credits the courier's wallet (TZ §26).
        await api.courierApp.complete(
          job.deliveryId,
          job.isPaid ? 0 : job.amountToCollect,
        );
      }
      await load();
    } catch (caught) {
      Alert.alert('Xatolik', caught instanceof RestorApiError ? caught.message : 'Amal bajarilmadi');
    }
  }

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF6B00" />
      </View>
    );
  }

  if (!isAuthed) return <LoginScreen onSuccess={() => setIsAuthed(true)} />;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>
            RES<Text style={{ color: '#FF6B00' }}>TOR</Text>
          </Text>
          {wallet && (
            <Text style={styles.walletText}>
              Qoʻlingizda: {formatMoney(wallet.balance)}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.statusChip, status !== CourierStatus.OFFLINE && styles.statusChipOn]}
          onPress={() =>
            void changeStatus(
              status === CourierStatus.OFFLINE ? CourierStatus.AVAILABLE : CourierStatus.OFFLINE,
            )
          }
        >
          <Text style={styles.statusText}>
            {status === CourierStatus.OFFLINE ? 'Oflayn' : 'Onlayn'}
          </Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              setIsRefreshing(true);
              void load().finally(() => setIsRefreshing(false));
            }}
          />
        }
      >
        {jobs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Buyurtma yoʻq</Text>
            <Text style={styles.emptyHint}>
              {status === CourierStatus.OFFLINE
                ? 'Buyurtma olish uchun “Onlayn” tugmasini bosing.'
                : 'Yangi buyurtma kutilmoqda…'}
            </Text>
          </View>
        ) : (
          jobs.map((job) => <JobCard key={job.deliveryId} job={job} onAct={act} />)
        )}
      </ScrollView>
    </View>
  );
}

function JobCard({
  job,
  onAct,
}: {
  job: CourierJob;
  onAct: (job: CourierJob, action: 'accept' | 'start' | 'complete') => Promise<void>;
}) {
  const action =
    job.status === DeliveryStatus.ASSIGNED
      ? { key: 'accept' as const, label: 'QABUL QILISH' }
      : job.status === DeliveryStatus.ACCEPTED
        ? { key: 'start' as const, label: 'YOʻLGA CHIQDIM' }
        : job.status === DeliveryStatus.PICKED_UP
          ? { key: 'complete' as const, label: 'YETKAZILDI' }
          : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardNumber}>{job.displayNumber}</Text>
        <View style={[styles.pill, job.isPaid ? styles.pillPaid : styles.pillUnpaid]}>
          <Text style={styles.pillText}>{job.isPaid ? 'Toʻlangan' : 'Naqd olinadi'}</Text>
        </View>
      </View>

      <Text style={styles.label}>Olish</Text>
      <Text style={styles.value}>{job.branchName}</Text>
      <Text style={styles.sub}>{job.branchAddress}</Text>

      <Text style={[styles.label, { marginTop: 10 }]}>Manzil</Text>
      <Text style={styles.value}>{job.address}</Text>
      {job.comment && <Text style={styles.sub}>✎ {job.comment}</Text>}

      <Text style={[styles.label, { marginTop: 10 }]}>Tarkibi</Text>
      <Text style={styles.sub}>{job.itemsSummary}</Text>

      <View style={styles.amountRow}>
        <Text style={styles.amountLabel}>
          {job.isPaid ? 'Buyurtma summasi' : 'Olinadigan summa'}
        </Text>
        <Text style={styles.amount}>
          {formatMoney(job.isPaid ? job.orderTotal : job.amountToCollect)}
        </Text>
      </View>

      <View style={styles.actions}>
        {job.customerPhone && (
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => void Linking.openURL(`tel:${job.customerPhone}`)}
          >
            <Text style={styles.btnGhostText}>QOʻNGʻIROQ</Text>
          </TouchableOpacity>
        )}
        {job.latitude != null && job.longitude != null && (
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() =>
              void Linking.openURL(
                // Opens whichever maps app the courier has installed.
                `geo:${job.latitude},${job.longitude}?q=${job.latitude},${job.longitude}`,
              )
            }
          >
            <Text style={styles.btnGhostText}>XARITA</Text>
          </TouchableOpacity>
        )}
      </View>

      {action && (
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => void onAct(job, action.key)}
        >
          <Text style={styles.btnPrimaryText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.auth.login({
        login: login.trim(),
        password,
        tenantSlug: tenantSlug.trim() || undefined,
      });
      onSuccess();
    } catch (caught) {
      setError(caught instanceof RestorApiError ? caught.message : 'Kirish amalga oshmadi');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.loginScreen}>
      <StatusBar style="light" />
      <Text style={styles.loginBrand}>
        RES<Text style={{ color: '#FF6B00' }}>TOR</Text>
      </Text>
      <Text style={styles.loginSub}>Kuryer ilovasi</Text>

      {error && <Text style={styles.loginError}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="Telefon"
        placeholderTextColor="#94A3B8"
        keyboardType="phone-pad"
        autoCapitalize="none"
        value={login}
        onChangeText={setLogin}
      />
      <TextInput
        style={styles.input}
        placeholder="Parol"
        placeholderTextColor="#94A3B8"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="Restoran (ixtiyoriy)"
        placeholderTextColor="#94A3B8"
        autoCapitalize="none"
        value={tenantSlug}
        onChangeText={setTenantSlug}
      />

      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, { marginTop: 8 }]}
        onPress={() => void submit()}
        disabled={isSubmitting}
      >
        <Text style={styles.btnPrimaryText}>{isSubmitting ? 'TEKSHIRILMOQDA…' : 'KIRISH'}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** 56px minimum hit targets: a courier taps these one-handed, outdoors. */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },

  header: {
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 18,
    backgroundColor: '#1F2937',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  walletText: { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  statusChip: {
    paddingHorizontal: 16,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  statusChipOn: { backgroundColor: '#16A34A' },
  statusText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  errorBar: { backgroundColor: '#FEE2E2', paddingVertical: 10, paddingHorizontal: 18 },
  errorText: { color: '#991B1B', fontSize: 13 },

  list: { padding: 14, paddingBottom: 40 },

  empty: { alignItems: 'center', paddingVertical: 70 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 6 },
  emptyHint: { fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 30 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardNumber: { fontSize: 21, fontWeight: '800', color: '#111827' },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillPaid: { backgroundColor: '#DCFCE7' },
  pillUnpaid: { backgroundColor: '#FEF3C7' },
  pillText: { fontSize: 12, fontWeight: '700', color: '#111827' },

  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6B7280' },
  value: { fontSize: 15, fontWeight: '600', color: '#111827', marginTop: 2 },
  sub: { fontSize: 13, color: '#6B7280', marginTop: 2 },

  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  amountLabel: { fontSize: 13, color: '#6B7280' },
  amount: { fontSize: 20, fontWeight: '800', color: '#111827' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },

  btn: { minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flex: 1 },
  btnPrimary: { backgroundColor: '#FF6B00', marginTop: 10 },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  btnGhost: { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  btnGhostText: { color: '#111827', fontWeight: '700', fontSize: 13 },

  loginScreen: { flex: 1, backgroundColor: '#1F2937', padding: 26, justifyContent: 'center' },
  loginBrand: { color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  loginSub: { color: '#94A3B8', textAlign: 'center', marginBottom: 26, marginTop: 4 },
  loginError: {
    backgroundColor: '#7F1D1D',
    color: '#FECACA',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    fontSize: 13,
  },
  input: {
    backgroundColor: '#374151',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    minHeight: 54,
    fontSize: 16,
    marginBottom: 12,
  },
});
