import { buildApp } from '../app.js';

/**
 * Build the whole Fastify app and print its route table, without touching the
 * database.
 *
 * This is the cheapest check that catches the failures which otherwise only
 * appear on a live request: a plugin that fails to register, a zod schema that
 * will not compile, a duplicated route, a circular import between modules.
 * `buildApp()` deliberately does no I/O, so this runs anywhere.
 */
async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();

  const routes: Array<{ method: string; url: string }> = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^.*?([\w/:.-]+)\s+\((.+)\)\s*$/.exec(line);
    if (match) routes.push({ url: match[1]!, method: match[2]! });
  }

  process.stdout.write(app.printRoutes({ commonPrefix: false }));
  process.stdout.write(`\nTotal route entries: ${routes.length}\n`);

  await app.close();
}

main().catch((err) => {
  process.stderr.write(`route tree build FAILED:\n${err?.stack ?? err}\n`);
  process.exit(1);
});
