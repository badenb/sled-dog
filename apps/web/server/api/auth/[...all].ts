import { auth } from '../../auth'

// Better Auth owns everything under /api/auth/* (sign-in, callbacks, sessions, organizations).
export default defineEventHandler(event => auth.handler(toWebRequest(event)))
