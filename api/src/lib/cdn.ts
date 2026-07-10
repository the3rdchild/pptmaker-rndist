import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/config/env";

const s3Client = new S3Client({
	endpoint: env.CDN_ENDPOINT,
	region: env.CDN_REGION || "us-east-1",
	credentials: {
		accessKeyId: env.CDN_ACCESS_KEY_ID || "",
		secretAccessKey: env.CDN_SECRET_ACCESS_KEY || "",
	},
	forcePathStyle: true,
});

const bucket = env.CDN_BUCKET_NAME || "";

const useObjectAcl = process.env.S3_USE_OBJECT_ACL === "true";

export async function uploadFile(
	key: string,
	body: Buffer | ArrayBuffer | Uint8Array | string,
	contentType: string,
	isPublic = false,
): Promise<string> {
	const buffer = body instanceof ArrayBuffer ? Buffer.from(body) : body;

	const command = new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		Body: buffer,
		ContentType: contentType,
		...(useObjectAcl && { ACL: isPublic ? "public-read" : "private" }),
	});

	await s3Client.send(command);
	return key;
}

export async function deleteFile(key: string) {
	const command = new DeleteObjectCommand({
		Bucket: bucket,
		Key: key,
	});

	return await s3Client.send(command);
}

export async function getPresignedUrl(key: string, expiresIn = 3600) {
	const { GetObjectCommand } = await import("@aws-sdk/client-s3");
	const command = new GetObjectCommand({
		Bucket: bucket,
		Key: key,
	});

	return await getSignedUrl(s3Client, command, { expiresIn });
}

export { s3Client };
