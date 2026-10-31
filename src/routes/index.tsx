import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { canonicalUrl } from '../lib/canonical-url'
import siteMetadata from '../metadata.json'
import {
  WORDS,
  UNITS,
  LESSONS_PER_UNIT,
  LESSON_SIZE,
  TOTAL_LESSONS,
  lessonWordsForUnit,
  wordsForLesson,
  type Word,
} from '../data/words'

const homepageMeta = siteMetadata['/']

export const Route = createFileRoute('/')({
  head: () => {
    const canonical = canonicalUrl('/')

    return {
      meta: [
        { title: homepageMeta.title },
        { name: 'description', content: homepageMeta.description },
      ],
      links: canonical ? [{ rel: 'canonical', href: canonical }] : [],
    }
  },
  component: App,
})

/* ===== Typy a helpers ===== */

type Progress = { xp: number; streak: number; lastDay: string; done: string[] }

type Question =
  | { kind: 'en-sk' | 'sk-en'; word: Word; options: string[]; answer: string }
  | { kind: 'type-en'; word: Word; answer: string }

type Session = {
  unit: number
  lesson: number
  practice: boolean
  title: string
  questions: Question[]
  idx: number
  hearts: number
  correct: number
  phase: 'question' | 'feedback'
  chosen: string | null
  typed: string
  lastCorrect: boolean
}

type Result = {
  status: 'pass' | 'fail'
  xp: number
  correct: number
  total: number
  retry: { unit: number; lesson: number; practice: boolean } | null
}

const STORE_KEY = 'slovicka1000:v1'
const MAX_HEARTS = 5
const emptyProgress: Progress = { xp: 0, streak: 0, lastDay: '', done: [] }

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.done)) {
        return { ...emptyProgress, ...parsed }
      }
    }
  } catch {
    /* ignore */
  }
  return emptyProgress
}

