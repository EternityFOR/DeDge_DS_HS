# Third-Party Notices

DeDge DeepSeek Harness for VS Code is distributed under the MIT License. The platform VSIX contains code or binaries from the following pinned direct components, whether bundled into `dist` or retained as runtime files:

| Component | Version | License | Project |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh` | `0.1.0-rc.6` | MIT | <https://github.com/deepseek-ai/deepseek-harness> |
| `dompurify` | `3.2.6` | MPL-2.0 OR Apache-2.0 | <https://github.com/cure53/DOMPurify> |
| `lucide` | `0.468.0` | ISC | <https://github.com/lucide-icons/lucide> |
| `marked` | `15.0.7` | MIT | <https://github.com/markedjs/marked> |
| `node` | `22.22.3` | MIT package; Node.js includes additional notices | <https://github.com/aredridel/node-bin-gen> |
| `pnpm` | `11.21.0` | MIT | <https://github.com/pnpm/pnpm> |
| `ws` | `8.18.3` | MIT | <https://github.com/websockets/ws> |

The complete license texts and copyright notices supplied by these packages and their transitive dependencies remain in their respective packaged directories. The Node.js `v22.22.3` license and bundled third-party notices are pinned at `licenses/NODEJS-LICENSE.txt` and copied beside every distributed Node binary as `dist/runtime/node_modules/node/LICENSE`.

The dependency list is tied to `pnpm-lock.yaml`. Release packaging must fail review if a production dependency changes without updating this file and confirming that the VSIX retains all required license files. This notice is informational and does not replace the license terms shipped by each rights holder.

The repositories listed in `docs/references.md` are research references and are not packaged. In particular, OpenAI Codex is Apache-2.0 licensed, while the referenced Claude Code repository uses Anthropic's stated commercial terms; no Claude Code source or assets are included in this project.
