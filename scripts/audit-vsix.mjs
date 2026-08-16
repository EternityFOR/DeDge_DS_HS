import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const NODE_LICENSE_SHA256 = 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4'
const MAX_ARCHIVE_BYTES = 90 * 1024 ** 2
const MAX_UNPACKED_BYTES = 256 * 1024 ** 2
const MAX_FILES = 15_000

export function auditVsix(file, target) {
  const archive = readFileSync(file)
  const entries = readCentralDirectory(archive)
  const entryByName = new Map(entries.map(entry => [entry.name, entry]))
  const names = new Set(entryByName.keys())
  if (names.size !== entries.length) throw new Error('VSIX contains duplicate archive paths.')

  const caseFolded = new Map()
  for (const name of names) {
    if (name.startsWith('/') || /^[A-Za-z]:/u.test(name) || name.split('/').includes('..')) {
      throw new Error(`VSIX contains an unsafe archive path: ${name}`)
    }
    const folded = name.toLowerCase()
    const previous = caseFolded.get(folded)
    if (previous !== undefined && previous !== name) throw new Error(`VSIX contains case-conflicting paths: ${previous} and ${name}`)
    caseFolded.set(folded, name)
  }

  const executable = target.startsWith('win32-') ? 'node.exe' : 'node'
  const ripgrep = target.startsWith('win32-') ? 'rg.exe' : 'rg'
  const required = [
    'extension/package.json',
    'extension/readme.md',
    'extension/changelog.md',
    'extension/LICENSE.txt',
    'extension/THIRD_PARTY_NOTICES.md',
    'extension/PRIVACY.md',
    'extension/SECURITY.md',
    'extension/SUPPORT.md',
    'extension/licenses/NODEJS-LICENSE.txt',
    'extension/dist/extension.cjs',
    'extension/dist/webview.js',
    'extension/dist/runtime-manifest.json',
    `extension/dist/runtime/node_modules/node/bin/${executable}`,
    'extension/dist/runtime/node_modules/node/LICENSE',
    'extension/dist/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    'extension/dist/runtime/node_modules/@deepseek-ai/dsh/LICENSE',
    'extension/dist/runtime/node_modules/pnpm/bin/pnpm.mjs',
    'extension/dist/runtime/node_modules/pnpm/LICENSE',
    `extension/dist/runtime/node_modules/@vscode/ripgrep-${target}/bin/${ripgrep}`,
  ]
  for (const name of required) {
    if (!names.has(name)) throw new Error(`VSIX is missing required file: ${name}`)
  }

  const nativePty = target.startsWith('linux-')
    ? 'extension/dist/runtime/node_modules/node-pty/build/Release/pty.node'
    : `extension/dist/runtime/node_modules/node-pty/prebuilds/${target}/pty.node`
  if (!names.has(nativePty)) throw new Error(`VSIX is missing the ${target} node-pty binary: ${nativePty}`)
  if (target.startsWith('win32-')) {
    for (const relative of [
      'conpty.node',
      'conpty_console_list.node',
      'pty.node',
      'winpty-agent.exe',
      'winpty.dll',
      'conpty/conpty.dll',
      'conpty/OpenConsole.exe',
    ]) {
      const native = `extension/dist/runtime/node_modules/node-pty/prebuilds/${target}/${relative}`
      if (!names.has(native)) throw new Error(`VSIX is missing the ${target} node-pty file: ${native}`)
    }
  } else if (target.startsWith('darwin-')) {
    const helper = `extension/dist/runtime/node_modules/node-pty/prebuilds/${target}/spawn-helper`
    if (!names.has(helper)) throw new Error(`VSIX is missing the ${target} node-pty helper: ${helper}`)
  }

  const forbiddenPrefixes = [
    'extension/.tmp/',
    'extension/.pnpm-store/',
    'extension/docs/',
    'extension/out/',
    'extension/scripts/',
    'extension/src/',
    'extension/test/',
    'extension/dist/runtime/node_modules/.bin/',
  ]
  const forbiddenFiles = new Set([
    'extension/.gitignore',
    'extension/.vscodeignore',
    'extension/esbuild.mjs',
    'extension/pnpm-lock.yaml',
    'extension/pnpm-workspace.yaml',
    'extension/tsconfig.json',
    'extension/vitest.config.ts',
  ])
  for (const name of names) {
    if (forbiddenFiles.has(name) || forbiddenPrefixes.some(prefix => name.startsWith(prefix))
      || name.includes('/node_modules/.bin/')) {
      throw new Error(`VSIX contains a development-only file: ${name}`)
    }
    const match = /node-pty\/prebuilds\/(win32|darwin)-[^/]+\//u.exec(name)
    if (match !== null && !name.includes(`/prebuilds/${target}/`)) {
      throw new Error(`VSIX contains node-pty binaries for another platform: ${name}`)
    }
    if (name.includes('/node_modules/pnpm/artifacts/')
      || name.includes('/node_modules/node-pty/deps/')
      || name.includes('/node_modules/node-pty/scripts/')
      || name.includes('/node_modules/node-pty/src/')
      || name.includes('/node_modules/node-pty/third_party/')
      || name.includes('/node_modules/node-pty/typings/')
      || name.includes('/.github/')
      || name.includes('/.yarn/')) {
      throw new Error(`VSIX contains removable package metadata or source: ${name}`)
    }
    assertNativePackageTarget(name, target)
  }

  const unpackedBytes = entries.reduce((total, entry) => total + entry.unpackedBytes, 0)
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error(`VSIX exceeds the ${formatBytes(MAX_ARCHIVE_BYTES)} compressed budget: ${formatBytes(archive.length)}`)
  if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error(`VSIX exceeds the ${formatBytes(MAX_UNPACKED_BYTES)} unpacked budget: ${formatBytes(unpackedBytes)}`)
  if (entries.length > MAX_FILES) throw new Error(`VSIX exceeds the ${MAX_FILES} file budget: ${entries.length}`)

  const packageManifest = JSON.parse(readText(archive, requiredEntry(entryByName, 'extension/package.json')))
  const runtimeManifest = JSON.parse(readText(archive, requiredEntry(entryByName, 'extension/dist/runtime-manifest.json')))
  auditExtensionText(archive, entries)
  const [platform, arch] = target.split('-')
  if (runtimeManifest.extension !== packageManifest.version
    || runtimeManifest.platform !== platform
    || runtimeManifest.arch !== arch
    || runtimeManifest.dsh !== packageManifest.dependencies?.['@deepseek-ai/dsh']
    || runtimeManifest.node !== `v${packageManifest.dependencies?.node}`
    || runtimeManifest.pnpm !== packageManifest.dependencies?.pnpm) {
    throw new Error('VSIX runtime manifest does not match package.json or the requested target.')
  }
  const vsixManifest = readText(archive, requiredEntry(entryByName, 'extension.vsixmanifest'))
  if (!vsixManifest.includes(`TargetPlatform="${target}"`)
    || !vsixManifest.includes(`Version="${packageManifest.version}"`)) {
    throw new Error('VSIX manifest target or extension version does not match package.json.')
  }

  for (const license of ['extension/licenses/NODEJS-LICENSE.txt', 'extension/dist/runtime/node_modules/node/LICENSE']) {
    const hash = sha256(readEntry(archive, requiredEntry(entryByName, license)))
    if (hash !== NODE_LICENSE_SHA256) throw new Error(`VSIX contains an unexpected Node.js license payload: ${license}`)
  }
  assertNoLargeDuplicates(archive, entries)
  if (!target.startsWith('win32-')) {
    const executableNames = [
      `extension/dist/runtime/node_modules/node/bin/${executable}`,
      `extension/dist/runtime/node_modules/@vscode/ripgrep-${target}/bin/${ripgrep}`,
    ]
    if (target.startsWith('darwin-')) executableNames.push(`extension/dist/runtime/node_modules/node-pty/prebuilds/${target}/spawn-helper`)
    for (const executableName of executableNames) assertExecutable(requiredEntry(entryByName, executableName))
  }
  console.log(`Audited ${path.basename(file)}: ${entries.length} files, ${formatBytes(archive.length)} compressed, ${formatBytes(unpackedBytes)} unpacked`)
}

