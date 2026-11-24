import type { LyricLayout } from '../../../shared/document'
import { layoutsTable, transact } from '../../../shared/db'

interface StoredLayout {
  songId: string
  layout: unknown
  savedAt: number
}

export async function readLayout(songId: string): Promise<unknown> {
  const stored = await transact<StoredLayout | undefined>(layoutsTable, 'readonly', store => store.get(songId))
  return stored?.layout ?? null
}

export function writeLayout(layout: LyricLayout): Promise<IDBValidKey> {
  const stored: StoredLayout = { songId: layout.songId, layout, savedAt: Date.now() }
  return transact(layoutsTable, 'readwrite', store => store.put(stored))
}
