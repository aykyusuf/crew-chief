#!/bin/sh
# crew-chief security risk map: which files of a project are security-relevant, and why.
#
#   security-map.sh scan [project dir]        build or refresh <project>/.crew-chief/security-map.json from the
#                                             tracked files (path rules and `git grep` content rules); entries the
#                                             user added by hand ("manual": true, or a "glob") are kept
#   security-map.sh match [project dir] FILE...  print "category<TAB>file<TAB>reason" for each risky file:
#                                             the path rules, the content rules on the file's staged added lines
#                                             (or its text when nothing is staged), and the map's own entries
#   security-map.sh content                   the content rules on stdin: category<TAB>reason per rule that matches
#   security-map.sh hook                      PostToolUse on Write/Edit/MultiEdit: a written file that matches
#                                             a rule is added to the map, only when the project already has one
#
# No model call; cheap regexes only (a hit is a reason to look, not a finding). Needs jq to write the map;
# match works without it (the map's own entries are then skipped). Never blocks: exit 0 always.

# Path rules: category<TAB>extended regex on the lower-cased repo path<TAB>reason.
PATH_RULES='auth	(^|/)(auth|authn|authz|authentication|authorization|login|logout|signin|signup|session|sessions|oauth|sso|passport|permissions?|acl|rbac|middleware|guards?|giris|oturum|yetki|yetkilendirme)(/|\.|_|-|$)|jwt|password|sifre|şifre|parola|yetki	authentication or access control
crypto	(^|/)[^/]*(crypto|encrypt|decrypt|cipher|signing|signature|hmac)[^/]*$	cryptography
secrets	(^|/)\.env($|\.)|secret|credential|\.pem$|\.key$|\.p12$|keystore|vault	secrets or keys
payments	payment|billing|checkout|invoice|stripe|iyzico|paytr|wallet|refund|payout|subscription|odeme|ödeme|tahsilat|fatura|makbuz|bakiye|doviz|döviz|altin|altın|fiyat|tutar|(^|/|_|-|\.)(kur|kurlar|gram|kasa|cari|parite)(/|_|-|\.|$)	payments or money
migrations	(^|/)(migrations?|migrate|alembic|db/schema)(/|\.)|\.sql$|schema\.prisma$	database schema or data migration
ci	^\.github/workflows/|\.gitlab-ci|(^|/)jenkinsfile$|(^|/)dockerfile|docker-compose|(^|/)\.circleci/	CI or deployment
deps	(^|/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pipfile(\.lock)?|go\.mod|go\.sum|cargo\.toml|cargo\.lock|gemfile(\.lock)?|composer\.(json|lock)|pubspec\.(yaml|lock)|podfile(\.lock)?)$	dependencies'

