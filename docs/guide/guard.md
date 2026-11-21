# Command guard

A guard that stops or warns before dangerous commands and production ssh calls, in the main session and in subagents.

[← README](../../README.md) · [Türkçe](../rehber/guard.md)

**On after the first interactive session, with default rules.** The first time crew-chief starts in an interactive session (not `-p`, the SDK or the cloud) and `~/.claude/crew-chief-guard.json` does not exist, it writes a default config once and the guard is on from that session: the built-in rules, and an ssh warning on the first contact with any host except localhost, 127.0.0.1, `::1` and `*.local` (nothing is stopped; set `ssh.mode` to `"gate"` and list your production hosts to stop the first attempt). One toast says so. Delete the file and crew-chief will not recreate it; `CREW_CHIEF_GUARD_AUTOSETUP=off` or `CREW_CHIEF_GUARD=off` prevents the first write. A small part of the mod (`hooks/src/guard.js`, rules in `hooks/guard-logic.mjs`) that looks at each Bash, Read, Write and Edit call before it runs, in the main session and in subagents.

**What it does when on.** Three levels:

| Level | What happens | Built-in rules at this level |
|---|---|---|
| `deny` | Never runs. Claude gets the reason, you get a toast | `rm -rf` on `/`, `~`, `$HOME` or a bare `*` (`rm-rf`); writing the guard's own config (`guard-config`, cannot be disabled) |
| `confirm` | The **first attempt** is stopped. Claude gets a short checklist and decides by itself, without asking you and waiting: what exactly runs and where, what can be lost, is there a verified backup or a way back, is the target really the right one, SAFE or RISKY. If SAFE it runs **exactly the same command** again and it passes silently (no toast, no note) within `confirmTtlMinutes` (default 360). A changed command is a new command. A subagent is told to report to its caller when unsure; a read-only agent gets a plain deny | risky `rm -rf` (absolute, home, parent, hidden or wildcard path), `DROP`/`TRUNCATE`, `DELETE`/`UPDATE` without `WHERE`, `git push --force`, `git reset --hard`, history rewrites (`rebase` and the like; `git commit --amend` only when the commit is already on a remote branch, a commit nobody has pulled passes), private key files (`.pem`, `.p12`, `.pfx`, `id_rsa`, `id_ed25519`; a `.pub` is fine) read, written or copied, deploy commands, stopping, restarting or disabling a service, a database client over `ssh` |
| `warn` | Runs, then a notice for you and a line for Claude | `rm -rf` inside the project, reading, editing, `cat` or `git add` of a `.env` file |

Your own rules use the same three levels. Rule ids: `guard-config`, `rm-rf`, `sql-destructive`, `git-force-push`, `git-reset-hard`, `git-push-delete`, `git-branch-delete`, `git-clean`, `git-discard`, `git-rewrite`, `key-write`, `key-read`, `key-access`, `env-write`, `env-read`, `env-stage`, `env-access`, `ssh-db`, `sql-no-where`, `prod-deploy`, `service-control`.

**Claude flags what your config misses, without stopping.** While the guard is on, the first prompt of a session carries one note telling Claude to call the tool `crew_guard_suggest` (`kind`: host, path, command, secret or other; `value`; `reason`) when it meets a production host, a critical path, a secret or a dangerous command the guard does not cover. The tool returns at once and never opens a dialog; the note stays in memory for the session (at most 50, duplicates dropped, a secret keeps only its name, long tokens are hidden). The first one shows a toast. `/crew-guard` (or `/crew-guard status`) shows whether the guard is on and why, rule counts by level, the ssh mode and host count, first contacts made, and how many suggestions there are; `/crew-guard suggestions` lists them with a ready-to-paste JSON piece each (a host for `ssh.prodHosts`, a path or command as a `confirm` rule). It only prints. `/crew-guard off` and `/crew-guard on` are the one exception: they set `"enabled"` in the config and keep everything else (with no file, `on` writes the default and `off` writes `"enabled": false`), refuse a file that is not valid JSON, apply at once, and work only when you type them yourself, never when Claude, a plugin or the SDK runs them.

**The config is yours.** A Write or Edit to `crew-chief-guard.json`, or a Bash command that writes it (`>`, `>>`, `tee`, `sed -i`, `perl -i`, `mv`, `cp` onto it, `rm`, `dd of=`, `python -c`/`node -e` naming it, also inside `bash -c`), is always denied with "the guard configuration can only be changed by the user; propose the change with crew_guard_suggest". Reading it is allowed. This is a speed bump too: a script file, or a path built from variables, still gets through.

**Turning it on or off.** The first interactive session writes the file for you (see above); `/crew-guard off` and `/crew-guard on` switch it. To write your own instead, create `~/.claude/crew-chief-guard.json` with `"enabled": true` (start from [`docs/examples/crew-chief-guard.example.json`](../examples/crew-chief-guard.example.json)), or set `CREW_CHIEF_GUARD=on` for the built-in rules without a file. `CREW_CHIEF_GUARD=off` always wins; the default `auto` follows the file. The file is read once when a session starts (`/clear` and `/resume` read it again). A file that is not valid JSON turns the guard off for that session and says so in one toast. A bad rule is skipped (the reason goes to the debug log); the rest still work.

