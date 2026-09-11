import { execFileSync } from 'node:child_process';
import { expect, test } from './fixtures';
import {
  Screen,
  addAccount,
  addExpense,
  chooseOption,
  createVault,
  fillField,
  goToTab,
  tap,
} from './helpers';

/**
 * The S3 adapter against a real S3-compatible store.
 *
 * MinIO speaks the same API as AWS, R2 and B2, and runs in a container, so the
 * adapter is exercised against the actual protocol — request signing, CORS
 * preflights, listing semantics — rather than a stub that agrees with whatever
 * the adapter does.
 */
const CONTAINER = 'docket-minio-e2e';
const PORT = 9100;
const BUCKET = 'docket-e2e';
const ACCESS_KEY = 'dockettest';
const SECRET_KEY = 'dockettest123';
const ENDPOINT = `http://localhost:${PORT}`;

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    region: 'us-east-1',
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
}

/** Every object in the bucket, as name and bytes. */
async function storedObjects(): Promise<{ key: string; body: string }[]> {
  const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await client();

  const listing = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  const objects: { key: string; body: string }[] = [];

  for (const item of listing.Contents ?? []) {
    if (!item.Key) continue;
    const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: item.Key }));
    const bytes = await result.Body!.transformToByteArray();
    objects.push({ key: item.Key, body: Buffer.from(bytes).toString('binary') });
  }
  return objects;
}

test.describe('s3 sync', () => {
  test.beforeAll(async () => {
    test.skip(!dockerAvailable(), 'Docker is not available');

    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    execFileSync('docker', [
      'run', '-d', '--name', CONTAINER,
      '-p', `${PORT}:9000`,
      '-e', `MINIO_ROOT_USER=${ACCESS_KEY}`,
      '-e', `MINIO_ROOT_PASSWORD=${SECRET_KEY}`,
      // Without this the browser's preflight is refused and the adapter never
      // gets to make a request at all.
      '-e', 'MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:4599',
      'quay.io/minio/minio:latest', 'server', '/data',
    ]);

    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(`${ENDPOINT}/minio/health/live`);
        if (response.ok) break;
      } catch {
        // Still starting.
      }
      if (Date.now() > deadline) throw new Error('MinIO did not start');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
    await (await client()).send(new CreateBucketCommand({ Bucket: BUCKET }));
  });

  test.afterAll(() => {
    if (dockerAvailable()) execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  });

  test('uploads an encrypted ledger to a real bucket', async ({ page }) => {
    await createVault(page);
    await addAccount(page, 'Joint Current Account', '4200.00');
    await addExpense(page, '45.00', 'Dr Mehta Clinic', 'Health');

    await goToTab(page, 'Settings', Screen.settings);
    await page.locator(Screen.settings).getByRole('heading', { name: 'Destination' }).click();
    await expect(page.getByText('Sync destination')).toBeVisible();

    await chooseOption(page, 'Destination', 'S3-compatible storage');
    await fillField(page, 'Bucket name', BUCKET);
    await fillField(page, 'Region', 'us-east-1');
    await fillField(page, 'Endpoint', ENDPOINT);
    await fillField(page, 'Access key id', ACCESS_KEY);
    await fillField(page, 'Secret access key', SECRET_KEY);

    await tap(page, 'Test connection');
    await expect(page.getByText('Connected successfully.')).toBeVisible({ timeout: 20_000 });

    await tap(page, 'Save');

    await expect(async () => {
      expect(await storedObjects()).not.toHaveLength(0);
    }).toPass({ timeout: 30_000 });

    const [object] = await storedObjects();
    expect(object.key).toMatch(/^vaults\/[0-9a-f-]+\/ops\/\d{19}-[0-9a-f]{4}-\w+\.edk$/);

    // Stored as an Easy Docket envelope, and unreadable.
    expect(object.body.startsWith('EDCK')).toBe(true);
    for (const secret of ['Dr Mehta Clinic', 'Joint Current Account', '4500', 'transactions']) {
      expect(object.body, `"${secret}" must not reach the bucket`).not.toContain(secret);
    }
  });
});