function saveProgress(p: Progress) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayKey(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildQuestions(words: Word[]): Question[] {
  return words.map((word) => {
    const base = WORDS.indexOf(word)
    const pool = WORDS.slice(Math.max(0, base - 30), base + 30).filter((w) => w.en !== word.en)
    const r = Math.random()
    if (r < 0.35) return mkChoice('en-sk', word, pool)
    if (r < 0.7) return mkChoice('sk-en', word, pool)
    return { kind: 'type-en', word, answer: word.en.toLowerCase() }
  })
}

function mkChoice(kind: 'en-sk' | 'sk-en', word: Word, pool: Word[]): Question {
  const key: 'en' | 'sk' = kind === 'en-sk' ? 'sk' : 'en'
  const vals = new Set<string>()
  const src = pool.length >= 3 ? pool : WORDS
  while (vals.size < 3) {
    const w = src[Math.floor(Math.random() * src.length)]
    if (w.en !== word.en) vals.add(w[key])
  }
  return { kind, word, options: shuffle([word[key], ...vals]), answer: word[key] }
}

function isCorrectAnswer(s: Session): boolean {
  const q = s.questions[s.idx]
  if (q.kind === 'type-en') return norm(s.typed) === q.answer
  return s.chosen === q.answer
}

/* ===== Aplikácia ===== */

function App() {
  const [mounted, setMounted] = useState(false)
  const [progress, setProgress] = useState<Progress>(emptyProgress)
  const [session, setSession] = useState<Session | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    setProgress(loadProgress())
    setMounted(true)
  }, [])

  const persist = useCallback((p: Progress) => {
    setProgress(p)
    saveProgress(p)
  }, [])

  const doneFlat = new Set(
    progress.done
      .map((k) => {
        const [u, l] = k.split('-').map(Number)
        if (Number.isNaN(u) || Number.isNaN(l)) return -1
        return u * LESSONS_PER_UNIT + l
      })
      .filter((n) => n >= 0),
  )
  const maxDoneFlat = doneFlat.size ? Math.max(...doneFlat) : -1
  const learnedWords = doneFlat.size * LESSON_SIZE
  const nextLessonFlat = Math.min(maxDoneFlat + 1, TOTAL_LESSONS - 1)

  const startLesson = useCallback((unit: number, lesson: number) => {
    setResult(null)
    setSession({
      unit,
      lesson,
      practice: false,
      title: `Jednotka ${unit + 1} · Lekcia ${lesson + 1}`,
      questions: buildQuestions(lessonWordsForUnit(unit, lesson)),
      idx: 0,
      hearts: MAX_HEARTS,
      correct: 0,
      phase: 'question',
      chosen: null,
      typed: '',
      lastCorrect: false,
    })
    window.scrollTo({ top: 0 })
  }, [])

  const startPractice = useCallback(() => {
    const words = shuffle([...doneFlat].sort((a, b) => a - b).flatMap((f) => wordsForLesson(f)))
    if (!words.length) return
    setResult(null)
    setSession({
      unit: 0,
      lesson: 0,
      practice: true,
      title: 'Tréning opakovania',
      questions: buildQuestions(words.slice(0, LESSON_SIZE)),
      idx: 0,
      hearts: MAX_HEARTS,
      correct: 0,
      phase: 'question',
      chosen: null,
      typed: '',
      lastCorrect: false,
    })
    window.scrollTo({ top: 0 })
  }, [doneFlat])

  const exitToHome = useCallback(() => {
    setSession(null)
    setResult(null)
  }, [])

  const finishLesson = useCallback(
    (s: Session, failed: boolean) => {
      if (!failed) {
        const key = s.practice ? null : `${s.unit}-${s.lesson}`
        let p: Progress = {
          ...progress,
          xp: progress.xp + 10 + s.hearts * 2,
          done: key && !progress.done.includes(key) ? [...progress.done, key] : progress.done,
        }
        if (p.lastDay !== todayKey()) {
          p = {
            ...p,
            streak: p.lastDay === yesterdayKey() ? p.streak + 1 : 1,
            lastDay: todayKey(),
          }
        }
        persist(p)
      }
      setResult({
        status: failed ? 'fail' : 'pass',
        xp: failed ? 0 : 10 + s.hearts * 2,
        correct: s.correct,
        total: s.questions.length,
        retry: { unit: s.unit, lesson: s.lesson, practice: s.practice },
      })
      setSession(null)
    },
    [persist, progress],
  )

  if (session) {
    return (
      <LessonView
        session={session}
        setSession={setSession}
        onExit={exitToHome}
        onFinish={finishLesson}
      />
    )
  }

  if (result) {
    return (
      <ResultView
        result={result}
        onRetry={() => {
          if (!result.retry) return
          if (result.retry.practice) startPractice()
          else startLesson(result.retry.unit, result.retry.lesson)
        }}
        onContinue={exitToHome}
      />
    )
  }

  return (
    <HomeView
      mounted={mounted}
      progress={progress}
      learnedWords={learnedWords}
      nextLessonFlat={nextLessonFlat}
      onStartLesson={startLesson}
      onPractice={startPractice}
      onReset={() => persist(emptyProgress)}
    />
  )
}

/* ===== Domov ===== */

