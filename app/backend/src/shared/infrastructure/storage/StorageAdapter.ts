export interface StorageAdapter {
  saveFile(key: string, buffer: Buffer, contentType?: string): Promise<string>;
  getFile(key: string): Promise<Buffer | null>;
  deleteFile(key: string): Promise<void>;
  fileExists(key: string): Promise<boolean>;
  getFileUrl(key: string): Promise<string>;
  listFiles(prefix: string): Promise<string[]>;
  listFileVersions?(prefix: string): Promise<Array<{
    key: string;
    versionId?: string;
    isDeleteMarker?: boolean;
  }>>;
  deleteFileVersion?(key: string, versionId?: string): Promise<void>;
}
