import type { PendingQuestion, QuestionAnswer } from './types.js'

export function validateQuestionAnswers(
  questions: readonly PendingQuestion[],
  answers: readonly QuestionAnswer[],
): QuestionAnswer[] {
  const byId = new Map<string, QuestionAnswer>()
  for (const answer of answers) {
    if (byId.has(answer.id)) throw new Error(`Question ${answer.id} was answered more than once.`)
    byId.set(answer.id, answer)
  }
  if (byId.size !== questions.length) throw new Error('Every question in the batch must be represented before submitting.')

  return questions.map(question => {
    const answer = byId.get(question.id)
    if (answer === undefined) throw new Error(`Question ${question.id} has no answer entry.`)
    const selected = [...answer.selected]
    if (new Set(selected).size !== selected.length) throw new Error(`Question ${question.id} contains a duplicate option.`)
    if (!question.multiSelect && selected.length > 1) throw new Error(`Question ${question.id} accepts one option.`)
    const labels = new Set(question.options.map(option => option.label))
    if (selected.some(label => !labels.has(label))) throw new Error(`Question ${question.id} contains an unknown option.`)
    const custom = answer.custom?.trim()
    if (!question.multiSelect && selected.length > 0 && custom !== undefined && custom !== '') {
      throw new Error(`Question ${question.id} accepts either an option or a custom answer, not both.`)
    }
    return {
      id: question.id,
      selected,
      ...(custom === undefined || custom === '' ? {} : { custom }),
    }
  })
}
