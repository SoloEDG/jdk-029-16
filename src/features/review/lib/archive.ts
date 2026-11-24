import type { Take } from '../../../shared/document'
import { takesTable, transact } from '../../../shared/db'

export const readTakes = () => transact<Take[]>(takesTable, 'readonly', store => store.getAll())
export const writeTake = (take: Take) => transact(takesTable, 'readwrite', store => store.put(take))
