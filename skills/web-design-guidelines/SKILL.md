---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the bundled guidelines file `guidelines.md` (next to this SKILL.md; no network needed)
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in `guidelines.md`
4. Output findings in the terse `file:line` format

## Guidelines Source

The rules and output format are in `guidelines.md` in this skill's folder, a pinned copy of `command.md` from vercel-labs/web-interface-guidelines (see THIRD_PARTY_NOTICES.md). Read it before each review. Do not fetch anything from the network.

## Usage

When a user provides a file or pattern argument:
1. Read `guidelines.md`
2. Read the specified files
3. Apply all rules from `guidelines.md`
4. Output findings using the format specified in `guidelines.md`

If no files specified, ask the user which files to review.
