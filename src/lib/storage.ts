import { env, isStorageConfigured } from "./env";

/**
 * Stockage des enregistrements d'appels sur S3 compatible UE (Scaleway).
 * RGPD : tant que S3 n'est pas configuré, l'URL du provider est conservée
 * telle quelle (hébergement US Vapi) — signalé dans ARCHITECTURE.md §9.
 * La purge selon Organization.retentionDays arrive avec le job Phase 6.
 */
export async function storeCallRecording(args: {
  sourceUrl: string;
  organizationId: string;
  callId: string;
}): Promise<{ url: string; stored: boolean }> {
  if (!isStorageConfigured()) {
    return { url: args.sourceUrl, stored: false };
  }

  // Import dynamique : le SDK AWS n'est chargé que si S3 est configuré.
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

  const download = await fetch(args.sourceUrl);
  if (!download.ok) {
    console.error(
      `[storage] téléchargement enregistrement impossible (${download.status}) — URL provider conservée`,
    );
    return { url: args.sourceUrl, stored: false };
  }
  const bytes = new Uint8Array(await download.arrayBuffer());

  const client = new S3Client({
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
  });

  const key = `recordings/${args.organizationId}/${args.callId}.wav`;
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      Body: bytes,
      ContentType: download.headers.get("content-type") ?? "audio/wav",
    }),
  );

  return { url: `s3://${env.S3_BUCKET}/${key}`, stored: true };
}
