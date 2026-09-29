import {
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CourierStatus, DeliveryStatus, type CourierJob } from '@restor/shared-types';
import { colors, money, styles as shared } from '../theme';

export type JobAction = 'accept' | 'start' | 'complete';

export function JobsScreen({
  jobs,
  status,
  isRefreshing,
  onRefresh,
  onAct,
}: {
  jobs: CourierJob[];
  status: CourierStatus;
  isRefreshing: boolean;
  onRefresh: () => void;
  onAct: (job: CourierJob, action: JobAction) => Promise<void>;
}) {
  return (
    <ScrollView
      contentContainerStyle={shared.list}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
    >
      {jobs.length === 0 ? (
        <View style={shared.empty}>
          <Text style={shared.emptyTitle}>Buyurtma yoʻq</Text>
          <Text style={shared.emptyHint}>
            {status === CourierStatus.OFFLINE
              ? 'Buyurtma olish uchun “Onlayn” tugmasini bosing.'
              : 'Yangi buyurtma kutilmoqda…'}
          </Text>
        </View>
      ) : (
        jobs.map((job) => <JobCard key={job.deliveryId} job={job} onAct={onAct} />)
      )}
    </ScrollView>
  );
}

function JobCard({
  job,
  onAct,
}: {
  job: CourierJob;
  onAct: (job: CourierJob, action: JobAction) => Promise<void>;
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
    <View style={shared.card}>
      <View style={s.head}>
        <Text style={s.number}>{job.displayNumber}</Text>
        <View style={[s.pill, job.isPaid ? s.pillPaid : s.pillUnpaid]}>
          <Text style={s.pillText}>{job.isPaid ? 'Toʻlangan' : 'Naqd olinadi'}</Text>
        </View>
      </View>

      <Text style={shared.label}>Olish</Text>
      <Text style={shared.value}>{job.branchName}</Text>
      <Text style={shared.sub}>{job.branchAddress}</Text>

      <Text style={[shared.label, { marginTop: 10 }]}>Manzil</Text>
      <Text style={shared.value}>{job.address}</Text>
      {/*
        A typographic label rather than an icon: rendering SVG in React Native
        needs `react-native-svg`, a native dependency not worth adding for one
        glyph. The uppercase tag reads as a field label, which is what it is.
      */}
      {job.comment && (
        <Text style={shared.sub}>
          <Text style={s.noteTag}>IZOH </Text>
          {job.comment}
        </Text>
      )}

      <Text style={[shared.label, { marginTop: 10 }]}>Tarkibi</Text>
      <Text style={shared.sub}>{job.itemsSummary}</Text>

      <View style={s.amountRow}>
        <Text style={s.amountLabel}>
          {job.isPaid ? 'Buyurtma summasi' : 'Olinadigan summa'}
        </Text>
        <Text style={s.amount}>{money(job.isPaid ? job.orderTotal : job.amountToCollect)}</Text>
      </View>

      <View style={s.actions}>
        {job.customerPhone && (
          <TouchableOpacity
            style={[shared.btn, shared.btnFlex, shared.btnGhost]}
            onPress={() => void Linking.openURL(`tel:${job.customerPhone}`)}
          >
            <Text style={shared.btnGhostText}>QOʻNGʻIROQ</Text>
          </TouchableOpacity>
        )}
        {job.latitude != null && job.longitude != null && (
          <TouchableOpacity
            style={[shared.btn, shared.btnFlex, shared.btnGhost]}
            onPress={() =>
              void Linking.openURL(
                // Opens whichever maps app the courier has installed.
                `geo:${job.latitude},${job.longitude}?q=${job.latitude},${job.longitude}`,
              )
            }
          >
            <Text style={shared.btnGhostText}>XARITA</Text>
          </TouchableOpacity>
        )}
      </View>

      {action && (
        <TouchableOpacity
          style={[shared.btn, shared.btnPrimary, { marginTop: 10 }]}
          onPress={() => void onAct(job, action.key)}
        >
          <Text style={shared.btnPrimaryText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  number: { fontSize: 21, fontWeight: '800', color: colors.ink },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillPaid: { backgroundColor: colors.greenSoft },
  pillUnpaid: { backgroundColor: colors.amberSoft },
  pillText: { fontSize: 12, fontWeight: '700', color: colors.ink },

  noteTag: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: '#B45309' },

  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  amountLabel: { fontSize: 13, color: colors.inkSoft },
  amount: { fontSize: 20, fontWeight: '800', color: colors.ink },

  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
