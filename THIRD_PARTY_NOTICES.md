# Third-party notices

crew-chief bundles pinned copies of the agent skills below under `skills/<name>/`. They are not written by the crew-chief author; each keeps its upstream license. crew-chief's own code is MIT (see `LICENSE`). Exact sources, commits and content hashes are in `skills/VENDORED.lock.json`; `python3 tools/vendor_skills.py --check` compares them with upstream.

Names such as Anthropic, Cloudflare, Vercel, Emil Kowalski, OpenDesign and the brand logos theSVG points to are trademarks or names of their owners. No license in this file grants rights to them, and their appearance here does not mean they endorse crew-chief.

## Skills

| Skill | Source | Pinned commit | License |
|---|---|---|---|
| `animate` | [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/animate) | `64eb3de` | MIT |
| `animation-performance` | [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/animation-performance) | `64eb3de` | MIT |
| `choreograph` | [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/choreograph) | `64eb3de` | MIT |
| `design-taste-frontend` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill/tree/3c7017d636c3a4aad378433ea6d0cfa6c921da4a/skills/taste-skill) | `3c7017d` | MIT |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design) | `e4bb5d9` | Apache-2.0 |
| `frontend-ui-engineering` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills/tree/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/frontend-ui-engineering) | `8c99fa3` | MIT |
| `interaction-design` | [wshobson/agents](https://github.com/wshobson/agents/tree/42203085cfc5736204bf0f6d436dff7e1da0bf3f/plugins/ui-design/skills/interaction-design) | `4220308` | MIT |
| `remove-animations` | [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/remove-animations) | `64eb3de` | MIT |
| `security-audit` | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit) | `c1c8a8c` | MIT |
| `thesvg` | [glincker/thesvg](https://github.com/glincker/thesvg/tree/0670ffc8e6e75cd21d6115915175f1859d47b5fb/skills/thesvg) | `0670ffc` | MIT |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/2de1134dc4d1cfe112934611ae5803ae17a1bd7e/.claude/skills/ui-ux-pro-max) | `2de1134` | MIT |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices) | `1a2c79d` | MIT |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines) | `1a2c79d` | MIT |

### `animate`

- Source: https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/animate
- Pinned commit: `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2026 Emil Kowalski
- Changes: Modified (MIT permits it). In `SKILL.md`: removed the "Initial Response" block (the forced greeting "I'm ready to build animations that feel right..." and "Do not provide any other information until the user asks a question") and the "Output" section (a fixed reply shape: gate result, ingredients, feel-check); dropped or reworded pointers to skills not bundled here (`review-animations`, `improve-animations`, `find-animation-opportunities`, `animate-expo`). The guidance and `RECIPES.md` are unchanged. The edits are `patches` in `skills/VENDORED.lock.json`, so `--update` reapplies them.

### `animation-performance`

- Source: https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/animation-performance
- Pinned commit: `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2026 Emil Kowalski
- Changes: Modified (MIT permits it). In `SKILL.md`: removed the "Initial Response" block (the forced greeting "I'm ready to find out why your animation drops frames...") and the report template in "Phase 3: Report" (replaced by one sentence on ordering findings); dropped or reworded pointers to skills not bundled here (`review-animations`, `animate-expo`). The guidance is unchanged. The edits are `patches` in `skills/VENDORED.lock.json`, so `--update` reapplies them.

### `choreograph`

- Source: https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/choreograph
- Pinned commit: `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2026 Emil Kowalski
- Changes: Modified (MIT permits it). In `SKILL.md`: removed the "Initial Response" block (the forced greeting "I'm ready to choreograph your animations...") and the "Required Output Format" section (a fixed three-part reply: timeline table, what does not move, feel check); the workflow step that pointed to it now lists the timeline columns; dropped a pointer to a skill not bundled here (`find-animation-opportunities`). The guidance and `RECIPES.md` are unchanged. The edits are `patches` in `skills/VENDORED.lock.json`, so `--update` reapplies them.

### `design-taste-frontend`

- Source: https://github.com/Leonxlnx/taste-skill/tree/3c7017d636c3a4aad378433ea6d0cfa6c921da4a/skills/taste-skill
- Pinned commit: `3c7017d636c3a4aad378433ea6d0cfa6c921da4a` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2026 Leonxlnx
- Changes: Unmodified. Pinned to the v1 text on purpose; upstream has since been replaced by tasteskill 2.x, which is not vendored.

### `frontend-design`

- Source: https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design
- Pinned commit: `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` (fetched 2026-11-20)
- Also used: https://github.com/nexu-io/open-design/tree/667f19464a920958c78cf1d6336b50e8ce46d747/skills/frontend-design (commit `667f19464a920958c78cf1d6336b50e8ce46d747`, Apache-2.0)
- License: Apache-2.0
- Copyright: Anthropic (the Apache text upstream has no name line; holder inferred). Fork: Copyright 2026 Open Design contributors
- Changes: Modified (Apache-2.0 section 4(b)). SKILL.md has a "Modified by crew-chief" note after the frontmatter and an added closing section with two workflow steps ("Design the real interface", "Build production-grade frontend code") copied from the OpenDesign fork, whose `od:` and `triggers:` frontmatter was not carried over. LICENSE.txt is Anthropic's, unchanged.

### `frontend-ui-engineering`

- Source: https://github.com/addyosmani/agent-skills/tree/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/frontend-ui-engineering
- Pinned commit: `8c99fa36d90068c82d547f7c12a9d67a3e95f4ee` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2025 Addy Osmani
- Changes: Unmodified.

### `interaction-design`

- Source: https://github.com/wshobson/agents/tree/42203085cfc5736204bf0f6d436dff7e1da0bf3f/plugins/ui-design/skills/interaction-design
- Pinned commit: `42203085cfc5736204bf0f6d436dff7e1da0bf3f` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2024 Seth Hobson
- Changes: Unmodified.

### `remove-animations`

- Source: https://github.com/emilkowalski/skills/tree/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/skills/remove-animations
- Pinned commit: `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2026 Emil Kowalski
- Changes: Modified (MIT permits it). In `SKILL.md`: removed the "Initial Response" block (the forced greeting "I'm ready to remove the animations your interface doesn't need...") and the "Required Output Format" section (a fixed three-part report: removed/reduced table, kept list, cleanup verdict); the workflow's report step is now one plain sentence; dropped pointers to skills not bundled here (`find-animation-opportunities`, `improve-animations`, `review-animations`). The guidance is unchanged. The edits are `patches` in `skills/VENDORED.lock.json`, so `--update` reapplies them.

### `security-audit`

- Source: https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit
- Pinned commit: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2025-2026 Cloudflare, Inc.
- Changes: Unmodified. Not vendored: the two `*.test.cjs` upstream test files.

### `thesvg`

- Source: https://github.com/glincker/thesvg/tree/0670ffc8e6e75cd21d6115915175f1859d47b5fb/skills/thesvg
- Pinned commit: `0670ffc8e6e75cd21d6115915175f1859d47b5fb` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2025 thesvg.org
- Changes: Unmodified. Only the skill text; none of the upstream icon files. The icons it points to stay under their own terms (brand logos are their owners' trademarks; some collections carry other licenses).

### `ui-ux-pro-max`

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/2de1134dc4d1cfe112934611ae5803ae17a1bd7e/.claude/skills/ui-ux-pro-max
- Pinned commit: `2de1134dc4d1cfe112934611ae5803ae17a1bd7e` (fetched 2026-11-20)
- License: MIT
- Copyright: Copyright (c) 2024 Next Level Builder
- Changes: Modified. SKILL.md: the script paths `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/` became `${CLAUDE_PLUGIN_ROOT}/skills/ui-ux-pro-max/` so they resolve inside this plugin. Not vendored: `scripts/tests/` (upstream dev tests and fixtures). Everything else is byte-identical.

### `vercel-react-best-practices`

- Source: https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices
- Pinned commit: `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` (fetched 2026-11-20)
- License: MIT
- Copyright: No copyright line upstream; author per the skill's metadata: Vercel
- Changes: Unmodified. No LICENSE file existed upstream at the pinned commit; the license is taken from the skill's frontmatter (`license: MIT`) and the README line "License: MIT". Upstream folder name is `react-best-practices`; it is vendored under the skill's own name.

### `web-design-guidelines`

- Source: https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines
- Pinned commit: `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` (fetched 2026-11-20)
- License: MIT
- Copyright: No copyright line in the skills repo; author per the skill's metadata: Vercel
- Also bundled: `skills/web-design-guidelines/guidelines.md`, a copy of `command.md` from https://github.com/vercel-labs/web-interface-guidelines at commit `4ecfb9fb8d1d3b7009674869b3aaee2f904042e1`. License: MIT (that repo has a LICENSE file), Copyright (c) 2025 Vercel Labs.
- Changes: Modified. `SKILL.md` now reads the bundled `guidelines.md` instead of fetching the rules from raw.githubusercontent.com (main branch, unpinned) at run time, so the skill uses no network. `guidelines.md` is unchanged upstream text, added by hand (`--update --apply` refuses this entry). No LICENSE file exists in vercel-labs/agent-skills at the pinned commit (GitHub reports no license there); the MIT license is taken from its README line "License: MIT".

## MIT License text

Applies to every skill above marked MIT. The upstream license files are the standard MIT text; they differ only in the copyright line, which is listed for each skill above:

```text
MIT License

<copyright line of the skill, see above>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0 text

Applies to `frontend-design` (Anthropic's original and the OpenDesign fork it adapted, both Apache-2.0). The same text is in `skills/frontend-design/LICENSE.txt`. Neither upstream repo has a NOTICE file at its root at the pinned commits.

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```
