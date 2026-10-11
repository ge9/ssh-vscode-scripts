#!/usr/bin/env bash
# vscode-server-linux-x64 (または bin/<commit>) の中で実行する

JOBS=2
MODS="node-pty @parcel/watcher @vscode/spdlog @vscode/sqlite3 @vscode/native-watchdog kerberos"

SRV=$(pwd)
NM=$SRV/node_modules
WORK=$HOME/.vscode-server/build-$(basename "$SRV")
[ -d "$NM" ] || { echo "サーバーのルートで実行してください"; exit 1; }

echo "node $(node -v) / ABI $(node -p process.versions.modules)"
mkdir -p "$WORK" && cd "$WORK" || exit 1
[ -f package.json ] || npm init -y >/dev/null 2>&1
npm --version || (echo "error: \`npm --version\` failed"; exit 1; )
GYP=$WORK/node_modules/node-gyp/bin/node-gyp.js
[ -f "$GYP" ] || npm i --save-dev --ignore-scripts node-gyp >/dev/null 2>&1
[ -f "$GYP" ] || { echo "node-gyp の取得に失敗"; exit 1; }

patch_pkg() {
  d=$2
  case "$1" in
    node-pty)
      f=$d/src/unix/pty.cc
      ln=$(awk '/pty_close_inherited_fds\(\)/ && !f {print last; f=1}
                /^#if defined\(__linux__\)$/ {last=NR}' "$f")
      if [ -n "$ln" ]; then
        sed -i.bak "${ln}s/^#if defined(__linux__)\$/#if defined(__FreeBSD__) || defined(__linux__)/" "$f"
        echo "pty.cc: line $ln を修正"
      else
        echo "WARN: pty.cc の対象行が見つからない"
      fi ;;
    kerberos)
      sed -i.bak -e "s/OS=='linux'/OS=='linux' or OS=='freebsd'/g" \
                 -e 's/OS=="linux"/OS=="linux" or OS=="freebsd"/g' "$d/binding.gyp" 2>/dev/null
      sed -i.bak 's/^#if defined(__linux__) || defined(__APPLE__)/#if defined(__FreeBSD__) || defined(__linux__) || defined(__APPLE__)/' \
        "$d/src/kerberos_common.h" 2>/dev/null
      if [ ! -f /usr/include/gssapi/gssapi_generic.h ] && [ ! -f /usr/local/include/gssapi/gssapi_generic.h ]; then
        sed -i.bak 's|#include <gssapi/gssapi_generic.h>|#include <krb5.h>|' "$d/src/unix/kerberos_gss.h" 2>/dev/null
      fi
      # FreeBSD の krb5.h が同名関数を宣言していて曖昧になるので、自前の関数名を変える
      sed -i.bak 's/krb5_get_err_text/kerberos_get_err_text/g' \
        "$d/src/unix/kerberos_gss.h" "$d/src/unix/kerberos_gss.cc" 2>/dev/null ;;
  esac
}

build_one() {
  m=$1
  src=$NM/$m
  dir=$WORK/node_modules/$m
  logf=$WORK/build-$(echo "$m" | tr '/@' '__').log

  echo
  echo "=== $m ==="
  [ -d "$src" ] || { echo "skip: $src が無い"; return 1; }
  ver=$(node -p "require('$src/package.json').version")
  echo "version $ver / log: $logf"

  rm -rf "$dir"
  npm i --ignore-scripts --save-exact "$m@$ver" >"$logf" 2>&1 || { echo "NG: npm i 失敗"; tail -15 "$logf"; return 1; }

  patch_pkg "$m" "$dir"

  ( cd "$dir" && rm -rf build && node "$GYP" rebuild --jobs "$JOBS" ) >>"$logf" 2>&1
  ls "$dir"/build/Release/*.node >/dev/null 2>&1 || { echo "NG: ビルド失敗。ログ末尾:"; tail -25 "$logf"; return 1; }

  # パッケージ経由ではなく .node を直接読む (@parcel/watcher は prebuilt 側が先に読まれるため)
  ok=1
  for f in "$dir"/build/Release/*.node; do
    r=$(node -e "try{require('$f');console.log('OK')}catch(e){console.log('NG: '+e.message.split('\n')[0])}" 2>&1)
    echo "load $(basename "$f"): $r"
    case "$r" in OK*) ;; *) ok=0 ;; esac
  done
  [ $ok = 1 ] || { echo "NG: 読み込めないのでコピーしない"; return 1; }

  mkdir -p "$src/build/Release"
  for f in "$dir"/build/Release/*.node; do
    t=$src/build/Release/$(basename "$f")
    if [ -f "$t" ] && [ ! -f "$t.linux.bak" ]; then cp -p "$t" "$t.linux.bak"; fi
    cp -f "$f" "$t" && echo "copied: $t"
  done
}

OK_LIST=""
NG_LIST=""
for m in $MODS; do
  if build_one "$m"; then OK_LIST="$OK_LIST $m"; else NG_LIST="$NG_LIST $m"; fi
done

echo
echo "=== サーバー側の読み込み確認 ==="
cd "$SRV" || exit 1
for m in $MODS vsda; do
  printf '%-26s ' "$m"
  node -e "try{require('./node_modules/$m');console.log('OK')}catch(e){console.log('NG:',e.message.split('\n')[0])}"
done
echo
echo "成功:${OK_LIST:- なし}"
echo "失敗:${NG_LIST:- なし}"

