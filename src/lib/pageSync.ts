import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

interface HardcodedPage {
  slug: string;
  title: string;
  filePath: string;
}

const HARDCODED_PAGES: HardcodedPage[] = [
  { slug: "projects", title: "Projects", filePath: "src/views/projects/index.hbs" },
  { slug: "workflows", title: "Workflows", filePath: "src/views/workflows/catalog.hbs" },
  { slug: "workflow-tasks", title: "Workflow Tasks", filePath: "src/views/workflow-tasks/inbox.hbs" },
  { slug: "admin", title: "Admin Login", filePath: "src/views/admin/login.hbs" }
  // Add other hardcoded pages here as needed.
];

export async function syncAppPages() {
  logger.info("Syncing hardcoded pages to database...");
  
  try {
    for (const page of HARDCODED_PAGES) {
      await prisma.page.upsert({
        where: { slug: page.slug },
        update: {
          isHardcoded: true,
          filePath: page.filePath,
          title: page.title,
          status: "PUBLISHED",
          deletedAt: null // Restore if it was soft-deleted
        },
        create: {
          slug: page.slug,
          title: page.title,
          isHardcoded: true,
          filePath: page.filePath,
          status: "PUBLISHED"
        }
      });
    }

    logger.info("Hardcoded pages synchronized successfully.");
  } catch (error) {
    logger.error({ err: error }, "Failed to sync hardcoded pages");
  }
}
