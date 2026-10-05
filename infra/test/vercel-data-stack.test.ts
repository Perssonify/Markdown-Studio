import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { VercelDataStack } from "../lib/vercel-data-stack.ts";

const synth = (allowedIps: string[]) => {
  const stack = new VercelDataStack(new cdk.App(), "VercelData", {
    env: { account: "111111111111", region: "us-east-1" },
    filesBucketName: "markdown-studio-files-test",
    allowedIps,
  });
  return { stack, template: Template.fromStack(stack) };
};

const { stack, template } = synth(["203.0.113.10", "203.0.113.11"]);

describe("the database for Markdown Studio on Vercel", () => {
  it("is plain RDS PostgreSQL 17 (not Aurora), encrypted, backed up 7 days", () => {
    template.resourceCountIs("AWS::RDS::DBCluster", 0);
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      EngineVersion: "17.11",
      DBInstanceClass: "db.t4g.micro",
      StorageEncrypted: true,
      BackupRetentionPeriod: 7,
    });
  });

  // No code here may ever delete a database (CLAUDE.md).
  it("is never deleted by CloudFormation, nor is its password, and the stack is protected", () => {
    template.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: Match.objectLike({ DeletionProtection: true }) });
    template.hasResource("AWS::SecretsManager::Secret", { DeletionPolicy: "Retain", Properties: Match.objectLike({ GenerateSecretString: Match.anyValue() }) });
    expect(stack.terminationProtection).toBe(true);
  });

  it("admits connections from the Vercel Static IPs only, on 5432, over TLS", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", { PubliclyAccessible: true });
    const ingress = Object.values(template.findResources("AWS::EC2::SecurityGroup"))
      .flatMap((r) => (r as { Properties: { SecurityGroupIngress?: { CidrIp: string; FromPort: number; ToPort: number }[] } }).Properties.SecurityGroupIngress ?? []);
    expect(ingress.map((i) => [i.CidrIp, i.FromPort, i.ToPort])).toEqual([
      ["203.0.113.10/32", 5432, 5432],
      ["203.0.113.11/32", 5432, 5432],
    ]);
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
    template.hasResourceProperties("AWS::RDS::DBParameterGroup", { Parameters: { "rds.force_ssl": "1" } });
  });

  it("admits nobody until the IPs are given, and refuses what is not an address", () => {
    const closed = synth([]).template;
    const ingress = Object.values(closed.findResources("AWS::EC2::SecurityGroup")).flatMap(
      (r) => (r as { Properties: { SecurityGroupIngress?: unknown[] } }).Properties.SecurityGroupIngress ?? [],
    );
    expect(ingress).toEqual([]);
    expect(() => synth(["0.0.0.0/0"])).toThrow(/not an IPv4 address/);
  });

  it("needs no NAT", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.resourceCountIs("AWS::EC2::Instance", 0);
  });

  it("gives the API a key that reaches the files bucket and nothing else", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy")).map((p) => JSON.stringify(p));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain(":s3:::markdown-studio-files-test");
    for (const action of ["s3:PutObject", "s3:PutObjectTagging", "s3:GetObject*", "s3:List*"]) expect(policies[0]).toContain(action);
    const resources = JSON.parse(policies[0]!).Properties.PolicyDocument.Statement.flatMap((s: { Resource: unknown }) => [s.Resource].flat());
    expect(JSON.stringify(resources)).not.toMatch(/"\*"/);
    // The secret half of the key is in Secrets Manager, never in the template's outputs.
    template.hasResource("AWS::SecretsManager::Secret", { DeletionPolicy: "Retain", Properties: Match.objectLike({ Description: Match.stringLikeRegexp("S3_ACCESS_KEY_ID") }) });
    expect(JSON.stringify(template.toJSON().Outputs)).not.toMatch(/SecretAccessKey/);
  });
});
