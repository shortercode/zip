module.exports = {
    transform: {
      '^.+\\.ts?$': ['ts-jest', { tsconfig: './tsconfig.jest.json' }],
    },
    testRegex: '/test/.*\\.test?\\.ts$',
    moduleFileExtensions: ['ts', 'js'],
  };
