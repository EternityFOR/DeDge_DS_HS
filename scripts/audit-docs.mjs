import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirectories = new Set(['.git', '.pnpm-store', '.tmp', 'dist', 'node_modules', 'out', 'output'])
const required = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'PRIVACY.md',
  'SECURITY.md',
  'SUPPORT.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/RELEASING.md',
]

const failures = []
for (const relative of required) {
  if (!existsSync(path.join(root, relative))) failures.push(relative + ': required public document is missing')
}

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseNotes = 'docs/release-notes-' + manifest.version + '.md'
if (!existsSync(path.join(root, releaseNotes))) failures.push(releaseNotes + ': release notes are missing for package version ' + manifest.version)

const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes('## [' + manifest.version + ']')) {
  failures.push('CHANGELOG.md: package version ' + manifest.version + ' has no release heading')
}

const markdownFiles = walk(root).filter(file => file.endsWith('.md'))
for (const file of markdownFiles) {
  const contents = readFileSync(file, 'utf8')
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const raw = match[1].trim()
    if (/^(?:#|https?:|mailto:)/iu.test(raw)) continue
    const target = raw.split('#', 1)[0].replace(/^<|>$/gu, '')
    if (target === '') continue
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target))
    if (!existsSync(resolved)) {
      failures.push(path.relative(root, file).replaceAll('\\', '/') + ': broken local link ' + raw)
    }
  }
}

if (failures.length > 0) {
  console.error('Documentation audit failed:')
  for (const failure of failures) console.error('- ' + failure)
  process.exitCode = 1
} else {
  console.log('Documentation audit passed: ' + markdownFiles.length + ' Markdown files and release version ' + manifest.version + ' checked.')
}

function walk(directory) {
  const files = []
  for (const name of readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue
    const entry = path.join(directory, name)
    if (statSync(entry).isDirectory()) files.push(...walk(entry))
    else files.push(entry)
  }
  return files
}
