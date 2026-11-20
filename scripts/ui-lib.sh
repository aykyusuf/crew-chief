#!/bin/sh
# crew-chief shared helpers for the UI policy (data/ui-policy.json): skill-hint.sh, subagent-start.sh and
# ui-brief-check.sh source this. Sourced, never run. Every function needs jq; callers check for it first.

# ui_policy <plugin root>: the policy as one JSON line, the shipped file with the user's
# ~/.claude/crew-chief-ui.json merged on top (objects key by key, lists and strings replaced).
# The user file is only read. Prints nothing and returns 1 when the shipped file is missing.
ui_policy() {
  _base="$1/data/ui-policy.json"
  _user="${HOME:-/nonexistent}/.claude/crew-chief-ui.json"
  [ -f "$_base" ] || return 1
  if [ -f "$_user" ] && jq -e 'type == "object"' "$_user" >/dev/null 2>&1; then
    jq -c -s '.[0] * .[1]' "$_base" "$_user" 2>/dev/null && return 0
  fi
  jq -c . "$_base" 2>/dev/null
}

# ui_roots <dir>: the directory and its git root (when different), one per line.
ui_roots() {
  printf '%s\n' "$1"
  _top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || _top=""
  [ -n "$_top" ] && [ "$_top" != "$1" ] && printf '%s\n' "$_top"
  return 0
}

# ui_profile_path <dir> <policy json>: the project's profile file, when there is one.
ui_profile_path() {
  _rel=$(printf '%s' "$2" | jq -r '.profileFile // ".crew-chief/ui-profile.json"' 2>/dev/null)
  [ -n "$_rel" ] || _rel=".crew-chief/ui-profile.json"
  ui_roots "$1" | while IFS= read -r _d; do
    if [ -f "$_d/$_rel" ]; then printf '%s\n' "$_d/$_rel"; break; fi
  done
}

