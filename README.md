# zip
A modern Typescript library for creating, reading and editing ZIP archives in a client side environment. 

## API

The module "zip.js" exports a single class `ZipArchive` which has the following public methods

### `ZipArchive.prototype.has(file_name: string): boolean`

The `has()` method returns a boolean indicating whether a ZipEntry with the specified file name exists or not.

```javascript
const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

console.log(archive.has("hello.txt"));
// expected output: true
console.log(archive.has("avatar.png"));
// expected output: false
```

### `ZipArchive.prototype.get(file_name: string): ZipEntry | undefined`

The `get()` method returns a ZipEntry if one with a matching file name is present, otherwise it will return undefined.

```javascript
const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

console.log(archive.get("hello.txt"));
// expected output: ZipEntry
console.log(archive.get("avatar.png"));
// expected output: undefined
```

### `ZipArchive.prototype.set(file_name: string, file: Blob): ZipEntry`

The `set()` method adds or replaces a ZipEntry with a specific file name and a Blob.

```javascript
const archive = new ZipArchive;
archive.set("hello.txt", "hello world");

console.log(await archive.get("hello.txt").get_string());
// expected output: "hello world"
```

### `ZipArchive.prototype.compress_entry(file_name: string): Promise<ZipEntry>`

The `compress_entry()` method replaces an existing ZipEntry with a new ZipEntry containing the contents of the old entry compressed using the deflate algorithm.

### `ZipArchive.prototype.to_blob(): Blob`

The `to_blob()` method serializes the ZipArchive in the Zip format and returns the result as a blob.

### `ZipArchive.prototype.files(): Iterator<[file_name: string, entry: ZipEntry]>`

The `files()` method returns a new iterator object that contains `[file_name, entry]` pairs for each ZipEntry in the archive in insertion order. 

### `ZipArchive.from_blob(zip_file: Blob): Promise<ZipArchive>`

The `from_blob()` method returns a new promise that resolves to a ZipArchive created from a serialised Zip file passed in as a blob.

## Example Usage

### Creating a new Zip file

```javascript

import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
const file_contents = "hello world!";
const file_name = "hello.txt";

archive.set(file_name, new Blob([file_contents]));

const output = await archive.to_blob();
```

### Reading the contents existing Zip file

```javascript
const archive = await ZipArchive.from_blob(input);

for (const [name, entry] of archive.files()) {
    const { size, is_compressed } = entry;
    console.log({ name, size, is_compressed });
}
```

### Extracting the contents of an entry in an existing Zip file

```javascript
const archive = await ZipArchive.from_blob(input);
const str = await archive.get("hello.txt").get_string();
```