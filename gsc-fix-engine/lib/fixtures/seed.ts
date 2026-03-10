import { PrismaClient } from "@prisma/client";
import { SAMPLE_INCIDENTS } from "./sample-incidents";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  for (const incident of SAMPLE_INCIDENTS) {
    await prisma.incident.create({ data: incident });
  }

  const count = await prisma.incident.count();
  console.log(`Seeded ${count} incidents.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