# Content rules: category<TAB>extended regex (case-insensitive) on code lines<TAB>reason.
CONTENT_RULES='injection	(select|insert|update|delete)[[:space:]].*(\+[[:space:]]*[a-z_]|\$\{|%s|" *%|f["'"'"'][^"'"'"']*\{)|\.(query|execute|raw|exec)\([[:space:]]*[`"'"'"'f].*(\+|\$\{)|child_process|subprocess\.|os\.system|shell[[:space:]]*=[[:space:]]*true|[^a-z_.]eval\(|runtime\.getruntime|dangerouslysetinnerhtml|innerhtml[[:space:]]*=	input may reach a SQL, shell or HTML sink
secrets	(api[_-]?key|secret|token|passw(or)?d|private[_-]?key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}|-----begin [a-z ]*private key	a secret written in code
crypto	md5\(|sha1\(|createcipher\(|des-|ecb|math\.random\(\)	weak or misused crypto
auth	jsonwebtoken|jwt\.(sign|verify|decode)|bcrypt|argon2|verify_?password|is_?admin|has_?role|@login_required|authorize\(|is_?authori[sz]ed|can_?(edit|delete|access|manage)|yetki|sifre|şifre|parola	authentication or access checks
payments	stripe\.|iyzico|paytr|charge\(|refund\(|(amount|price|total|balance|rate|tutar|bakiye|fiyat|toplam|kur|doviz|altin|gram)[a-z_]*[[:space:]]*[-+*/]=?[[:space:]]*[a-z0-9_(]	money handling'

TOP='auth crypto secrets payments migrations injection'

lower() { tr 'A-Z' 'a-z'; }

project_dir() {
  d=${1:-$(pwd)}
  top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && d=$top
  printf '%s' "$d"
}

# path_hits FILE: category<TAB>reason for each path rule the file matches.
path_hits() {
  lp=$(printf '%s' "$1" | lower)
  printf '%s\n' "$PATH_RULES" | while IFS='	' read -r cat re why; do
    [ -n "$cat" ] || continue
    printf '%s' "$lp" | grep -qE -- "$re" && printf '%s\t%s\n' "$cat" "$why"
  done
}

# content_hits: category<TAB>reason for each content rule that stdin matches.
content_hits() {
  text=$(cat)
  [ -n "$text" ] || return 0
  printf '%s\n' "$CONTENT_RULES" | while IFS='	' read -r cat re why; do
    [ -n "$cat" ] || continue
    printf '%s' "$text" | grep -qiE -- "$re" && printf '%s\t%s\n' "$cat" "$why"
  done
}

is_code() {
  case $(printf '%s' "$1" | lower) in
    *.js|*.mjs|*.cjs|*.jsx|*.ts|*.tsx|*.py|*.rb|*.go|*.rs|*.java|*.kt|*.kts|*.swift|*.dart|*.php|*.cs|*.scala|*.sh|*.sql|*.vue|*.svelte|*.ex|*.exs|*.yml|*.yaml|*.tf) return 0 ;;
  esac
  return 1
}

# map_hits PROJECT FILE: the map's hand-written entries for FILE ("manual": true or a "glob"), category<TAB>reason.
# The scanned entries come from the same regexes as path_hits and content_hits, so they would only repeat them.
map_hits() {
  m="$1/.crew-chief/security-map.json"
  [ -f "$m" ] && command -v jq >/dev/null 2>&1 || return 0
  jq -r --arg f "$2" '
    (.entries // [])[]
    | select(.manual == true or (.glob // "") != "")
    | select((.path // "") == $f or ((.glob // "") != "" and ($f | test("^" + (.glob | gsub("[.]"; "\\.") | gsub("[*][*]/?"; "\u0001") | gsub("[*]"; "[^/]*") | gsub("\u0001"; ".*")) + "$"))))
    | "\(.category // "other")\t\(.reason // "listed in the security map")"' "$m" 2>/dev/null
}

cmd_match() {
  proj=$(project_dir "$1")
  shift
  for f in "$@"; do
    rel=${f#"$proj"/}
    {
      path_hits "$rel"
      if is_code "$rel"; then
        added=$(git -C "$proj" diff --cached -U0 -- "$rel" 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+ ')
        if [ -n "$added" ]; then
          printf '%s\n' "$added" | content_hits
        elif [ -f "$proj/$rel" ]; then
          head -c 200000 "$proj/$rel" 2>/dev/null | content_hits
        fi
      fi
      map_hits "$proj" "$rel"
    } | sort -u | while IFS='	' read -r cat why; do
      [ -n "$cat" ] && printf '%s\t%s\t%s\n' "$cat" "$rel" "$why"
    done
  done
}

cmd_scan() {
  command -v jq >/dev/null 2>&1 || return 0
  proj=$(project_dir "$1")
  [ -d "$proj" ] || return 0
  tmp=$(mktemp "${TMPDIR:-/tmp}/crew-chief-secmap.XXXXXX") || return 0
  files=$(git -C "$proj" ls-files 2>/dev/null | head -20000)
  [ -n "$files" ] || files=$(cd "$proj" && find . -type f -not -path './.git/*' -not -path '*/node_modules/*' 2>/dev/null | sed 's#^\./##' | head -20000)
  printf '%s\n' "$files" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    path_hits "$f" | while IFS='	' read -r cat why; do printf '%s\t%s\t%s\n' "$cat" "$f" "$why"; done
  done > "$tmp"
  if git -C "$proj" rev-parse --git-dir >/dev/null 2>&1; then
    printf '%s\n' "$CONTENT_RULES" | while IFS='	' read -r cat re why; do
      [ -n "$cat" ] || continue
      git -C "$proj" grep -l -I -i -E -e "$re" -- '*.js' '*.mjs' '*.cjs' '*.jsx' '*.ts' '*.tsx' '*.py' '*.rb' '*.go' '*.rs' '*.java' '*.kt' '*.swift' '*.dart' '*.php' '*.cs' '*.sh' '*.sql' '*.vue' '*.svelte' ':!*.min.js' ':!*test*' ':!*spec*' 2>/dev/null | head -500 | while IFS= read -r f; do
        printf '%s\t%s\t%s\n' "$cat" "$f" "$why"
      done
    done >> "$tmp"
  fi
  m="$proj/.crew-chief/security-map.json"
  mkdir -p "$proj/.crew-chief" 2>/dev/null || { rm -f "$tmp"; return 0; }
  old='{}'
  [ -f "$m" ] && old=$(cat "$m" 2>/dev/null)
  printf '%s' "$old" | jq -e 'type == "object"' >/dev/null 2>&1 || old='{}'
  sort -u "$tmp" | jq -R -s --argjson old "$old" --arg now "$(date +%Y-%m-%d)" '
    [split("\n")[] | select(length > 0) | split("\t") | {category: .[0], path: .[1], reason: .[2]}] as $found
    | ($old.entries // [] | map(select(.manual == true or (.glob // "") != ""))) as $kept
    | {
        _comment: "crew-chief security risk map: files the commit gate and the security reviewer look at first. Built by scripts/security-map.sh from cheap regexes (a hit is a reason to look, not a finding). Add your own entries with \"manual\": true or a \"glob\"; they are kept on every rescan.",
        version: 1,
        updated: $now,
        entries: ($kept + ($found | group_by(.path) | map({path: .[0].path, category: (map(.category) | unique | join(",")), reason: (map(.reason) | unique | join("; "))})))
      }' > "$m.tmp" 2>/dev/null && mv "$m.tmp" "$m"
  rm -f "$tmp" "$m.tmp"
}

cmd_hook() {
  command -v jq >/dev/null 2>&1 || return 0
  input=$(cat)
  f=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
  [ -n "$f" ] && [ -n "$cwd" ] || return 0
  proj=$(project_dir "$cwd")
  m="$proj/.crew-chief/security-map.json"
  [ -f "$m" ] || return 0
  case "$f" in "$proj"/*) rel=${f#"$proj"/} ;; *) return 0 ;; esac
  case "$rel" in .crew-chief/*|.git/*|*/node_modules/*|node_modules/*) return 0 ;; esac
  jq -e --arg f "$rel" '(.entries // []) | any(.path == $f)' "$m" >/dev/null 2>&1 && return 0
  hits=$( { path_hits "$rel"; is_code "$rel" && head -c 200000 "$f" 2>/dev/null | content_hits; } | sort -u)
  [ -n "$hits" ] || return 0
  printf '%s\n' "$hits" | jq -R -s --arg f "$rel" --slurpfile map "$m" '
    [split("\n")[] | select(length > 0) | split("\t")] as $h
    | $map[0] | .entries = ((.entries // []) + [{path: $f, category: ($h | map(.[0]) | unique | join(",")), reason: ($h | map(.[1]) | unique | join("; ")), added: "on write"}])' > "$m.tmp" 2>/dev/null && mv "$m.tmp" "$m"
  rm -f "$m.tmp"
}

case "$1" in
  scan) shift; cmd_scan "$1" ;;
  match) shift; d=$1; shift; cmd_match "$d" "$@" ;;
  hook) cmd_hook ;;
  top) printf '%s\n' "$TOP" ;;
  content) content_hits ;;
esac
exit 0
