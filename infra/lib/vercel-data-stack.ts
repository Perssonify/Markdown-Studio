import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface VercelDataStackProps extends cdk.StackProps {
  /** The users'-files bucket (MarkdownStudioFiles). The API on Vercel reads and writes it. */
  filesBucketName: string;
  /**
   * The ONLY addresses that may connect to the database: the Vercel project's
   * Static IPs (its functions and builds leave Vercel from these). Empty: the
   * database accepts no connection at all.
   */
  allowedIps: string[];
}

/**
 * What Markdown Studio on Vercel keeps in AWS (the root vercel.json runs the
 * app itself): its PostgreSQL database, and the key its API uses for the
 * users'-files bucket.
 *
 * Vercel runs outside AWS, so the database has a public address — reachable
 * only from the IPs in `allowedIps` (the firewall admits nothing else) and
 * only over TLS (`rds.force_ssl`). Its own stack: the AWS-hosted app
 * (MarkdownStudio) and the files bucket (MarkdownStudioFiles) are untouched.
 */
export class VercelDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VercelDataStackProps) {
    super(scope, id, { terminationProtection: true, ...props });
    cdk.Tags.of(this).add("project", "markdown-studio");

    for (const ip of props.allowedIps) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`allowedIps: ${JSON.stringify(ip)} is not an IPv4 address`);
    }

    // Public subnets only: the database needs a public address, and nothing
    // here needs a NAT.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const dbSg = new ec2.SecurityGroup(this, "DatabaseSg", {
      vpc,
      // EC2 refuses an apostrophe here (the first deploy failed on one).
      description: "PostgreSQL from the Vercel project Static IPs only",
      allowAllOutbound: false,
    });
    for (const ip of props.allowedIps) dbSg.addIngressRule(ec2.Peer.ipv4(`${ip}/32`), ec2.Port.tcp(5432), "Vercel Static IP");

    const engine = rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.of("17.11", "17") });
    const parameterGroup = new rds.ParameterGroup(this, "Parameters", {
      engine,
      description: "Markdown Studio (Vercel): TLS required",
      parameters: { "rds.force_ssl": "1" },
    });

    // The password lives in its own secret, kept with the database: a retained
    // database whose credentials had been deleted could not be reached.
    const dbCredentials = new rds.DatabaseSecret(this, "DatabaseCredentials", {
      username: "markdown_studio",
      // Characters that would need escaping in a URL or a shell.
      excludeCharacters: " %+~`#$&*()|[]{}:;<>?!'/@\"\\",
    });
    dbCredentials.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const database = new rds.DatabaseInstance(this, "Database", {
      engine,
      // db.t3.micro: RDS no longer offers db.t4g.micro for PostgreSQL in
      // us-east-1 (Oct 2026 — the second deploy failed on it). Same price.
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [dbSg],
      parameterGroup,
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: "markdown_studio",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: true,
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: false,
      // CloudFormation NEVER deletes the database: not on a failed deploy's
      // rollback, not on a stack delete, not on a replacement. Removing a
      // database is a deliberate human act in the console.
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoMinorVersionUpgrade: true,
    });

    // The API on Vercel has no AWS role: it signs S3 requests (and the
    // browsers' presigned URLs) with this user's key, which can reach the
    // files bucket and nothing else. The key is kept in Secrets Manager.
    const apiUser = new iam.User(this, "ApiUser");
    s3.Bucket.fromBucketName(this, "Files", props.filesBucketName).grantReadWrite(apiUser);
    const apiKey = new iam.AccessKey(this, "ApiUserKey", { user: apiUser });
    const apiKeySecret = new secretsmanager.Secret(this, "ApiUserKeySecret", {
      description: "Markdown Studio API on Vercel: S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY",
      secretObjectValue: {
        accessKeyId: cdk.SecretValue.unsafePlainText(apiKey.accessKeyId),
        secretAccessKey: apiKey.secretAccessKey,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, "DatabaseEndpoint", { value: database.dbInstanceEndpointAddress, description: "The host in DATABASE_URL" });
    new cdk.CfnOutput(this, "DatabaseSecretArn", { value: dbCredentials.secretArn, description: "The database user's password" });
    new cdk.CfnOutput(this, "S3KeySecretArn", { value: apiKeySecret.secretArn, description: "S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY" });
  }
}
