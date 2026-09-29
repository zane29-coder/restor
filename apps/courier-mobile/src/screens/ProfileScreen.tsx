import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { VehicleType, type CourierProfile } from '@restor/shared-types';
import { colors, money, styles as shared } from '../theme';

const VEHICLES: Record<VehicleType, string> = {
  [VehicleType.FOOT]: 'Piyoda',
  [VehicleType.BICYCLE]: 'Velosiped',
  [VehicleType.SCOOTER]: 'Skuter',
  [VehicleType.MOTORCYCLE]: 'Mototsikl',
  [VehicleType.CAR]: 'Avtomobil',
};

export function ProfileScreen({
  profile,
  isRefreshing,
  onRefresh,
  onSavePhone,
  onLogout,
}: {
  profile: CourierProfile | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSavePhone: (phone: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Follow the server's value when it arrives or changes, but never clobber
  // what the courier is in the middle of typing.
  useEffect(() => {
    if (profile && !isSaving) setPhone(profile.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.phone]);

  if (!profile) {
    return (
      <View style={shared.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const trimmed = phone.trim();
  const isDirty = trimmed !== profile.phone;

  async function save() {
    setIsSaving(true);
    try {
      await onSavePhone(trimmed);
      Alert.alert('Saqlandi', 'Telefon raqamingiz yangilandi.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={shared.list}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.identity}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials(profile.fullName)}</Text>
        </View>
        <Text style={s.name}>{profile.fullName}</Text>
        <Text style={shared.sub}>
          {VEHICLES[profile.vehicleType]}
          {profile.branchName ? ` · ${profile.branchName}` : ''}
        </Text>
      </View>

      <Text style={s.sectionTitle}>BUGUN</Text>
      <View style={s.statsRow}>
        <Stat label="Yetkazildi" value={String(profile.deliveredToday)} />
        <Stat label="Olingan naqd" value={money(profile.collectedToday)} small />
        <Stat label="Daromad" value={money(profile.earnedToday)} small />
      </View>

      <Text style={s.sectionTitle}>ALOQA RAQAMI</Text>
      <View style={shared.card}>
        <Text style={shared.sub}>
          Mijoz eshik oldida shu raqamga qoʻngʻiroq qiladi. Ilovaga kirish raqamingiz
          oʻzgarmaydi.
        </Text>
        <TextInput
          style={[shared.input, { marginTop: 12 }]}
          keyboardType="phone-pad"
          placeholder="+998 90 123 45 67"
          placeholderTextColor={colors.inkSoft}
          value={phone}
          onChangeText={setPhone}
        />
        <TouchableOpacity
          style={[
            shared.btn,
            shared.btnPrimary,
            { marginTop: 12 },
            (!isDirty || isSaving) && shared.btnDisabled,
          ]}
          disabled={!isDirty || isSaving}
          onPress={() => void save()}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={shared.btnPrimaryText}>SAQLASH</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[shared.btn, s.logout]}
        onPress={() =>
          Alert.alert('Chiqish', 'Hisobdan chiqasizmi?', [
            { text: 'Bekor', style: 'cancel' },
            { text: 'Chiqish', style: 'destructive', onPress: onLogout },
          ])
        }
      >
        <Text style={s.logoutText}>CHIQISH</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, small && s.statValueSmall]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const s = StyleSheet.create({
  identity: { alignItems: 'center', paddingVertical: 18 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800', color: colors.ink },

  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '800',
    color: colors.inkSoft,
    marginTop: 18,
    marginBottom: 10,
  },

  statsRow: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.ink },
  statValueSmall: { fontSize: 15 },
  statLabel: { fontSize: 12, color: colors.inkSoft, marginTop: 4, textAlign: 'center' },

  logout: { marginTop: 26, backgroundColor: colors.redSoft },
  logoutText: { color: '#991B1B', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
});
