import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { RestorApiError } from '@restor/api-client';
import { api } from '../api';
import { colors, styles as shared } from '../theme';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = login.trim().length > 0 && password.length > 0 && !isSubmitting;

  async function submit() {
    if (!canSubmit) return;
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
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.brand}>
          RES<Text style={{ color: colors.brand }}>TOR</Text>
        </Text>
        <Text style={s.sub}>Kuryer ilovasi</Text>

        {error && <Text style={s.error}>{error}</Text>}

        <TextInput
          style={s.input}
          placeholder="Telefon"
          placeholderTextColor={colors.darkText}
          keyboardType="phone-pad"
          autoCapitalize="none"
          textContentType="username"
          value={login}
          onChangeText={setLogin}
        />

        <View style={s.passwordRow}>
          <TextInput
            style={[s.input, s.passwordInput]}
            placeholder="Parol"
            placeholderTextColor={colors.darkText}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
          />
          {/*
            A word rather than an eye icon: drawing one would mean adding
            react-native-svg, a native dependency, for a single glyph. The
            label also says plainly what tapping does, which an eye does not --
            a struck-through eye reads as "hidden" to some people and "hide" to
            others.
          */}
          <TouchableOpacity
            style={s.peek}
            onPress={() => setShowPassword((on) => !on)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Parolni yashirish' : 'Parolni koʻrsatish'}
          >
            <Text style={s.peekText}>{showPassword ? 'YASHIR' : 'KOʻRSAT'}</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={s.input}
          placeholder="Restoran (ixtiyoriy)"
          placeholderTextColor={colors.darkText}
          autoCapitalize="none"
          value={tenantSlug}
          onChangeText={setTenantSlug}
        />

        <TouchableOpacity
          style={[shared.btn, shared.btnPrimary, s.submit, !canSubmit && shared.btnDisabled]}
          onPress={() => void submit()}
          disabled={!canSubmit}
        >
          <Text style={shared.btnPrimaryText}>
            {isSubmitting ? 'TEKSHIRILMOQDA…' : 'KIRISH'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.dark },
  // `justifyContent: center` on the *content* container, so the form stays
  // centred when it fits and scrolls when the keyboard covers it.
  body: { flexGrow: 1, justifyContent: 'center', padding: 26 },

  brand: { color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.darkText, textAlign: 'center', marginBottom: 26, marginTop: 4 },
  error: {
    backgroundColor: '#7F1D1D',
    color: '#FECACA',
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
    fontSize: 13,
  },

  input: {
    backgroundColor: colors.darkSoft,
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    minHeight: 54,
    fontSize: 16,
    marginBottom: 12,
  },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 96 },
  peek: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  peekText: { color: colors.brand, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },

  // A fixed height, and no `flex`: the button is as tall as a button, not as
  // tall as whatever space happens to be left over.
  submit: { marginTop: 8 },
});
