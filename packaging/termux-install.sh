#!/data/data/com.termux/files/usr/bin/sh
# Installs the runtime and keeps Android from suspending the hub.
set -eu

pkg install -y nodejs-lts
termux-wake-lock

node -e '
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    console.error(`Oktoso needs Node 24 or newer; found ${process.versions.node}.`);
    process.exit(1);
  }
' || exit 1

mkdir -p "$HOME/.config/oktoso" "$HOME/.local/state/oktoso"
chmod 700 "$HOME/.config/oktoso" "$HOME/.local/state/oktoso"

echo "Run the hub once to create a config, then edit it:"
echo "  npx @amoshydra/oktoso"
echo "  \$EDITOR ~/.config/oktoso/hub.config.json"
echo
echo "Keep Termux alive: disable battery optimisation for Termux in Android settings."
echo "The hub binds 127.0.0.1 by default; pair the phone browser through the printed link."
