// Records a checksum for every migration in drizzle/meta/checksums.json.
// A migration that has been committed must never change (databases remember it by hash), so by default
// this only ADDS entries for new migrations and refuses to overwrite one that differs.
//   npm run db:seal            seal new migrations
//   npm run db:seal -- --force re-seal a migration you have NOT merged yet (reviewers will see the change)
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../drizzle/', import.meta.url))
const manifestPath = `${dir}meta/checksums.json`
const force = process.argv.includes('--force')
const journal = JSON.parse(readFileSync(`${dir}meta/_journal.json`, 'utf8'))
const sealed = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
const next = { ...sealed }
let refused = 0

for (const { tag } of journal.entries) {
  const hash = createHash('sha256').update(readFileSync(`${dir}${tag}.sql`, 'utf8')).digest('hex')
  if (sealed[tag] && sealed[tag] !== hash && !force) {
    console.error(`✖ ${tag}.sql changed after it was sealed. Restore it and add a new migration instead (or --force if it was never merged).`)
    refused++
  } else if (sealed[tag] !== hash) {
    next[tag] = hash
    console.log(`${sealed[tag] ? 're-sealed' : 'sealed'}  ${tag}`)
  }
}
if (refused) process.exit(1)
writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n')
console.log(`${Object.keys(next).length} migrations sealed in drizzle/meta/checksums.json`)
