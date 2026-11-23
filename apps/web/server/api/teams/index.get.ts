import { requirePermission } from '../../utils/auth'
import { envelope } from '../../utils/envelope'
import { loadTeams } from '../../utils/teams'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  return envelope(await loadTeams(actor.organizationId))
})
