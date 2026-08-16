import { describe, expect, it } from 'vitest'
import { validateQuestionAnswers } from '../src/session/question-answers.js'
import type { PendingQuestion } from '../src/session/types.js'

const questions: readonly PendingQuestion[] = [
  {
    id: 'mode',
    rpcId: 'rpc-1',
    sessionId: 'session-1',
    question: 'Mode?',
    options: [{ label: 'Fast' }, { label: 'Safe' }],
    multiSelect: false,
  },
  {
    id: 'targets',
    rpcId: 'rpc-1',
    sessionId: 'session-1',
    question: 'Targets?',
    options: [{ label: 'Code' }, { label: 'Docs' }],
    multiSelect: true,
  },
  {
    id: 'notes',
    rpcId: 'rpc-1',
    sessionId: 'session-1',
    question: 'Notes?',
    options: [],
    multiSelect: false,
  },
]

describe('question answer batches', () => {
  it('restores upstream order and supports choices, custom text and skipped questions', () => {
    expect(validateQuestionAnswers(questions, [
      { id: 'notes', selected: [] },
      { id: 'targets', selected: ['Code', 'Docs'], custom: ' release notes ' },
      { id: 'mode', selected: ['Safe'] },
    ])).toEqual([
      { id: 'mode', selected: ['Safe'] },
      { id: 'targets', selected: ['Code', 'Docs'], custom: 'release notes' },
      { id: 'notes', selected: [] },
    ])
  })

  it('rejects incomplete, duplicate and unknown selections', () => {
    expect(() => validateQuestionAnswers(questions, [{ id: 'mode', selected: [] }])).toThrow('must be represented')
    expect(() => validateQuestionAnswers(questions, [
      { id: 'mode', selected: ['Fast', 'Fast'] },
      { id: 'targets', selected: [] },
      { id: 'notes', selected: [] },
    ])).toThrow('duplicate option')
    expect(() => validateQuestionAnswers(questions, [
      { id: 'mode', selected: ['Missing'] },
      { id: 'targets', selected: [] },
      { id: 'notes', selected: [] },
    ])).toThrow('unknown option')
  })

  it('enforces single-select rules while allowing multi-select custom text', () => {
    expect(() => validateQuestionAnswers(questions, [
      { id: 'mode', selected: ['Fast'], custom: 'other' },
      { id: 'targets', selected: [] },
      { id: 'notes', selected: [] },
    ])).toThrow('either an option or a custom answer')
    expect(() => validateQuestionAnswers(questions, [
      { id: 'mode', selected: ['Fast', 'Safe'] },
      { id: 'targets', selected: [] },
      { id: 'notes', selected: [] },
    ])).toThrow('accepts one option')
  })
})
