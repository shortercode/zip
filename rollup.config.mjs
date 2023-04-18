
import typescript from 'rollup-plugin-typescript2';
import fs from 'fs';
import pkg from './package.json' assert { type: "json" };


function build_revision_plugin () {
  return {
    name: 'build-revision',
    buildEnd () {
      const version = `${pkg.version}.${process.env.BUILD_NUMBER || 0}`;
      console.log({ version });
      return fs.promises.writeFile('./dist/package.json', JSON.stringify({
        ...pkg,
        version,
      }, null, 2));
    }
  };
}


export default [
  {
    input: 'src/index.ts',
    plugins: [
      typescript(),
      build_revision_plugin(),
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
  }];