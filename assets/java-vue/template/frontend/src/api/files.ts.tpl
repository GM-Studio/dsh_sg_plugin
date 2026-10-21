import { download, mutate, request } from './request';
import type { StoredFile } from './types';

export const fileApi = {
  list: () => request<StoredFile[]>('/api/files'),
  metadata: (id: string) =>
    request<StoredFile>(`/api/files/${encodeURIComponent(id)}`),
  upload: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return mutate<StoredFile>('/api/files/upload', body);
  },
  download: (file: StoredFile) =>
    download(
      `/api/files/${encodeURIComponent(file.fileId)}/download`,
      file.name,
    ),
};
