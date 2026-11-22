// Better Auth configuration. Kept free of Nuxt auto-imports so the Better Auth
// CLI can load it standalone to generate the database schema.
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins/magic-link'
import { organization } from 'better-auth/plugins/organization'
import { and, count, eq, gt, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db, schema } from './db'
import { ac, roles } from '../shared/permissions'

const dev = process.env.NODE_ENV !== 'production'

/** Real email delivery is not wired yet. Dev prints links; production refuses rather than lose them. */
async function deliver(kind: string, to: string, url: string) {
  if (!dev) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email delivery is not configured.' })
  console.info(`\n[sled-dog] ${kind} for ${to}:\n  ${url}\n`)
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  // Sign-in failures (e.g. not invited) land back on our login page, not a raw JSON response.
  onAPIError: { errorURL: '/login' },

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },

  plugins: [
    organization({
      ac,
      roles,
      creatorRole: 'owner',
      allowUserToCreateOrganization: false, // one workspace for now; created for the first user
      sendInvitationEmail: async ({ email, id }) =>
        deliver('Invitation', email, `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/login?invitation=${id}`),
    }),
    magicLink({
      expiresIn: 60 * 10,
      sendMagicLink: async ({ email, url }) => deliver('Magic link', email, url),
    }),
  ],

  databaseHooks: {
    user: {
      create: {
        // Invite-only: the first user bootstraps the workspace; after that you need a pending invitation.
        before: async (user) => {
          const [{ n }] = await db.select({ n: count() }).from(schema.user)
          if (n === 0) return
          const invite = await db.select({ id: schema.invitation.id }).from(schema.invitation)
            .where(and(sql`lower(${schema.invitation.email}) = ${user.email.toLowerCase()}`, eq(schema.invitation.status, 'pending'), gt(schema.invitation.expiresAt, new Date()))).get()
          if (!invite) throw new APIError('FORBIDDEN', { message: 'This workspace is invite-only. Ask an owner to invite you.' })
        },
        after: async (user) => {
          const now = new Date()
          const [{ n }] = await db.select({ n: count() }).from(schema.user)
          if (n === 1) {
            const organizationId = randomUUID()
            await db.insert(schema.organization).values({ id: organizationId, name: 'Workspace', slug: 'workspace', createdAt: now })
            await db.insert(schema.member).values({ id: randomUUID(), organizationId, userId: user.id, role: 'owner', createdAt: now })
            return
          }
          const invite = await db.select().from(schema.invitation)
            .where(and(sql`lower(${schema.invitation.email}) = ${user.email.toLowerCase()}`, eq(schema.invitation.status, 'pending'), gt(schema.invitation.expiresAt, new Date()))).get()
          if (!invite) return
          await db.insert(schema.member).values({ id: randomUUID(), organizationId: invite.organizationId, userId: user.id, role: invite.role ?? 'stakeholder', createdAt: now })
          await db.update(schema.invitation).set({ status: 'accepted' }).where(eq(schema.invitation.id, invite.id))
        },
      },
    },
    session: {
      create: {
        // Put the user's workspace in the session so permission checks know the scope.
        before: async (session) => {
          const member = await db.select().from(schema.member).where(eq(schema.member.userId, session.userId)).get()
          return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } }
        },
      },
    },
  },
})
