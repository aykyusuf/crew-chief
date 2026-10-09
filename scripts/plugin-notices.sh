#!/bin/sh
# crew-chief update notices, shown to the user (hook JSON "systemMessage"), not to the model.
#
# Usage:
#   plugin-notices.sh prompt   UserPromptSubmit: on the first prompt after an update, say what
#                              changed (the first lines of that version's CHANGELOG.md section);
#                              in a session that still runs a replaced copy, say so once instead
#
# Why UserPromptSubmit and not SessionStart: Claude Code prints a UserPromptSubmit hook's
# systemMessage under the prompt, but shows nothing for a SessionStart hook's (checked on 2.1.295).
#
# State lives in ${CLAUDE_PLUGIN_DATA}, never in the project:
#   last-seen-version        the version the user was last told about
#   stale-notified/<session> marker so the stale notice appears once per session
#   claude-version-checked   the plugin version for which Claude Code's own version was checked
# A fresh install records the version and stays quiet, except for the Claude Code version warning
# (once per plugin version). Turn both off with CREW_CHIEF_WHATS_NEW=off.
# Language: English or Turkish. CREW_CHIEF_LANG=tr|en forces it; otherwise the prompt that triggered
# the notice decides (Turkish letters and common Turkish words), then the LANG locale, then English.
# The what's-new notes come from CHANGELOG.tr.md when it has a section for this version.
# Reads the hook input with jq when available, otherwise with sed.

input=$(cat)

field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r ".$1 // empty" 2>/dev/null
    return
  fi
  printf '%s' "$input" | tr '\n' ' ' |
    sed -nE 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' |
    sed -e 's/\\"/"/g' -e 's/\\\\/\\/g'
}

# stdin -> one JSON string literal
json_string() {
  tr -d '\000-\011\013-\037' |
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' |
    awk 'BEGIN { printf "\"" } { printf "%s%s", (NR > 1 ? "\\n" : ""), $0 } END { printf "\"" }'
}

# Cutting a line at N bytes can split a multi-byte character; drop the broken tail.
utf8_clean() {
  if command -v iconv >/dev/null 2>&1; then iconv -c -f UTF-8 -t UTF-8 2>/dev/null; else cat; fi
}

