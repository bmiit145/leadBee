// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Keep Metro's file watcher out of Gradle build output.
 *
 * Gradle continuously creates and deletes directories while a native build
 * runs. Metro crawls them, and on Windows — where there is no watchman and it
 * falls back to `fs.watch` — a directory that disappears mid-crawl throws
 * ENOENT and takes the whole dev server down, often seconds after it has
 * already bundled successfully.
 *
 * This output is not just under `android/`: Expo's own Gradle plugins build
 * into `node_modules/<pkg>/**\/build/classes/...`, which is what killed the
 * server after the first, narrower version of this list.
 *
 * The `build/` entries name Gradle's own subdirectories rather than `build/`
 * itself, because plenty of npm packages legitimately ship importable JS in a
 * `build/` folder (expo-constants among them) and blocking those would break
 * module resolution.
 *
 * The durable fix is to install watchman, which does not use this fallback.
 */
const GRADLE_BUILD_OUTPUT = [
  /[\\/]\.cxx[\\/].*/,
  /[\\/]\.gradle[\\/].*/,
  /[\\/]build[\\/]classes[\\/].*/,
  /[\\/]build[\\/]intermediates[\\/].*/,
  /[\\/]build[\\/]generated[\\/].*/,
  /[\\/]build[\\/]kotlin[\\/].*/,
  /[\\/]build[\\/]outputs[\\/].*/,
  /[\\/]build[\\/]reports[\\/].*/,
  /[\\/]build[\\/]libs[\\/].*/,
  /[\\/]build[\\/]tmp[\\/].*/,
  /(^|[\\/])android[\\/]build[\\/].*/,
  /(^|[\\/])android[\\/]app[\\/]build[\\/].*/,
  /(^|[\\/])ios[\\/]build[\\/].*/,
  /(^|[\\/])ios[\\/]Pods[\\/].*/,
];

// Append rather than replace — the default config ships its own exclusions.
const existing = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, ...GRADLE_BUILD_OUTPUT]
  : existing
    ? [existing, ...GRADLE_BUILD_OUTPUT]
    : GRADLE_BUILD_OUTPUT;

module.exports = config;
