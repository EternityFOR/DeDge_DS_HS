import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const binaryExtensions = new Set(['.ico', '.jpg', '.jpeg', '.png', '.woff', '.woff2', '.zip'])
const forbiddenPaths = [
  /(^|\/)\.env(?:\.|$)/iu,
  /(^|\/)(?:auth|credentials?|secrets?)\.json$/iu,
  /\.(?:jsonl|kdbx|key|p12|pem|pfx)$/iu,
  /(^|\/)(?:id_ed25519|id_rsa)$/iu,
]
const contentRules = [
  ['private key', /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u],
  ['GitHub token', /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/u],
  ['provider-style secret', /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['credential in URL', /https?:\/\/[^\s/:]+:[^\s/@]+@(?!example\.(?:com|net|org)(?:[/:]|$)|[^/\s]+\.invalid(?:[/:]|$))/iu],
  ['Unicode replacement character', /\uFFFD/u],
  ['probable UTF-8 mojibake', /(?:\u00c3.|\u00c2.|\u00e2(?:\u20ac|\u2122|\u0153|\u009d))/u],
]

const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
}).split('\0').filter(Boolean).sort()

const failures = []
const localNeedles = [...new Set([homedir(), process.env.USERPROFILE, root, path.dirname(root)].filter(Boolean))]
for (const relative of candidates) {
  const normalized = relative.replaceAll('\\', '/')
  if (forbiddenPaths.some(pattern => pattern.test(normalized))) {
    failures.push(`${normalized}: forbidden private/runtime file type`)
    continue
  }
  if (binaryExtensions.has(path.extname(normalized).toLowerCase())) continue

  const absolute = path.resolve(root, relative)
  const content = readFileSync(absolute)
  if (content.includes(0)) continue
  const text = content.toString('utf8')
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(text)) failures.push(`${normalized}: ${rule}`)
  }
  for (const needle of localNeedles) {
    if (text.toLowerCase().includes(String(needle).toLowerCase())) {
      failures.push(`${normalized}: machine-local absolute path`)
      break
    }
  }
}

const packageManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const repositoryUrl = packageManifest.repository?.url
if (typeof repositoryUrl !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/u.test(repositoryUrl)) {
  failures.push('package.json: missing canonical HTTPS GitHub repository URL')
}
if (packageManifest.license !== 'MIT') failures.push('package.json: unexpected license')

if (failures.length > 0) {
  console.error('Release safety audit failed. Matched values are intentionally hidden:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Release safety audit passed: ${candidates.length} public source candidates checked; no secrets, session dumps, personal paths, or mojibake markers found.`)
}
