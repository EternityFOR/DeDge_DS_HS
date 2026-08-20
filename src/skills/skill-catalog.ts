import { Buffer } from 'node:buffer'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'

export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly directory: string
}

const SKILL_MAX_BODY_BYTES = 65_536

export function expandUserHome(value: string): string {
  const home = homedir()
  return value.replace(/$\{userHome\}/gu, home).replace(/^~(?=\\|\/|$)/u, home)
}

export async function listSkills(directories: readonly string[]): Promise<SkillSummary[]> {
  const output: SkillSummary[] = []
  for (const raw of directories) {
    const root = expandUserHome(raw.trim())
    if (root === '') continue
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const directory = path.join(root, entry.name)
      let raw
      try {
        raw = await readFile(path.join(directory, 'SKILL.md'), 'utf8')
      } catch {
        continue
      }
      output.push({
        name: entry.name,
        description: parseDescription(raw),
        directory,
      })
    }
  }
  return output.sort((left, right) => left.name.localeCompare(right.name))
}

export async function readSkillBody(directory: string): Promise<{ text: string; truncated: boolean }> {
  const raw = await readFile(path.join(directory, 'SKILL.md'), 'utf8')
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes <= SKILL_MAX_BODY_BYTES) return { text: raw, truncated: false }
  let end = SKILL_MAX_BODY_BYTES
  const buffer = Buffer.from(raw, 'utf8')
  while (end > 0 && (buffer[end] ?? 0) >> 6 === 0b10) end--
  return { text: `${buffer.subarray(0, end).toString('utf8')}\n[skill body truncated]`, truncated: true }
}

export function parseSkillRefs(value: string): string[] {
  const refs = new Set<string>()
  for (const match of value.matchAll(/\B@([a-z0-9][a-z0-9-]*)/gu)) {
    const name = match[1]
    if (name !== undefined && name.length > 0 && name.length <= 128) refs.add(name)
  }
  return [...refs]
}

function parseDescription(raw: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw)
  if (match === null) return ''
  const block = match[1]
  if (block === undefined) return ''
  const description = /(?:^|\n)\s*description\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\n#]*))(?=\n|$)/u.exec(block)
  const value = description?.[1] ?? description?.[2] ?? description?.[3]
  return value?.trim() ?? ''
}
