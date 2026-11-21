# Night report: <date>, session <sid8>

**Verdict:** <done | partly done | stalled | ended by a limit | ended by error>; stopped at <HH:MM> because <deadline | scope done | limit | stalled | off>.

## Needs you
- <parked question>: options <A> / <B>, recommended <A> because <why>. <"ready to run: `cmd`" when it is a prepared action>

## Done
- <task>: <evidence: command and the last lines of its output>; commits <sha..sha>

## Decided without asking
- <decision>: affects <what>; undo: <how>
- (from the plugin) <guard stop / compaction / saver / auto-answer>: <what happened>

## Not done
- <task>: <why: blocked after 3 attempts / parked at 40% / out of time>, evidence <...>

## How to undo the whole night
`git log <startSha>..HEAD` lists the night's commits; `git reset --hard <startSha>` drops them (only if nothing was pushed).
