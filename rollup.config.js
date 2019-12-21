module.exports = [
  {
    input: 'temp/deflate_helper.js',
    output: {
      file: 'dist/zip_default.js',
      format: 'es'
    }
  },
  {
    input: 'temp/ZipArchive.js',
    output: {
      file: 'dist/zip_store_only.js',
      format: 'es'
    }
  }
];