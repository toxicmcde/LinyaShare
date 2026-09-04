import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const provider = process.env.DATABASE_PROVIDER || "sqlite"
const quote = provider === "mysql" ? "`" : '"'
const legacyColumnUpdate = (table) => `UPDATE ${quote}${table}${quote} SET ${quote}plainPassword${quote} = NULL`

try {
  // The columns are intentionally cleared before they are removed from the
  // schema. Existing bcrypt hashes remain valid for future verification.
  const files = await prisma.$executeRawUnsafe(legacyColumnUpdate("File"))
  const albums = await prisma.$executeRawUnsafe(legacyColumnUpdate("Album"))
  console.log(`Cleared ${files} file password values and ${albums} album password values.`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/no such column|unknown column|no such table|does not exist|doesn't exist|relation .* does not exist/i.test(message)) {
    console.log("Password plaintext columns are already absent; no data changes were needed.")
  } else {
    console.error("Security migration failed:", message)
    process.exitCode = 1
  }
} finally {
  await prisma.$disconnect()
}