# stdin: the prompt text. Prints "tr", "en", or nothing when it cannot tell. Mirrors classifyText in
# hooks/saver-i18n.mjs (same word lists, a test fails when they drift; same code filter and scoring),
# except that one clear Turkish sign is enough here: a wrong guess only changes the language of a
# one-off notice. Runs in the C locale on purpose: byte-wise matching of the UTF-8 letters behaves
# the same on macOS awk, mawk and gawk, whatever locale the hook inherited.
classify_prompt() {
  LC_ALL=C awk '
    BEGIN {
      n = split("bir bu için evet hayır tamam bana gibi daha çok yap yaz bakalım nasıl neden şu bunu şunu olsun olur değil lütfen merhaba selam peki hepsini sonra önce kadar göster ekle sil düzelt devam başla şimdi zaten çünkü hangi burada yeni eski iyi günler günaydın teşekkürler sağol", a, " ")
      for (i = 1; i <= n; i++) turkish[a[i]] = 1
      n = split("the and is are to of for with that this you can it in be do not what how please yes fix add run why when where will would should have has was from my your we me if then so but or as at by all now just also make use need want", b, " ")
      for (i = 1; i <= n; i++) english[b[i]] = 1
    }
    NR == 1 && $0 ~ /^[ \t]*\// { slash = 1 }
    /^[ \t]*(```|~~~)/ { fenced = !fenced; next }
    fenced { next }
    /^    / || /^\t/ { next }
    /[{};]/ || /=>/ || /\(\)/ || /::/ || /^[ \t]*\$ / || /^[ \t]*[A-Za-z0-9_]+Error:/ || /[ \t]at[ \t]+[^ \t]+[ \t]*\(/ { next }
    { text = text " " $0 }
    END {
      if (slash) exit
      text = substr(text, 1, 2000)
      letters = text
      found = gsub(/ı|ğ|ş|İ|Ğ|Ş/, "", letters)
      if (found > 6) found = 6
      gsub(/İ/, "i", text); gsub(/Ç/, "ç", text); gsub(/Ğ/, "ğ", text)
      gsub(/Ö/, "ö", text); gsub(/Ş/, "ş", text); gsub(/Ü/, "ü", text)
      words_tr = 0; words_en = 0
      count = split(tolower(text), words, /[^a-zA-Z\200-\377]+/)
      for (i = 1; i <= count; i++) {
        if (words[i] == "") continue
        if (words[i] in turkish) words_tr++
        if (words[i] in english) words_en++
      }
      score = words_tr * 2 + found
      leads = (score > words_en) || (words_tr >= 2 && score >= words_en)
      if ((words_tr >= 1 || (found >= 1 && words_en == 0)) && score >= 2 && leads) print "tr"
      else if (words_en >= 2 && words_en > score) print "en"
    }'
}

# "tr" or "en" for the notice about to be printed.
notice_lang() {
  case "$(printf '%s' "${CREW_CHIEF_LANG:-}" | tr 'A-Z' 'a-z')" in
    tr|turkish|turkce|türkçe|tÜrkÇe) echo tr; return ;;
    en|english|ingilizce) echo en; return ;;
  esac
  guess=$(field prompt | head -n 20 | classify_prompt)
  if [ -n "$guess" ]; then echo "$guess"; return; fi
  case "${LANG:-}" in
    tr|tr_*|tr.*|tr@*) echo tr ;;
    *) echo en ;;
  esac
}

# Prints a one-line warning when Claude Code is older than 2.1.287 (the first version with mods),
# nothing otherwise or when the version cannot be read. CREW_CHIEF_CLAUDE_VERSION is for tests.
old_claude_warning() {
  cc=${CREW_CHIEF_CLAUDE_VERSION:-}
  if [ -z "$cc" ] && command -v claude >/dev/null 2>&1; then
    cc=$(claude --version 2>/dev/null | head -n 1)
  fi
  nums=$(printf '%s' "$cc" | sed -nE 's/^[^0-9]*([0-9]+)\.([0-9]+)\.([0-9]+).*/\1 \2 \3/p')
  [ -n "$nums" ] || return 0
  set -- $nums
  if [ $(( $1 * 1000000 + $2 * 1000 + $3 )) -lt 2001287 ]; then
    if [ "$(notice_lang)" = "tr" ]; then
      printf '%s' "crew-chief'in limit takibi yapan tasarruf modu Claude Code 2.1.287 veya üstünü ister (bu sürüm $1.$2.$3). Almak için Claude Code'u güncelle; geri kalan her şey olduğu gibi çalışır."
    else
      printf '%s' "crew-chief's limit-aware saver needs Claude Code 2.1.287 or later (this is $1.$2.$3). Update Claude Code to get it; everything else works as it is."
    fi
  fi
}

root=${CLAUDE_PLUGIN_ROOT:-}
data=${CLAUDE_PLUGIN_DATA:-}
[ -n "$root" ] && [ -n "$data" ] || exit 0
[ "$1" = "prompt" ] || exit 0

# Claude Code marks the previous version directory when an update replaces it. A session still
# running that copy gets the stale notice and nothing else: it must not announce an older version.
if [ -e "$root/.orphaned_at" ]; then
  sid=$(field session_id)
  case "$sid" in
    ''|*[!A-Za-z0-9_-]*) exit 0 ;;
  esac
  marker="$data/stale-notified/$sid"
  [ -e "$marker" ] && exit 0
  mkdir -p "$data/stale-notified" 2>/dev/null && : > "$marker" 2>/dev/null || exit 0
  find "$data/stale-notified" -type f -mtime +14 -delete 2>/dev/null
  if [ "$(notice_lang)" = "tr" ]; then
    printf '%s\n' '{"systemMessage":"crew-chief güncellendi (ya da kaldırıldı); bu session hâlâ eski kopyayı çalıştırıyor. Geçmek için /reload-plugins çalıştır ya da yeni session aç."}'
  else
    printf '%s\n' '{"systemMessage":"crew-chief was updated (or removed) after this session started, so this session still runs the old copy. Run /reload-plugins to switch, or start a new session."}'
  fi
  exit 0
fi

[ "${CREW_CHIEF_WHATS_NEW:-on}" = "off" ] && exit 0
ver=$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$root/.claude-plugin/plugin.json" 2>/dev/null | head -n 1)
[ -n "$ver" ] || exit 0
state="$data/last-seen-version"
checked_state="$data/claude-version-checked"
seen=$(head -n 1 "$state" 2>/dev/null | tr -d '\r')
checked=$(head -n 1 "$checked_state" 2>/dev/null | tr -d '\r')
[ "$seen" = "$ver" ] && [ "$checked" = "$ver" ] && exit 0

msg=
if [ "$seen" != "$ver" ]; then
  # No record yet: a fresh install has an empty data directory; an upgrade from a version
  # that predates this file already holds the handoff answers, so tell those users too.
  upgrade=
  [ -n "$seen" ] || [ -e "$data/handoff-offers.tsv" ] && upgrade=1
  # Record first: if printing fails, the notice is lost rather than repeated at every prompt.
  mkdir -p "$data" 2>/dev/null && printf '%s\n' "$ver" > "$state" 2>/dev/null || exit 0
  if [ -n "$upgrade" ]; then
    lang=$(notice_lang)
    changelog="$root/CHANGELOG.md"
    footer="Full list: CHANGELOG.md in the plugin repository."
    if [ "$lang" = "tr" ]; then
      footer="Tam liste: plugin deposundaki CHANGELOG.tr.md."
      # Turkish notes only when the Turkish file has this version; otherwise the English ones.
      if awk -v v="$ver" '$1 == "##" && $2 == v { found = 1 } END { exit !found }' "$root/CHANGELOG.tr.md" 2>/dev/null; then
        changelog="$root/CHANGELOG.tr.md"
      else
        footer="Tam liste: plugin deposundaki CHANGELOG.md (İngilizce)."
      fi
    fi
    notes=$(awk -v v="$ver" '$1 == "##" && $2 == v { on = 1; next } /^## / { on = 0 } on && /^- /' "$changelog" 2>/dev/null |
      head -n 3 | awk '{ print (length($0) > 200 ? substr($0, 1, 199) "…" : $0) }' | utf8_clean | sed 's/^- /• /')
    if [ "$lang" = "tr" ]; then
      msg="crew-chief $ver sürümüne güncellendi"
      [ -n "$seen" ] && msg="crew-chief güncellendi: $seen -> $ver"
    else
      msg="crew-chief updated to $ver"
      [ -n "$seen" ] && msg="crew-chief updated: $seen -> $ver"
    fi
    [ -n "$notes" ] && msg="$msg
$notes
$footer"
  fi
fi

# Once per plugin version, also on a fresh install: the saver is a mod, and mods need Claude Code 2.1.287.
if [ "$checked" != "$ver" ]; then
  mkdir -p "$data" 2>/dev/null && printf '%s\n' "$ver" > "$checked_state" 2>/dev/null || exit 0
  warn=$(old_claude_warning)
  if [ -n "$warn" ]; then
    if [ -n "$msg" ]; then msg="$msg
$warn"; else msg=$warn; fi
  fi
fi

[ -n "$msg" ] || exit 0
printf '{"systemMessage":%s}\n' "$(printf '%s' "$msg" | json_string)"
exit 0
