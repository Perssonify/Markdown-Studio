import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { FilesStack } from "../lib/files-stack.ts";

const stack = new FilesStack(new cdk.App(), "Files", {
  bucketName: "markdown-studio-files-test",
  allowedOrigins: ["https://markdownstudio.com", "http://localhost:5173"],
});
const template = Template.fromStack(stack);

describe("the file-storage bucket", () => {
  it("is the stack's only resource besides its TLS-only policy", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.resourceCountIs("AWS::S3::BucketPolicy", 1);
    const types = Object.values(template.toJSON().Resources as Record<string, { Type: string }>).map((r) => r.Type);
    expect(types.filter((t) => !t.startsWith("AWS::S3::") && t !== "AWS::CDK::Metadata")).toEqual([]);
  });

  it("is private, encrypted and versioned", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "markdown-studio-files-test",
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      VersioningConfiguration: { Status: "Enabled" },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
    });
  });

  // Users' files: no stack update, rollback or delete may remove them.
  it("is never deleted with the stack, nothing empties it, and the stack itself is protected", () => {
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
    expect(JSON.stringify(template.toJSON())).not.toMatch(/AutoDeleteObjects|auto-delete/i);
    expect(stack.terminationProtection).toBe(true);
  });

  it("keeps replaced versions 30 days, and daily backups a month", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: [
          { AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 }, Status: "Enabled" },
          { NoncurrentVersionExpiration: { NoncurrentDays: 30 }, Status: "Enabled" },
          { Id: "ExpireBackups", TagFilters: [{ Key: "kind", Value: "backup" }], ExpirationInDays: 30, Status: "Enabled" },
        ],
      },
    });
  });

  it("lets the listed pages upload with presigned URLs, and nothing else", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedOrigins: ["https://markdownstudio.com", "http://localhost:5173"],
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposedHeaders: ["ETag"],
            MaxAge: 3000,
          },
        ],
      },
    });
  });
});