function auditExtensionText(archive, entries) {
  const personalNeedles = [...new Set([homedir(), process.cwd()].filter(Boolean))]
  const rules = [
    ['private key', /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u],
    ['GitHub token', /(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/u],
    ['provider-style secret', /\bsk-[A-Za-z0-9_-]{20,}\b/u],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
    ['credential in URL', /https?:\/\/[^\s/:]+:[^\s/@]+@(?!example\.(?:com|net|org)(?:[/:]|$)|[^/\s]+\.invalid(?:[/:]|$))/iu],
    ['Unicode replacement character', /\uFFFD/u],
  ]
  for (const entry of entries) {
    if (!entry.name.startsWith('extension/')) continue
    if (entry.name.includes('/node_modules/')) continue
    if (!/\.(?:cjs|js|json|md|svg|txt|yml|yaml)$/iu.test(entry.name)) continue
    const value = readEntry(archive, entry)
    if (value.includes(0)) continue
    const text = value.toString('utf8')
    for (const [rule, pattern] of rules) {
      if (pattern.test(text)) throw new Error(`VSIX extension text contains ${rule}: ${entry.name}`)
    }
    for (const needle of personalNeedles) {
      if (text.toLowerCase().includes(String(needle).toLowerCase())) {
        throw new Error(`VSIX extension text contains a machine-local path: ${entry.name}`)
      }
    }
  }
}

function assertNativePackageTarget(name, target) {
  const packages = [
    ['extension/dist/runtime/node_modules/@vscode/ripgrep-', '/'],
    ['extension/dist/runtime/node_modules/@koromix/koffi-', '/'],
    ['extension/dist/runtime/node_modules/@img/sharp-', '/'],
    ['extension/dist/runtime/node_modules/@img/sharp-libvips-', '/'],
    ['extension/dist/runtime/node_modules/node-addon-require-builtin-', '/'],
  ]
  for (const [prefix, suffix] of packages) {
    if (!name.startsWith(prefix)) continue
    const packageName = name.slice(prefix.length).split(suffix)[0]
    if (packageName === undefined || (!packageName.startsWith(target) && !packageName.includes(`-${target}`))) {
      throw new Error(`VSIX contains a native package for another target: ${name}`)
    }
  }
}

function assertNoLargeDuplicates(archive, entries) {
  const hashes = new Map()
  for (const entry of entries) {
    if (entry.unpackedBytes < 1024 ** 2 || entry.name.endsWith('/')) continue
    const hash = sha256(readEntry(archive, entry))
    const previous = hashes.get(hash)
    if (previous !== undefined) throw new Error(`VSIX contains duplicate large files: ${previous} and ${entry.name}`)
    hashes.set(hash, entry.name)
  }
}

function assertExecutable(entry) {
  if ((entry.unixMode & 0o111) === 0) throw new Error(`VSIX executable bit is missing: ${entry.name}`)
}

function requiredEntry(entries, name) {
  const entry = entries.get(name)
  if (entry === undefined) throw new Error(`VSIX is missing required file: ${name}`)
  return entry
}

function readCentralDirectory(archive) {
  const minimum = Math.max(0, archive.length - 65_557)
  let eocd = -1
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE
      && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('VSIX end-of-central-directory record was not found.')
  const count = archive.readUInt16LE(eocd + 10)
  if (count === 0xffff) throw new Error('ZIP64 VSIX archives are not supported by this audit.')
  let offset = archive.readUInt32LE(eocd + 16)
  const entries = []
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`Malformed VSIX central directory at entry ${index}.`)
    }
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    entries.push({
      name: archive.toString('utf8', nameStart, nameEnd).replaceAll('\\', '/'),
      flags: archive.readUInt16LE(offset + 8),
      compression: archive.readUInt16LE(offset + 10),
      compressedBytes: archive.readUInt32LE(offset + 20),
      unpackedBytes: archive.readUInt32LE(offset + 24),
      unixMode: archive.readUInt32LE(offset + 38) >>> 16,
      localOffset: archive.readUInt32LE(offset + 42),
    })
    offset = nameEnd + extraLength + commentLength
  }
  return entries
}