# ui_profile_text <profile file> <policy json>: the profile in four short lines, with the policy's
# defaults for fields the file leaves out and the extra skills the profile adds.
ui_profile_text() {
  jq -r --argjson pol "$2" '
    ($pol.aliases // {}) as $al
    | def canon: . as $x | if ($x | type) == "string" then ($al[$x] // $x) else $x end;
    # the policy entry for a canonical id, with a user override filed under an old name merged on top
    def defs($c): reduce (($al | to_entries | map(select(.value == $c) | .key))[] | $pol.profiles[.] // empty) as $o ($pol.profiles[$c] // {}; . * $o);
    ((.profile // "") | canon) as $p
    | defs($p) as $d
    | ("Profile: " + (if $p == "" then "(unnamed)" else $p end)
        + " | motion " + ((.motion // $d.motion // "?") | tostring)
        + " | perf budget: " + (.perfBudget // $d.perfBudget // "none set")),
      ("Extra skills for this profile: " + (($d.skills // []) | if length == 0 then "none" else join(", ") end)),
      (if ($d.rule // "") != "" then "Profile rule: " + $d.rule else empty end),
      (if ((.notes // "") | tostring) != "" then "Notes: " + (.notes | tostring) else empty end),
      ("Reference images: " + ((.refs // []) | if length == 0 then "none recorded" else join(", ") end)),
      (if ((.pages // {}) | type == "object" and length > 0)
        then "Page overrides (a file or route that matches a key uses these instead of the default above; keys are paths or globs): "
          + ([.pages | to_entries[] | .key + " -> " + ([(if .value.profile then "profile " + (.value.profile | canon | tostring) else empty end),
              (if .value.motion != null then "motion " + (.value.motion | tostring) else empty end),
              (if .value.perfBudget then "perf budget: " + (.value.perfBudget | tostring) else empty end),
              (if .value.notes then "notes: " + (.value.notes | tostring) else empty end)] | join(", "))] | join("; "))
          + ". " + ($pol.profileDocs.rule // "")
        else empty end)' "$1" 2>/dev/null
}

# ui_profile_options <policy json>: the three profile choices for the profile question, one per line:
# "<id>: <English label> | <Turkish label>" (the labels are the option texts, shown in the user's language).
ui_profile_options() {
  printf '%s' "$1" | jq -r '[.profiles | to_entries[] | .key + " = \"" + (.value.label.en // .key) + "\" / \"" + (.value.label.tr // .key) + "\""] | join("; ")' 2>/dev/null
}

# ui_main_text <dir> <policy json>: what the main session is told on a UI prompt. Short on purpose, one hard first
# step first; the ban list, polish checklist, motion bands, self-check and scout rules reach the agents through
# scripts/subagent-start.sh, not through this text.
ui_main_text() {
  _pf=$(ui_profile_path "$1" "$2")
  _pfrel=$(printf '%s' "$2" | jq -r '.profileFile // ".crew-chief/ui-profile.json"' 2>/dev/null)
  _opts=$(ui_profile_options "$2")
  _refs=$(printf '%s' "$2" | jq -r '[.reference.choices[] | "\"" + .label.en + "\" / \"" + .label.tr + "\""] | join("; ")' 2>/dev/null)
  _skills=$(printf '%s' "$2" | jq -r '(.base | join(", ")) + ", and for " + .landing.when + " " + (.landing.skills | join(", "))' 2>/dev/null)
  _models=$(ui_models_short "$2")
  if [ -n "$_pf" ]; then
    printf '%s\n' "UI task. STOP before reading or writing project files: $_pf exists, so use it (page overrides win) and do not ask the profile or motion again; ask the reference question (AskUserQuestion) only if it records no refs."
    ui_profile_text "$_pf" "$2" | sed 's/^/  /'
  else
    printf '%s\n' "UI task. STOP before reading or writing project files: ask ONE AskUserQuestion with (a) the UI profile, options exactly these labels in the user's language (id = English / Turkish), no recommended marker: $_opts; (b) motion 0-10; (c) reference: $_refs (find = brief crew-chief:ui-scout sonnet/medium, then show its candidates in one AskUserQuestion, its #1 if the user does not answer; picks go to refs[]). Write the answers to $_pfrel as {profile (the id), motion, perfBudget, notes, refs[]}."
  fi
  printf '%s\n' "Then hand ALL UI code (components, styles, pages, screens, Flutter widgets, SwiftUI views) to crew-chief:ui-implementer (or crew-chief:ui-designer first for 3+ screens, a new site or a redesign); never write UI files yourself, never use implementer or mechanic for UI."
  [ -n "$_models" ] && printf '%s\n' "$_models"
  printf '%s\n' "The brief names: the effective profile and motion band (the pages entry for that page), extra skills to load (the profile's, plus $_skills), reference paths. A UI brief without the profile is denied once."
}

# ui_models_short <policy json>: one compact line of the "models" rules that carry a "short" label, plus the never list.
ui_models_short() {
  printf '%s' "$1" | jq -r '
    select(.models != null) | .models as $m
    | "Pass `model` and `effort` on every UI Agent call: "
      + ([$m.rules | to_entries[] | select(.key | startswith("_") | not) | .value | select(.short != null) | .short + " " + .model + "/" + .effort] | join("; "))
      + ". Never: " + ($m.never | join("; ")) + "."' 2>/dev/null
}

ui_motion_text() {
  printf '%s' "$1" | jq -r '
    select(.motionBands != null) | .motionBands
    | "Motion bands (what the profile'"'"'s motion value means; a value inside a band must deliver that band'"'"'s whole list): "
      + ([.bands[] | .range + " = " + .delivers] | join("; ")) + ". " + .every + " " + .rule' 2>/dev/null
}

ui_selfcheck_text() {
  printf '%s' "$1" | jq -r '
    select(.selfCheck != null) | .selfCheck
    | "Visual self-check before you report done (mandatory): " + (.steps | to_entries | map((.key + 1 | tostring) + ") " + .value) | join(" ")) + " " + .report + " " + .ignore' 2>/dev/null
}

# ui_rules_text <policy json>: the ban list, the logo rule and the polish checklist, as text for an agent.
ui_rules_text() {
  printf '%s' "$1" | jq -r '
    "Banned default look (" + (.bannedDefaults | join("; ")) + "). " + .bannedNote,
    .logos,
    "Polish checklist (" + .polishChecklist.credit + "):",
    (.polishChecklist.items | map("- " + .) | join("\n"))' 2>/dev/null
}

# ui_names_file <text>: succeeds when the text names a UI file (.tsx .jsx .vue .svelte .css .scss .html, a Dart
# file with widget/screen words). skill-hint.sh and ui_is_task share it, so the hint and the Agent gate agree.
# A reference to a crew-chief:ui-* agent is not a UI word.
ui_names_file() {
  _t=$(printf '%s' "$1" | sed -E 's#(crew-chief:)?ui-(smoke|tester|implementer|designer|scout)##g')
  printf '%s' "$_t" | grep -Eiq '\.(tsx|jsx|vue|svelte|css|scss|html)([^A-Za-z0-9]|$)' && return 0
  printf '%s' "$_t" | grep -Eiq '\.dart([^A-Za-z0-9]|$)' && printf '%s' "$_t" | grep -Eiq 'widget|screen|page|layout|theme|button|ekran' && return 0
  return 1
}

# ui_file_path_is_ui <path>: succeeds when the path's extension is a UI file one (.tsx .jsx .vue .svelte .css .scss
# .html .dart). Dart is only a candidate: the Write gate then looks at the content (ui_dart_is_widget).
ui_file_path_is_ui() {
  printf '%s' "$1" | grep -Eiq '\.(tsx|jsx|vue|svelte|css|scss|html|dart)$'
}

# ui_dart_is_widget <text>: succeeds when Dart source looks like a Flutter widget or screen.
ui_dart_is_widget() {
  printf '%s' "$1" | grep -Eq 'package:flutter/(material|widgets|cupertino)|extends[[:space:]]+(StatelessWidget|StatefulWidget|State<|ConsumerWidget|ConsumerStatefulWidget|HookWidget)'
}

# ui_is_task <plugin root> <text> [policy json]: succeeds when the text is a UI task: it names UI files (see
# ui_names_file), SwiftUI, or has one of the UI keywords of the catalog categories marked "uiPolicy". A reference to a
# crew-chief:ui-* agent is not a UI word.
ui_is_task() {
  _text=$(printf '%s' "$2" | sed -E 's#(crew-chief:)?ui-(smoke|tester|implementer|designer|scout)##g')
  ui_names_file "$_text" && return 0
  printf '%s' "$_text" | grep -Eiq '(^|[^A-Za-z0-9])swiftui' && return 0
  [ -f "$1/data/skill-catalog.json" ] || return 1
  printf '%s' "$_text" | jq -R -s -e --slurpfile c "$1/data/skill-catalog.json" '
    def esc: gsub("(?<c>[.*+?^$(){}|\\[\\]\\\\])"; "\\" + .c);
    def lower: gsub("Ç"; "ç") | gsub("Ğ"; "ğ") | gsub("İ"; "i") | gsub("Ö"; "ö") | gsub("Ş"; "ş") | gsub("Ü"; "ü") | ascii_downcase;
    def hit($p): any(.keywords[]?; . as $k | ($k | lower) as $w
      | select(($w | rtrimstr("*")) != "")
      | ($p | test("(?<![[:alnum:]])" + ($w | rtrimstr("*") | esc) + (if ($w | endswith("*")) then "" else "(?![[:alnum:]])" end))));
    (lower) as $p | any($c[0].categories[] | select(.uiPolicy == true); hit($p))' >/dev/null 2>&1
}
