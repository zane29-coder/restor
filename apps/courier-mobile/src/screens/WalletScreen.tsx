import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  CourierTransactionType,
  HandoverStatus,
  type CashHandover,
  type CourierProfile,
  type CourierTransaction,
  type CourierWallet,
} from '@restor/shared-types';
import { colors, money, styles as shared, timeLabel } from '../theme';

/**
 * How each movement reads to the courier.
 *
 * The signs are the ones the courier feels in their pocket, which is not the
 * same as the sign stored on the row: DELIVERY_INCOME never touches the cash
 * they are holding (it is what the restaurant owes them), so it is shown as a
 * gain but in a different colour from cash taken at the door. Conflating the
 * two is how a courier ends up handing over money they were owed.
 */
const MOVEMENTS: Record<
  CourierTransactionType,
  { label: string; sign: '+' | '-' | null; color: string }
> = {
  [CourierTransactionType.CASH_RECEIVED]: {
    label: 'Mijozdan olindi',
    sign: '+',
    color: colors.green,
  },
  [CourierTransactionType.DELIVERY_INCOME]: {
    label: 'Yetkazish daromadi',
    sign: '+',
    color: colors.blue,
  },
  [CourierTransactionType.HANDOVER]: {
    label: 'Kassaga topshirildi',
    sign: '-',
    color: colors.inkSoft,
  },
  [CourierTransactionType.EXPENSE]: { label: 'Xarajat', sign: '-', color: colors.red },
  [CourierTransactionType.ADJUSTMENT]: { label: 'Tuzatish', sign: null, color: colors.ink },
};

export function WalletScreen({
  wallet,
  profile,
  transactions,
  handovers,
  isRefreshing,
  onRefresh,
  onDeclare,
}: {
  wallet: CourierWallet | null;
  profile: CourierProfile | null;
  transactions: CourierTransaction[];
  handovers: CashHandover[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onDeclare: (amount: number) => Promise<void>;
}) {
  const [isDeclaring, setIsDeclaring] = useState(false);

  const balance = wallet?.balance ?? 0;
  const pending = useMemo(
    () => handovers.find((h) => h.status === HandoverStatus.PENDING) ?? null,
    [handovers],
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={shared.list}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>QOʻLINGIZDAGI NAQD</Text>
          <Text style={s.balance}>{money(balance)}</Text>

          <View style={s.todayRow}>
            <View style={s.todayCell}>
              <Text style={s.todayLabel}>Bugun olindi</Text>
              <Text style={s.todayValue}>{money(profile?.collectedToday ?? 0)}</Text>
            </View>
            <View style={s.todayDivider} />
            <View style={s.todayCell}>
              <Text style={s.todayLabel}>Bugungi daromad</Text>
              <Text style={[s.todayValue, { color: '#93C5FD' }]}>
                {money(profile?.earnedToday ?? 0)}
              </Text>
            </View>
          </View>
        </View>

        {pending ? (
          <View style={s.pendingCard}>
            <Text style={s.pendingLabel}>KASSIR TASDIQLASHI KUTILMOQDA</Text>
            <Text style={s.pendingAmount}>{money(pending.amount)}</Text>
            <Text style={shared.sub}>
              {timeLabel(pending.declaredAt)} da yuborilgan. Kassir tasdiqlagach, pulni
              topshirasiz va balans kamayadi.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[shared.btn, shared.btnPrimary, balance <= 0 && shared.btnDisabled]}
            onPress={() => setIsDeclaring(true)}
            disabled={balance <= 0}
          >
            <Text style={shared.btnPrimaryText}>KASSAGA TOPSHIRISH</Text>
          </TouchableOpacity>
        )}

        <Text style={s.sectionTitle}>HARAKATLAR</Text>

        {transactions.length === 0 ? (
          <View style={shared.empty}>
            <Text style={shared.emptyTitle}>Hozircha boʻsh</Text>
            <Text style={shared.emptyHint}>
              Birinchi buyurtmani yetkazganingizdan soʻng bu yerda koʻrinadi.
            </Text>
          </View>
        ) : (
          <View style={shared.card}>
            {transactions.map((tx, index) => (
              <MovementRow key={tx.id} tx={tx} isLast={index === transactions.length - 1} />
            ))}
          </View>
        )}
      </ScrollView>

      <HandoverModal
        visible={isDeclaring}
        balance={balance}
        branchName={profile?.branchName ?? null}
        onCancel={() => setIsDeclaring(false)}
        onConfirm={async (amount) => {
          await onDeclare(amount);
          setIsDeclaring(false);
        }}
      />
    </>
  );
}