```json
{
  "enabled": true,
  "rules": [
    { "id": "mdb-write", "level": "deny", "tools": ["Write", "Edit"], "target": "file_path",
      "pattern": "(\\.mdb|\\.accdb|/databases/)", "flags": "i", "unless": "/backup/",
      "text": "write to a branch database path" }
  ],
  "disable": ["prod-deploy"],
  "ssh": { "mode": "gate", "prodHosts": ["prod.example.com", "*.prod.example.com", "deploy@10.0.0.5"],
           "safeRemote": ["pm2 (list|status|logs)( .*)?"], "ttlMinutes": 30 }
}
```

- `rules`: your own rules, at most 100. `level` is `deny` or `warn`; `tools` lists tool names (`"*"` for any); `target` is `command` (the Bash command, the default) or `file_path`; `pattern` and the optional `unless` are JavaScript regular expressions of at most 300 characters; `flags` may use `i`, `m`, `s`, `u`. A deny beats a warning; at the same level your rule is reported before a built-in one.
- `disable`: built-in rule ids to switch off.
- `ssh`: the gate below. `mode` is `off` (default), `warn` or `gate`.

**The ssh gate** (`ssh.mode: "gate"`). For `ssh`, `scp`, `sftp` and `rsync` calls to a host in `prodHosts` (`*` is the only wildcard; case does not matter; `user@host` matches that user only; a `-J`/ProxyJump host counts too). The command is read with a small quote-aware tokenizer: options (`-p`, `-i`, `-l`, `-o`, `-J`), `user@host`, the remote command, `&&`/`;`/`|` inside it, `sudo`, `env`, `timeout`, `bash -c "..."`.
1. **First contact.** The first call that touches a production host in a session, per agent, is held once. Claude is asked to write down what really runs on the server, whether it can lose data, stop or restart a service, change config or expose secrets, and whether a read-only way exists, and to run the identical command again only if it is safe.
2. **Read-only commands pass** after that: `ls`, `cat`, `head`, `tail`, `grep`, `find` (without `-delete`/`-exec`), `df`, `du`, `free`, `uptime`, `ps`, `journalctl` (without `--vacuum`/`--rotate`), `systemctl status`, `docker ps`/`logs`, `git status`/`log`/`diff`, `hostname`, `whoami`, `date`, `stat`, `wc`, also piped together, plus your `safeRemote` patterns (each must match a whole part of the remote command). Reading `.env`, key files or `/etc/shadow` does not count as read-only here.
3. **Anything else is held once per command**; the identical command within `ssh.ttlMinutes` (default: `confirmTtlMinutes`, 360) passes. File copies with `scp`, `sftp` or `rsync`, an `ssh` without a command (an interactive session), and anything the tokenizer cannot resolve (a heredoc, a variable, command substitution, `xargs ssh`, a custom `-F` config, `ProxyCommand`) count as risky.
4. **Read-only agents** (`scanner`, `deep-reader`, `reviewer`, `security-reviewer`, `planner`, `ui-smoke`, `ui-designer`, `ui-scout`) get a plain deny for anything but read-only commands, with no retry.
5. `warn` mode never holds a call; it adds the same reminder after the call. The state is kept in memory for the session and never written.

**Lanes by how costly a mistake is to undo.** The three levels already work as lanes: `warn` is reversible and contained, `confirm` is reversible but wide or costly to redo, `deny` is hard to reverse and does not open whatever the model says. [`docs/examples/crew-chief-guard-lanes.example.json`](../examples/crew-chief-guard-lanes.example.json) is a ready set to merge into your own file (nothing in it is on by default): migrations (`confirm` to apply, `deny` to drop or reset), infrastructure (`confirm` for `terraform apply`/`kubectl apply`, `deny` for `destroy`/namespace deletes), payment API calls that move money, and production `.env` files. The patterns match words in the command text, so adapt them to your tools. Your own guard file is never rewritten.

**Honest limits.** This is a speed bump, not a security boundary. It reads command text. A script copied to the server and run, a variable, an ssh config alias that is not listed as written, another tool (an MCP server, Python's paramiko), a mode without hooks, or a model that decides not to call the tool all get past it, and nothing here protects you from instructions hidden in what a server prints back. A retry after a hold only shows that the model was asked to think once. The rules match words, so a commit message or a heredoc that only mentions a blocked command is held too; `disable` turns such a rule off. What protects a server is on the server: a forced command in `authorized_keys` (`command="...",restrict`, with `SSH_ORIGINAL_COMMAND` checked against an allowlist), a restricted account for the agent, a read-only database user, and backups you have restored at least once.

**How it differs from the read-only guard.** `scripts/readonly-guard.sh` is always on and only for crew-chief's read-only agents: it blocks every write (files, git, installs) they try. The command guard is opt-in, for every agent and the main session, and only about dangerous commands and production hosts. Read-only agents keep their own guard; the ssh gate only adds the remote-command check for them.

**Moving from a personal guard mod.** If you have your own mod with rules like these (a "prod-guard"), put its personal rules into `rules` (the example file reproduces such a mod: branch databases, license keys and a "never open a branch" rule), turn this guard on, then remove or disable your own mod. With both on, each warning and block appears twice.
