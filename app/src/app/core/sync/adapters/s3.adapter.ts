import {
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { RemoteObject, SyncAdapter, SyncTransportError } from '../sync-adapter';
import { S3Target } from '../sync-target';

/**
 * Adapter for any S3-compatible object store.
 *
 * Worth being honest about the trade-off this option carries: the credentials
 * are long-lived and sit on the device, so they should be scoped to a single
 * bucket with a policy that grants only Get/Put/List. The *data* is still
 * end-to-end encrypted — a stolen key exposes object names and sizes, not a
 * single transaction — but a stolen key can still delete the backup.
 */
export class S3Adapter implements SyncAdapter {
  readonly description: string;
  private readonly client: S3Client;

  constructor(private readonly target: S3Target, client?: S3Client) {
    this.description = `S3 bucket ${target.bucket}`;
    this.client =
      client ??
      new S3Client({
        region: target.region || 'auto',
        endpoint: target.endpoint || undefined,
        forcePathStyle: target.forcePathStyle,
        credentials: {
          accessKeyId: target.accessKeyId,
          secretAccessKey: target.secretAccessKey,
        },
      });
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    const objects: RemoteObject[] = [];
    let token: string | undefined;

    do {
      const page = await this.run(() =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.target.bucket,
            Prefix: this.key(prefix),
            ContinuationToken: token,
          }),
        ),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key) objects.push({ name: this.unkey(item.Key), size: item.Size });
      }
      token = page.NextContinuationToken;
    } while (token);

    return objects.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async get(name: string): Promise<Uint8Array> {
    const result = await this.run(() =>
      this.client.send(new GetObjectCommand({ Bucket: this.target.bucket, Key: this.key(name) })),
    );
    if (!result.Body) throw new SyncTransportError(`Empty response for ${name}`, true);
    return new Uint8Array(await result.Body.transformToByteArray());
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    await this.run(() =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.target.bucket,
          Key: this.key(name),
          Body: bytes,
          ContentType: 'application/octet-stream',
        }),
      ),
    );
  }

  async probe(): Promise<void> {
    await this.run(() => this.client.send(new HeadBucketCommand({ Bucket: this.target.bucket })));
  }

  private key(name: string): string {
    const prefix = this.target.prefix.replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${name}` : name;
  }

  private unkey(key: string): string {
    const prefix = this.target.prefix.replace(/^\/+|\/+$/g, '');
    return prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      const status = (cause as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      const retryable = status === undefined || status >= 500 || status === 429;
      throw new SyncTransportError(
        `S3 request failed${status ? ` with ${status}` : ''}: ${(cause as Error).message}`,
        retryable,
        cause,
      );
    }
  }
}
