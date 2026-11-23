import { archiveSettingInput } from '#shared/contract'
import { describeSetting } from '../../../shared/archive'
import { useDb } from '../../db'
import { audit, requireOwnerSession } from '../../utils/auth'
import { dueTickets, getArchiveSetting, saveArchiveSetting } from '../../utils/archive'
import { envelope } from '../../utils/envelope'
import { isDryRun } from '../../utils/subtasks'

// How long a ticket sits closed before it leaves the board. Owners only, and browser sessions only, like every
// workspace setting. ?dry_run=1 says how many tickets the new rule would archive, so lowering it is never a surprise.
export default defineEventHandler(async (event) => {
  const actor = await requireOwnerSession(event)
  const input = await readValidatedBody(event, archiveSettingInput.parse)
  const db = await useDb()
  const wouldArchive = (await dueTickets(db, new Date(), input)).length
  if (isDryRun(event)) return envelope({ ...input, summary: describeSetting(input) }, { dry_run: true, wouldArchive })
  const before = await getArchiveSetting(db, actor.organizationId)
  await saveArchiveSetting(db, actor.organizationId, input, new Date().toISOString())
  await audit(actor, 'settings.archive.update', 'archive', { from: before, to: input, wouldArchive })
  return envelope({ ...input, summary: describeSetting(input) }, { wouldArchive })
})
