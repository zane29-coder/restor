/**
 * Unit tests for the transport: envelope handling, pagination, errors.
 *
 * No network — every test drives a fake `fetch`, so these run in milliseconds
 * and can assert on exactly what the server would have sent.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      // Transpile only; `npm run typecheck` checks types once for the whole
      // program rather than in every worker.
      { tsconfig: 'tsconfig.json', isolatedModules: true, diagnostics: false },
    ],
  },
  clearMocks: true,
};
