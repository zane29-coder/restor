#!/usr/bin/env bash
#
# Builds a signed release APK for the courier app on a Linux build host.
#
# Expo Go is not an option for couriers: it only runs recent SDKs, and asking a
# courier to install a second app to run the first one is not a deployment.
# This produces the real APK they install once and keep.
#
# Run it on the build server (75.119.148.246), not a workstation:
#
#   ./build-courier-apk.sh setup    # once: JDK 17 + Android SDK 34
#   ./build-courier-apk.sh build    # every release
#
# ASCII only. A Uzbek apostrophe inside ${VAR:-...} breaks bash parameter
# expansion, and these scripts get pasted through several shells.
set -euo pipefail

SDK_ROOT=/opt/android-sdk
BUILD_ROOT=/opt/restor-build
APP="$BUILD_ROOT/apps/courier-mobile"
KEYSTORE="$BUILD_ROOT/restor-courier.keystore"
KEY_ALIAS=restor
CMDLINE_VERSION=11076708  # commandlinetools-linux r13
PROFILE=/etc/profile.d/android-sdk.sh

log() { printf '\033[0;34m>\033[0m %s\n' "$1"; }
ok()  { printf '\033[0;32mOK\033[0m %s\n' "$1"; }
die() { printf '\033[0;31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }

# The keystore file is the secret, and it never leaves this host. The password
# guards nothing extra, so it is fixed rather than prompted -- what actually
# matters is that the SAME keystore is reused for every build. Sign an update
# with a different key and every phone refuses it as a different app.
KEY_PASS="${RESTOR_KEY_PASS:-restor-courier-2026}"

# ---------------------------------------------------------------- setup

setup() {
  log 'Installing JDK 17'
  # 17 specifically: the Android Gradle Plugin that React Native 0.74 pins
  # rejects both 11 and 21.
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq openjdk-17-jdk-headless unzip curl python3

  local java_home
  java_home=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
  ok "java $(java -version 2>&1 | head -1 | cut -d'"' -f2)"

  log 'Installing Android command-line tools'
  mkdir -p "$SDK_ROOT/cmdline-tools"
  cd /tmp
  local zip="commandlinetools-linux-${CMDLINE_VERSION}_latest.zip"
  [ -f "$zip" ] || curl -fsSL -o "$zip" "https://dl.google.com/android/repository/$zip"
  rm -rf "$SDK_ROOT/cmdline-tools/latest" /tmp/cmdline
  unzip -q -o "$zip" -d /tmp/cmdline
  mv /tmp/cmdline/cmdline-tools "$SDK_ROOT/cmdline-tools/latest"
  rm -rf /tmp/cmdline

  cat > "$PROFILE" <<EOF
export JAVA_HOME=$java_home
export ANDROID_HOME=$SDK_ROOT
export ANDROID_SDK_ROOT=$SDK_ROOT
export PATH=\$PATH:$SDK_ROOT/cmdline-tools/latest/bin:$SDK_ROOT/platform-tools
EOF
  chmod 644 "$PROFILE"
  # shellcheck disable=SC1090
  . "$PROFILE"

  log 'Accepting licences and installing SDK 34'
  yes | sdkmanager --licenses >/dev/null 2>&1 || true
  # Gradle pulls the NDK and CMake itself on the first native build.
  sdkmanager --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null

  ok "toolchain ready ($(du -sh "$SDK_ROOT" | cut -f1))"
}

# ---------------------------------------------------------------- signing

# Expo's template ships a release buildType that signs with the DEBUG key, and
# the debug keystore is regenerated per machine -- so a release built that way
# cannot be updated from any other machine. Repoint it at the real keystore.
#
# The anchor is the template's own comment, not the signingConfig line: the
# debug buildType has a byte-identical signingConfig line, so matching on that
# alone would patch the wrong one.
patch_signing() {
  python3 - "$APP/android/app/build.gradle" <<'PY'
import pathlib, sys

gradle = pathlib.Path(sys.argv[1])
comment = '// see https://reactnative.dev/docs/signed-apk-android.'
old = comment + '\n            signingConfig signingConfigs.debug'
new = comment + '\n            signingConfig signingConfigs.release'

src = gradle.read_text()
if new in src:
    print('signing: already patched')
    sys.exit(0)

hits = src.count(old)
if hits != 1:
    sys.exit(f'signing: anchor matched {hits} times, expected 1 -- refusing to edit')

gradle.write_text(src.replace(old, new))
print('signing: release buildType now uses the RESTOR keystore')
PY
}

# ---------------------------------------------------------------- build

build() {
  [ -f "$PROFILE" ] || die "run '$0 setup' first"
  # shellcheck disable=SC1090
  . "$PROFILE"
  [ -d "$APP" ] || die "no app at $APP -- upload apps/courier-mobile and packages/*/dist first"

  cd "$APP"

  log '1/5 npm install'
  npm install --no-audit --no-fund

  log '2/5 expo prebuild'
  # --clean so app.json stays the single source of truth and no hand-edit
  # inside android/ survives silently. It also discards the signing patch,
  # which is why patch_signing runs after this and not before.
  npx expo prebuild --platform android --clean --no-install

  log '3/5 keystore'
  if [ -f "$KEYSTORE" ]; then
    ok 'reusing the existing keystore'
  else
    keytool -genkeypair -v -keystore "$KEYSTORE" -alias "$KEY_ALIAS" \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$KEY_PASS" -keypass "$KEY_PASS" \
      -dname "CN=RESTOR, OU=Courier, O=RESTOR, L=Tashkent, C=UZ"
    ok "created $KEYSTORE -- BACK THIS UP, it cannot be regenerated"
  fi

  log '4/5 wiring release signing'
  # prebuild --clean rewrote gradle.properties, so this appends once per build
  # rather than accumulating.
  cat >> android/gradle.properties <<EOF

RESTOR_UPLOAD_STORE_FILE=$KEYSTORE
RESTOR_UPLOAD_KEY_ALIAS=$KEY_ALIAS
RESTOR_UPLOAD_STORE_PASSWORD=$KEY_PASS
RESTOR_UPLOAD_KEY_PASSWORD=$KEY_PASS
EOF
  patch_signing

  log '5/5 gradle assembleRelease (first run fetches gradle + NDK, ~15 min)'
  cd android
  chmod +x gradlew
  ./gradlew assembleRelease --no-daemon -q

  local apk
  apk=$(find "$APP/android/app/build/outputs/apk/release" -name '*.apk' | head -1)
  [ -n "$apk" ] || die 'gradle reported success but produced no APK'

  # Verify rather than assume: a debug-signed APK looks identical until the
  # day an update is rejected.
  local signer
  signer=$("$SDK_ROOT/build-tools/34.0.0/apksigner" verify --print-certs "$apk" 2>/dev/null \
           | grep -m1 'certificate DN')
  case "$signer" in
    *'CN=RESTOR'*) ok "signed: $signer" ;;
    *) die "signed with the WRONG key: $signer" ;;
  esac

  echo
  ok "APK: $apk"
  ls -lh "$apk" | awk '{print "   size: "$5}'
}

case "${1:-}" in
  setup) setup ;;
  build) build ;;
  *) die "usage: $0 setup|build" ;;
esac
