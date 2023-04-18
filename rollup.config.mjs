
import typescript from 'rollup-plugin-typescript2';

export default [
  {
    input: 'src/index.ts',
    plugins: [
      typescript()
    ],
    output: [
      {
        file: `dist/index.js`,
        format: 'cjs'
      },
      {
        file: `dist/index.mjs`,
        format: 'esm'
      }
    ]
  },
  {
    input: 'src/ZipArchive.ts',
    plugins: [
      typescript()
    ],
    output: [
      {
        file: `dist/zip_store_only.js`,
        format: 'cjs'
      },
      {
        file: `dist/zip_store_only.mjs`,
        format: 'esm'
      }
    ]
  }];