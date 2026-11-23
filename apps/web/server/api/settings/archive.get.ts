import { DEFAULT_ARCHIVE, describeSetting } from '../../../shared/archive'
import { useDb } from '../../db'
import { requirePermission } from '../../utils/auth'
import { getArchiveSetting } from '../../utils/archive'
import { envelope } from '../../utils/envelope'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, 'ticket', 'read')
  const setting = await getArchiveSetting(await useDb(), actor.organizationId)
  return envelope({ ...setting, summary: describeSetting(setting), default: DEFAULT_ARCHIVE })
})