function HomeView({
  mounted,
  progress,
  learnedWords,
  nextLessonFlat,
  onStartLesson,
  onPractice,
  onReset,
}: {
  mounted: boolean
  progress: Progress
  learnedWords: number
  nextLessonFlat: number
  onStartLesson: (unit: number, lesson: number) => void
  onPractice: () => void
  onReset: () => void
}) {
  const nextUnit = Math.floor(nextLessonFlat / LESSONS_PER_UNIT)
  const nextLesson = nextLessonFlat % LESSONS_PER_UNIT
  const allDone = progress.done.length >= TOTAL_LESSONS

  return (
    <div
      data-testid="app-home"
      data-state={mounted ? 'ready' : 'loading'}
      className="min-h-screen bg-duo-bg font-body text-duo-ink"
    >
      <header className="sticky top-0 z-20 border-b-2 border-duo-line bg-duo-snow/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-2xl bg-duo-green text-lg text-white shadow-[0_3px_0_hsl(var(--duo-green-dark))]">
              🦉
            </span>
            <span className="font-display text-xl font-bold leading-none">Slová 1000</span>
          </div>
          <div className="flex items-center gap-3 text-sm font-extrabold">
            <span className="flex items-center gap-1" title="Séria dní">
              🔥 <span data-testid="stat-streak">{progress.streak}</span>
            </span>
            <span className="flex items-center gap-1" title="Skóre">
              ⭐ <span data-testid="stat-xp">{progress.xp}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-10">
        <section className="mt-4 rounded-3xl border-2 border-duo-line bg-duo-snow p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
              Nauč sa 1000 najpoužívanejších anglických slov
            </h1>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                data-testid="cta-next-lesson"
                onClick={() => onStartLesson(nextUnit, nextLesson)}
                className="btn3d btn3d-blue px-5 py-3 text-sm tracking-wide"
              >
                {allDone ? '🏁 Celý kurz dokončený – opakuj' : '▶ '}
                {allDone ? '' : `Jednotka ${nextUnit + 1} · Lekcia ${nextLesson + 1}`}
              </button>
              {progress.done.length > 0 && (
                <button
                  type="button"
                  data-testid="cta-practice"
                  onClick={onPractice}
                  className="btn3d btn3d-green px-5 py-3 text-sm tracking-wide"
                >
                  🎯 Tréning opakovania
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span className="whitespace-nowrap text-sm font-extrabold text-duo-ink-soft">
              Naučené slová:{' '}
              <span data-testid="learned-count">{learnedWords}</span>
              {' '}
              / 1000
            </span>
            <div className="bar-track h-3 flex-1" role="progressbar" aria-valuemin={0} aria-valuemax={1000} aria-valuenow={learnedWords}>
              <div
                className="bar-fill"
                style={{ width: `${Math.min(100, (learnedWords / 1000) * 100)}%` }}
              />
            </div>
          </div>
        </section>

        <section aria-label="Jednotky kurzu" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {UNITS.map((unit) => {
            const doneInUnit = progress.done.filter((k) => k.startsWith(`${unit.index}-`)).length
            const unitLocked = unit.index > 0 && maxUnitDone(progress.done) < unit.index - 1
            return (
              <article
                key={unit.index}
                className="rounded-2xl border-2 border-duo-line bg-duo-snow p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <h2 className="font-display text-base font-bold">{unit.label}</h2>
                  <p className="text-xs font-bold text-duo-ink-soft">
                    slová {unit.from}–{unit.to}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-3">
                  {Array.from({ length: LESSONS_PER_UNIT }, (_, l) => {
                    const flat = unit.index * LESSONS_PER_UNIT + l
                    const isDone = progress.done.includes(`${unit.index}-${l}`)
                    const isCurrent = !isDone && flat === nextLessonFlat && !allDone
                    const isLocked = !isDone && !isCurrent && flat > nextLessonFlat
                    const nodeClass = isDone
                      ? 'node3d node3d-sm node3d-done'
                      : isCurrent
                        ? 'node3d node3d-sm node3d-current'
                        : 'node3d node3d-sm node3d-locked'
                    return (
                      <button
                        key={l}
                        type="button"
                        aria-label={`Jednotka ${unit.index + 1}, lekcia ${l + 1}${
                          isDone ? ' (dokončená)' : isLocked ? ' (uzamknutá)' : ''
                        }`}
                        disabled={isLocked}
                        onClick={() => onStartLesson(unit.index, l)}
                        className={nodeClass}
                      >
                        {isDone ? '✅' : isLocked ? '🔒' : '⭐'}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div className="bar-track h-2.5 flex-1">
                    <div
                      className="bar-fill"
                      data-tone={doneInUnit === LESSONS_PER_UNIT ? undefined : 'yellow'}
                      style={{ width: `${(doneInUnit / LESSONS_PER_UNIT) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-duo-ink-soft">
                    {doneInUnit}/{LESSONS_PER_UNIT}
                    {unitLocked ? ' · zamknuté' : ''}
                  </span>
                </div>
              </article>
            )
          })}
        </section>

        <footer className="mt-6 text-center text-sm font-semibold text-duo-ink-soft">
          <p>Pokrok sa ukladá v tomto prehliadači.</p>
          <button
            type="button"
            data-testid="reset-progress"
            className="mt-2 underline underline-offset-4 hover:text-duo-red-dark"
            onClick={() => {
              if (window.confirm('Naozaj vymazať celý pokrok?')) onReset()
            }}
          >
            Vymazať pokrok
          </button>
        </footer>
      </main>
    </div>
  )
}

function maxUnitDone(done: string[]): number {
  let max = -1
  for (const k of done) {
    const u = Number(k.split('-')[0])
    if (!Number.isNaN(u) && u > max) max = u
  }
  return max
}

/* ===== Lekcia ===== */

function LessonView({
  session,
  setSession,
  onExit,
  onFinish,
}: {
  session: Session
  setSession: (s: Session) => void
  onExit: () => void
  onFinish: (s: Session, failed: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const q = session.questions[session.idx]
  const total = session.questions.length
  const canCheck =
    session.phase === 'question' &&
    (q.kind === 'type-en' ? session.typed.trim().length > 0 : session.chosen !== null)

  const check = useCallback(() => {
    if (session.phase !== 'question') return
    if (q.kind === 'type-en' && !session.typed.trim()) return
    if (q.kind !== 'type-en' && session.chosen === null) return
    const ok = isCorrectAnswer(session)
    setSession({
      ...session,
      phase: 'feedback',
      lastCorrect: ok,
      hearts: ok ? session.hearts : session.hearts - 1,
      correct: ok ? session.correct + 1 : session.correct,
    })
  }, [session, setSession, q])

  const skip = useCallback(() => {
    if (session.phase !== 'question') return
    setSession({
      ...session,
      phase: 'feedback',
      lastCorrect: false,
      hearts: session.hearts - 1,
    })
  }, [session, setSession])

  const next = useCallback(() => {
    if (session.phase !== 'feedback') return
    if (session.hearts <= 0) {
      onFinish(session, true)
      return
    }
    if (session.idx + 1 >= total) {
      onFinish(session, false)
      return
    }
    setSession({
      ...session,
      idx: session.idx + 1,
      phase: 'question',
      chosen: null,
      typed: '',
    })
  }, [session, setSession, total, onFinish])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (session.phase === 'feedback') {
          e.preventDefault()
          next()
        } else if (canCheck && document.activeElement !== inputRef.current) {
          e.preventDefault()
          check()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session.phase, canCheck, check, next])

  useEffect(() => {
    if (q.kind === 'type-en' && session.phase === 'question') inputRef.current?.focus()
  }, [session.idx, q.kind, session.phase])

  const progressPct = ((session.idx + (session.phase === 'feedback' ? 1 : 0)) / total) * 100

  return (
    <div
      data-testid="app-lesson"
      data-state="ready"
      className="flex min-h-screen flex-col bg-duo-bg font-body text-duo-ink"
    >
      <header className="mx-auto flex w-full max-w-2xl items-center gap-4 px-4 py-4">
        <button
          type="button"
          aria-label="Ukončiť lekciu"
          data-testid="quit-lesson"
          onClick={onExit}
          className="text-2xl font-bold text-duo-ink-soft hover:text-duo-red-dark"
        >
          ✕
        </button>
        <div className="bar-track flex-1">
          <div className="bar-fill" data-testid="lesson-progress" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="flex items-center gap-1 text-lg font-extrabold" aria-label={`Srdiečka: ${session.hearts}`}>
          ❤️ <span data-testid="hearts">{session.hearts}</span>
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-6">
        <p className="text-sm font-extrabold uppercase tracking-wide text-duo-blue-dark">{session.title}</p>

        {q.kind === 'en-sk' && (
          <QuestionPrompt prompt="Ako sa po slovensky povie toto slovo?" big={q.word.en} />
        )}
        {q.kind === 'sk-en' && (
          <QuestionPrompt prompt="Ako sa povie po anglicky?" big={q.word.sk} />
        )}
        {q.kind === 'type-en' && (
          <QuestionPrompt prompt="Napíš toto slovo po anglicky" big={q.word.sk} />
        )}

        {q.kind !== 'type-en' ? (
          <div data-testid="options" className="mt-8 grid gap-3 sm:grid-cols-2">
            {q.options.map((opt, i) => {
              const isSelected = session.chosen === opt
              let state: string | undefined
              if (session.phase === 'feedback') {
                if (opt === q.answer) state = 'correct'
                else if (isSelected) state = 'wrong'
              }
              return (
                <button
                  key={opt}
                  type="button"
                  data-testid={`option-${i}`}
                  className="opt3d px-4 py-3.5 text-base"
                  data-selected={isSelected && session.phase === 'question'}
                  data-state={state}
                  disabled={session.phase === 'feedback'}
                  onClick={() => setSession({ ...session, chosen: opt })}
                >
                  {opt}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="mt-8">
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-testid="type-input"
              aria-label="Odpoveď po anglicky"
              placeholder="Napíš odpoveď po anglicky…"
              value={session.typed}
              disabled={session.phase === 'feedback'}
              onChange={(e) => setSession({ ...session, typed: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && session.phase === 'question' && session.typed.trim()) {
                  e.preventDefault()
                  check()
                }
              }}
              className="w-full rounded-2xl border-2 border-duo-line bg-duo-snow px-4 py-3.5 text-lg font-bold outline-none focus:border-duo-blue disabled:opacity-70"
            />
            {session.phase === 'question' && (
              <button
                type="button"
                data-testid="skip-btn"
                onClick={skip}
                className="mt-4 text-sm font-bold text-duo-ink-soft underline underline-offset-4"
              >
                Nemám tušenie
              </button>
            )}
          </div>
        )}
      </main>

      <footer
        className={`border-t-2 ${
          session.phase === 'feedback'
            ? session.lastCorrect
              ? 'border-duo-green/40 bg-duo-green/10'
              : 'border-duo-red/40 bg-duo-red/10'
            : 'border-duo-line bg-duo-snow'
        }`}
        aria-live="polite"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          {session.phase === 'feedback' ? (
            <>
              <div className="font-bold">
                {session.lastCorrect ? (
                  <p className="text-duo-green-dark" data-testid="feedback-ok">
                    🎉 Super! Správne.
                  </p>
                ) : (
                  <p className="text-duo-red-dark" data-testid="feedback-bad">
                    ✗ Správna odpoveď:{' '}
                    <span className="font-extrabold">
                      {q.kind === 'type-en' ? q.word.en : q.answer}
                    </span>
                  </p>
                )}
              </div>
              <button
                type="button"
                data-testid="continue-btn"
                onClick={next}
                className={`btn3d px-8 py-3.5 text-sm tracking-wide sm:text-base ${
                  session.lastCorrect ? 'btn3d-green' : 'btn3d-continue-wrong'
                }`}
              >
                POKRAČOVAŤ
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-duo-ink-soft">
                Otázka {session.idx + 1} z {total}
              </p>
              <button
                type="button"
                data-testid="check-btn"
                disabled={!canCheck}
                onClick={check}
                className="btn3d btn3d-green px-8 py-3.5 text-sm tracking-wide sm:text-base"
              >
                SKONTROLUJ
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}

function QuestionPrompt({ prompt, big }: { prompt: string; big: string }) {
  return (
    <div className="mt-8">
      <h2 className="font-display text-lg font-bold text-duo-ink-soft">{prompt}</h2>
      <p className="mt-3 font-display text-4xl font-bold leading-tight break-words sm:text-5xl">
        {big}
      </p>
    </div>
  )
}

/* ===== Výsledok ===== */

function ResultView({
  result,
  onRetry,
  onContinue,
}: {
  result: Result
  onRetry: () => void
  onContinue: () => void
}) {
  return (
    <div
      data-testid="app-result"
      data-state="ready"
      className="flex min-h-screen flex-col items-center justify-center bg-duo-bg px-4 text-center font-body text-duo-ink"
    >
      <div className="w-full max-w-md rounded-3xl border-2 border-duo-line bg-duo-snow p-8 shadow-sm">
        {result.status === 'pass' ? (
          <>
            <p className="text-6xl">🏆</p>
            <h1 className="mt-4 font-display text-3xl font-bold text-duo-green-dark">
              Lekcia dokončená!
            </h1>
            <p className="mt-2 text-lg font-bold text-duo-ink-soft">
              Získal si <span className="text-duo-yellow-dark">+{result.xp} XP</span>
            </p>
            <p className="mt-1 font-semibold text-duo-ink-soft">
              Presnosť: {result.correct}/{result.total} (
              {Math.round((result.correct / result.total) * 100)} %)
            </p>
            <button
              type="button"
              data-testid="result-continue"
              onClick={onContinue}
              className="btn3d btn3d-green mt-8 w-full px-8 py-4 text-base tracking-wide"
            >
              POKRAČOVAŤ
            </button>
          </>
        ) : (
          <>
            <p className="text-6xl">💔</p>
            <h1 className="mt-4 font-display text-3xl font-bold text-duo-red-dark">
              Srdiečka došli…
            </h1>
            <p className="mt-2 font-semibold text-duo-ink-soft">
              Skús to znova – opakovanie je matka múdrosti.
            </p>
            <button
              type="button"
              data-testid="result-retry"
              onClick={onRetry}
              className="btn3d btn3d-blue mt-8 w-full px-8 py-4 text-base tracking-wide"
            >
              SKÚSIŤ ZNOVA
            </button>
            <button
              type="button"
              data-testid="result-home"
              onClick={onContinue}
              className="mt-3 w-full px-8 py-3 text-sm font-bold text-duo-ink-soft underline underline-offset-4"
            >
              Späť domov
            </button>
          </>
        )}
      </div>
    </div>
  )
}
