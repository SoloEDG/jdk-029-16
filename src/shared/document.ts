export interface TimeRange { start: number; end: number }

export interface LyricLine extends TimeRange {
  id: string
  text: string
}

/** How a word came to exist. A split keeps the parent's breath; a replace does not. */
export type WordRelation = 'split' | 'replace'

export interface CharSpan { from: number; to: number }

export interface LyricWord {
  id: string
  text: string
  /** The word this one was split or rewritten from, if any. */
  parentId: string | null
  relation: WordRelation | null
  /** Where in the parent's text this word sits; null for words the song shipped with. */
  slice: CharSpan | null
  /** Where the word was first sung. */
  origin: TimeRange
}

/** A place in the song. Places never move; only the words inside them are exchanged. */
export interface PhraseSlot extends TimeRange {
  id: string
  wordId: string
  /** The latter half of a split, which is what may be exchanged. */
  tail: boolean
}

/** A slot resolved against the word that currently lives in it. */
export interface LyricPhrase extends LyricLine {
  wordId: string
  tail: boolean
  /** True when the word here was born in another place. */
  moved: boolean
  /** Where the word here was first sung. */
  origin: TimeRange
}

export interface LyricLayout {
  version: 1
  songId: string
  /** Every word the song has used, including retired ones, so history can be named. */
  words: LyricWord[]
  slots: PhraseSlot[]
}

export interface GuideNote extends TimeRange { midi: number }

export interface Song {
  id: string
  title: string
  artist: string
  bpm: number
  key: string
  duration: number
  audio: string
  cover: string
  lines: LyricLine[]
  notes: GuideNote[]
}

export interface PitchPoint {
  time: number
  midi: number | null
}

export interface Take extends TimeRange {
  id: string
  songId: string
  /** Slot that was being practised when the take was recorded. */
  lineId: string
  /** Word identity at recording time; older takes fall back to their slot's first word. */
  wordId?: string
  /** Text at recording time, kept so a retired word can still be named. */
  wordText?: string
  createdAt: number
  audio: Blob
  pitch: PitchPoint[]
}

export interface PcmFrame {
  inputTime: number
  samples: Float32Array
}
