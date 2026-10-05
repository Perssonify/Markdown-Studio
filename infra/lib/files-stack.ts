import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface FilesStackProps extends cdk.StackProps {
  /** Globally unique bucket name. The main stack finds the bucket by it. */
  bucketName: string;
  /** Pages allowed to upload to / download from the bucket directly (presigned URLs). */
  allowedOrigins: string[];
}

/**
 * Markdown Studio's file storage: ONE production bucket for everything users
 * store — documents, images, backups, version history, exports, imports,
 * published copies — each under its own key prefix per user.
 *
 * Its own stack, so it exists independently of the app: the main
 * MarkdownStudio stack finds it by name (it does not own it), and updating,
 * rolling back or deleting the app can never touch users' files. RETAINED and
 * termination-protected: nothing in infrastructure code deletes it.
 *
 * Private, encrypted, TLS-only, versioned (a replaced or deleted file's
 * previous version is kept 30 days — the safety net under every write, and
 * the "In your account" versions in Version history). The daily backups are
 * tagged `kind=backup` by the API's upload link and expire after 30 days.
 */
export class FilesStack extends cdk.Stack {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FilesStackProps) {
    super(scope, id, { terminationProtection: true, ...props });
    cdk.Tags.of(this).add("project", "markdown-studio");

    this.bucket = new s3.Bucket(this, "Files", {
      bucketName: props.bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
        { noncurrentVersionExpiration: cdk.Duration.days(30) },
        // Daily backups (apps/api BACKUP_TAGGING): a month of them. Expiring
        // makes one noncurrent, so the rule above removes it 30 days later.
        { id: "ExpireBackups", tagFilters: { kind: "backup" }, expiration: cdk.Duration.days(30) },
      ],
      // Browsers upload and download directly with presigned URLs, so file
      // bytes never pass through the API (or its 6 MB Lambda payload limit).
      // CORS only lets a listed page READ the responses; every request still
      // needs a URL the API signed for that one file.
      cors: [
        {
          allowedOrigins: props.allowedOrigins,
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
    });

    new cdk.CfnOutput(this, "BucketName", { value: this.bucket.bucketName, description: "The API's S3_BUCKET" });
  }
}