function MovementRow({ tx, isLast }: { tx: CourierTransaction; isLast: boolean }) {
  const movement = MOVEMENTS[tx.type];
  // ADJUSTMENT is the only signed amount; everything else stores a magnitude.
  const sign = movement.sign ?? (tx.amount < 0 ? '-' : '+');

  return (
    <View style={[s.row, !isLast && s.rowDivider]}>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{movement.label}</Text>
        <Text style={s.rowMeta}>
          {timeLabel(tx.createdAt)}
          {tx.comment ? ` · ${tx.comment}` : ''}
        </Text>
      </View>
      <Text style={[s.rowAmount, { color: movement.color }]}>
        {sign}
        {money(Math.abs(tx.amount))}
      </Text>
    </View>
  );
}

function HandoverModal({
  visible,
  balance,
  branchName,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  balance: number;
  branchName: string | null;
  onCancel: () => void;
  onConfirm: (amount: number) => Promise<void>;
}) {
  // Pre-filled with the whole balance, which is what a courier hands over at
  // the end of a shift almost every time.
  const [raw, setRaw] = useState(String(balance));
  const [isSending, setIsSending] = useState(false);

  // Remount on open so the default tracks a balance that changed meanwhile.
  const amount = Number(raw.replace(/\D/g, '')) || 0;
  const isValid = amount > 0 && amount <= balance;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={() => setRaw(String(balance))}
      onRequestClose={onCancel}
    >
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Kassaga topshirish</Text>
          <Text style={shared.sub}>
            {branchName
              ? `${branchName} kassasiga soʻrov yuboriladi.`
              : 'Kassirga soʻrov yuboriladi.'}{' '}
            Kassir tasdiqlagandan keyin balansingiz kamayadi.
          </Text>

          <Text style={[shared.label, { marginTop: 18 }]}>Summa</Text>
          <TextInput
            style={[shared.input, { marginTop: 6 }]}
            keyboardType="number-pad"
            value={raw}
            onChangeText={setRaw}
            selectTextOnFocus
          />
          <Text style={[shared.sub, !isValid && amount > balance ? s.warn : null]}>
            {amount > balance
              ? `Qoʻlingizda ${money(balance)} bor`
              : `Maksimal: ${money(balance)}`}
          </Text>

          <View style={s.sheetActions}>
            <TouchableOpacity
              style={[shared.btn, shared.btnFlex, shared.btnGhost]}
              onPress={onCancel}
              disabled={isSending}
            >
              <Text style={shared.btnGhostText}>BEKOR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                shared.btn,
                shared.btnFlex,
                shared.btnPrimary,
                (!isValid || isSending) && shared.btnDisabled,
              ]}
              disabled={!isValid || isSending}
              onPress={() => {
                setIsSending(true);
                void onConfirm(amount).finally(() => setIsSending(false));
              }}
            >
              {isSending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={shared.btnPrimaryText}>YUBORISH</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  balanceCard: {
    backgroundColor: colors.dark,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  balanceLabel: { color: colors.darkText, fontSize: 11, letterSpacing: 0.8, fontWeight: '700' },
  balance: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 6 },

  todayRow: {
    flexDirection: 'row',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  todayCell: { flex: 1 },
  todayDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 14 },
  todayLabel: { color: colors.darkText, fontSize: 12 },
  todayValue: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 3 },

  pendingCard: {
    backgroundColor: colors.amberSoft,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pendingLabel: { fontSize: 11, letterSpacing: 0.8, fontWeight: '800', color: '#B45309' },
  pendingAmount: { fontSize: 24, fontWeight: '800', color: colors.ink, marginVertical: 4 },

  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '800',
    color: colors.inkSoft,
    marginTop: 22,
    marginBottom: 10,
  },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: colors.ink },
  rowMeta: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  rowAmount: { fontSize: 16, fontWeight: '800' },

  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 22,
    paddingBottom: 34,
  },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: colors.ink, marginBottom: 6 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  warn: { color: colors.red },
});
