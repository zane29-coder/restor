const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Monorepo-aware Metro config.
 *
 * The courier app lives inside the repo but is deliberately NOT an npm
 * workspace: Expo resolves its own native modules and hoisting breaks the
 * linking. Metro therefore has to be told explicitly where the shared packages
 * are, and to look in both node_modules trees.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the shared packages so editing one hot-reloads the app.
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages/shared-types'),
  path.resolve(workspaceRoot, 'packages/shared-utils'),
  path.resolve(workspaceRoot, 'packages/api-client'),
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Without this, two copies of React can be resolved — the app's and the
// workspace root's — which fails at runtime with a hooks error.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
