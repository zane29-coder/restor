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
};
