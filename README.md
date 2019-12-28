# ZIP
A modern TypeScript library for creating, reading and editing ZIP archives in a client side environment. 

## Installing
The latest builds can be found in the "dist" folder. 2 versions are available: "zip_default.js" which includes support for compression/decompression, and "zip_store_only.js" which can only read/write uncompressed files within a zip archive.

The code required for compression is quite substantial, hence why an alternative version is available without it.

A version will be published to NPM soon.

## Usage

The class ZipArchive is the primary interface for the library, and has the following public methods:

### Checking the existance of an entry in an archive
`ZipArchive.prototype.has(file_name: string): boolean`

The `has()` method returns a boolean indicating whether a ZipEntry with the specified file name exists or not.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

console.log(archive.has("hello.txt"));
// expected output: true
console.log(archive.has("avatar.png"));
// expected output: false
```

### Getting an entry from an archive for an existing file 
`ZipArchive.prototype.get(file_name: string): ZipEntry | undefined`

The `get()` method returns a ZipEntry if one with a matching file name is present, otherwise it will return undefined.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

console.log(archive.get("hello.txt"));
// expected output: ZipEntry
console.log(archive.get("avatar.png"));
// expected output: undefined
```

### Creating or updating an entry within an archive
`ZipArchive.prototype.set(file_name: string, file: Blob): ZipEntry`

The `set()` method adds or replaces a ZipEntry with a new enty created from a specific file name and a Blob.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

console.log(await archive.get("hello.txt").get_string());
// expected output: "hello world"
```

### Compress an existing entry in an archive
`ZipArchive.prototype.compress_entry(file_name: string): Promise<ZipEntry>`

The `compress_entry()` method replaces an existing ZipEntry with a promise that resolves to a new ZipEntry containing the contents of the old entry compressed using the deflate algorithm.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

await archive.compress_entry("hello.txt");
// expected output: ZipEntry
```

### Serialising an archive
`ZipArchive.prototype.to_blob(): Blob`

The `to_blob()` method serializes the ZipArchive in the Zip format and returns the result as a blob.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

const blob = archive.to_blob();
// expected output: Blob
```

### List the entries of an archive
`ZipArchive.prototype.files(): Iterator<[file_name: string, entry: ZipEntry]>`

The `files()` method returns a new iterator object that contains `[file_name, entry]` pairs for each ZipEntry in the archive in insertion order. 

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
archive.set("hello.txt", "hello world");
archive.set("data.bin", new Uint8Array(1024));

console.log(iterator1.next().value);
// expected output: ["hello.txt", ZipEntry]

console.log(iterator1.next().value);
// expected output: ["data.bin", ZipEntry]
```

### Reading an archive
`ZipArchive.from_blob(zip_file: Blob): Promise<ZipArchive>`

The `from_blob()` method returns a new promise that resolves to a ZipArchive created from a Zip file passed in as a blob.

```javascript
import { ZipArchive } from "./zip.js";

const input_element = document.querySelector("input[type=file]");

input_element.addEventListener("change", async e => {
  const archive = await ZipArchive.from_blob(e.files[0]);
  // expected output: ZipArchive
});
```