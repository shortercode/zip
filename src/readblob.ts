export function read_blob (blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) =>
    {
        const fileReader = new FileReader();
        fileReader.onload = () => resolve(<ArrayBuffer>fileReader.result);
        fileReader.onerror = () => reject(fileReader.error);
        fileReader.readAsArrayBuffer(blob);
    });
}