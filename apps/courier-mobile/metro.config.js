const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro config for an app that lives inside the repo but is NOT an npm
 * workspace.
 *
 * Expo resolves its own native modules and npm hoisting breaks that linking,
 * so this app keeps its own complete `node_modules` and pulls the shared
 * packages in with `file:` links (see package.json).
 *
 * That means Metro needs exactly one thing beyond its defaults: to WATCH the
 * linked packages, so editing `@restor/shared-utils` hot-reloads here instead
 * of requiring a restart.
 *
 * Note what is deliberately absent: `disableHierarchicalLookup`. It was here
 * to guard against two copies of React, but this app has its own dependency
 * tree and none of the `@restor/*` packages depend on React — so there is no
 * duplicate to guard against. What it DID do was stop Metro walking up into
 * React Native's own nested `node_modules`, which broke
 * `@react-native/virtualized-lists` and every `FlatList` with it.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watched so edits to a shared package trigger a reload. `file:` links are
// symlinks, which Metro follows natively.
//
// Resolution lands on each package's `dist/`, not `src/` — the same compiled
// output the web apps consume. So after editing a shared package, run
// `npm run build:packages` at the repo root for the change to reach the app.
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages/shared-types'),
  path.resolve(workspaceRoot, 'packages/shared-utils'),
  path.resolve(workspaceRoot, 'packages/api-client'),
];

/**
 * Metro transforms the linked packages' files too, and Babel injects helper
 * imports (`@babel/runtime/helpers/*`) into them. Those files live OUTSIDE the
 * project root, so Node-style resolution looks for the helpers next to them in
 * `packages/` — where nothing is installed — instead of here.
 *
 * Naming this app's `node_modules` explicitly gives Metro somewhere to find
 * them regardless of where the importing file sits.
 */
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
