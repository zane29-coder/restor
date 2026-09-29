/**
 * Unit tests: fast, no database, no network.
 *
 * The API-level flows (login, tenant isolation, order creation, status
 * transitions) are covered by `tests/smoke.ps1`, which runs against a live
 * server and a real database — see `tests/README.md` for why that split.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests/unit', '<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
  testTimeout: 15_000,

  // Jest spawns one worker per core by default. ts-jest compiles the whole
  // program in each of them, and on an 8-core machine that is enough memory
  // pressure for the OS to start killing workers with SIGTERM — which surfaces
  // as "Test suite failed to run" rather than as an out-of-memory error.
  // Two workers is still parallel and comfortably within budget.
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
};