function readEntry(archive, entry) {
  const offset = entry.localOffset
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new Error(`Malformed VSIX local entry: ${entry.name}`)
  }
  const nameLength = archive.readUInt16LE(offset + 26)
  const extraLength = archive.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  if ((entry.flags & 1) !== 0) throw new Error(`Encrypted VSIX entries are not supported: ${entry.name}`)
  if (dataStart + entry.compressedBytes > archive.length) throw new Error(`Truncated VSIX entry: ${entry.name}`)
  const compressed = archive.subarray(dataStart, dataStart + entry.compressedBytes)
  const value = entry.compression === 0
    ? compressed
    : entry.compression === 8
      ? inflateRawSync(compressed)
      : undefined
  if (value === undefined) throw new Error(`Unsupported ZIP compression method ${entry.compression} for ${entry.name}`)
  if (value.length !== entry.unpackedBytes) throw new Error(`VSIX entry size mismatch: ${entry.name}`)
  return value
}

function readText(archive, entry) {
  return readEntry(archive, entry).toString('utf8')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

const invokedPath = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const target = process.argv[3] ?? `${process.platform}-${process.arch}`
  const manifest = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'))
  const file = process.argv[2] ?? path.resolve('out', `${manifest.name}-${manifest.version}-${target}.vsix`)
  auditVsix(file, target)
}
