import { createClient } from '@supabase/supabase-js';
export const BUCKET = 'paper-files';
export interface FileStorage {
  info(path: string): Promise<{ size: number } | null>;
  download(path: string): Promise<Buffer>;
  upload(path: string, data: Buffer, contentType: string): Promise<void>;
  sign(path: string): Promise<string>;
  remove(paths: string[]): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
export function storageClient(url: string, serviceKey: string) {
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(30000),
        }),
    },
  });
  const bucket = client.storage.from(BUCKET);
  const storage: FileStorage = {
    async info(path) {
      const { data, error } = await bucket.info(path);
      if (error) {
        if (String(error.status) === '404' || String(error.statusCode) === '404') return null;
        throw error;
      }
      if (typeof data.size !== 'number') throw new Error('Storage did not return the uploaded file size.');
      return { size: data.size };
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    },
    async upload(path, data, contentType) {
      const { error } = await bucket.upload(path, data, {
        contentType,
        upsert: false,
      });
      if (error) throw error;
    },
    async sign(path) {
      const { data, error } = await bucket.createSignedUrl(path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
    async remove(paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await bucket.remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
    },
    async list(prefix) {
      const paths: string[] = [];
      const walk = async (folder: string) => {
        for (let offset = 0; ; offset += 100) {
          const { data, error } = await bucket.list(folder, {
            limit: 100,
            offset,
          });
          if (error) throw error;
          for (const item of data) {
            const path = `${folder}/${item.name}`;
            if (item.id) paths.push(path);
            else await walk(path);
          }
          if (data.length < 100) break;
        }
      };
      await walk(prefix);
      return paths;
    },
  };
  return {
    storage,
    async authenticate(token: string): Promise<string | null> {
      const { data, error } = await client.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
  };
}
