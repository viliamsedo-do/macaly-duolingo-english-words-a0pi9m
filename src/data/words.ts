import type { Word } from './words-a'
import { WORDS_A } from './words-a'
import { WORDS_B } from './words-b'

export type { Word }

export const WORDS: Word[] = [...WORDS_A, ...WORDS_B]

export const LESSON_SIZE = 10
export const WORDS_PER_UNIT = 50
export const LESSONS_PER_UNIT = 5
export const TOTAL_LESSONS = Math.ceil(WORDS.length / LESSON_SIZE)

export type UnitInfo = {
  index: number
  label: string
  from: number
  to: number
}

export const UNITS: UnitInfo[] = Array.from({ length: Math.ceil(WORDS.length / WORDS_PER_UNIT) }, (_, i) => ({
  index: i,
  label: `Jednotka ${i + 1}`,
  from: i * WORDS_PER_UNIT + 1,
  to: Math.min((i + 1) * WORDS_PER_UNIT, WORDS.length),
}))

/** Slová pre danú lekciu (lekcie sú číslované globálne 0..99). */
export function wordsForLesson(lesson: number): Word[] {
  return WORDS.slice(lesson * LESSON_SIZE, (lesson + 1) * LESSON_SIZE)
}

/** Slová pre danú lekciu v rámci jednotky. */
export function lessonWordsForUnit(unit: number, lesson: number): Word[] {
  return wordsForLesson(unit * LESSONS_PER_UNIT + lesson)
}

export function lessonKey(unit: number, lesson: number): string {
  return `${unit}-${lesson}`
}

export function unitLessonFromKey(key: string): { unit: number; lesson: number } | null {
  const [u, l] = key.split('-').map(Number)
  if (Number.isNaN(u) || Number.isNaN(l)) return null
  return { unit: u, lesson: l }
}
