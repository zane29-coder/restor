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
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        // Transpile only. Type errors are caught by `npm run typecheck`, which
        // does it once for the whole program; making every Jest worker
        // type-check the program again is what exhausted memory here and got
        // workers killed with SIGTERM.
        isolatedModules: true,
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
  testTimeout: 15_000,

  // Jest spawns one worker per core by default; with transpile-only above,
  // half the cores is plenty and leaves memory headroom on a shared machine.
  maxWorkers: '50%',
  workerIdleMemoryLimit: '512MB',
};
