import type { PhotoFormat, PhotoMetadata, ViewSize } from '@curador/core';

export type WorkerRequest =
  | { id: number; kind: 'meta'; file: File; format: PhotoFormat; extension: string }
  | { id: number; kind: 'view'; file: File; format: PhotoFormat; extension: string; size: ViewSize; orientation: number }
  | { id: number; kind: 'hash'; file: File };

export type WorkerRequestBody = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      meta?: PhotoMetadata;
      view?: { blob: Blob; width: number; height: number };
      hash?: string;
    }
  | { id: number; ok: false; error: string; unsupported: boolean };
