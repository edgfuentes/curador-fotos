import { detectFormat, extensionOf, parseExifDateTime, splitPath, type CameraInfo, type Photo } from '../src';

export function makePhoto(
  relativePath: string,
  opts: { time?: string; camera?: CameraInfo; size?: number; lastModified?: number; sha256?: string } = {},
): Photo {
  const { folder, fileName } = splitPath(relativePath);
  const capture = parseExifDateTime(opts.time);
  return {
    id: relativePath,
    relativePath,
    fileName,
    folder,
    size: opts.size ?? 1000,
    lastModified: opts.lastModified ?? 0,
    format: detectFormat(fileName) ?? 'jpeg',
    extension: extensionOf(fileName),
    ...(capture ? { capture } : {}),
    ...(opts.camera ? { camera: opts.camera } : {}),
    ...(opts.sha256 ? { sha256: opts.sha256 } : {}),
  };
}
