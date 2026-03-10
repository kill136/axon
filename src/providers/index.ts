/**
 * Cloud Provider Support
 * AWS Bedrock, Google Vertex AI, and Anthropic API
 */

import Anthropic from '@anthropic-ai/sdk';
import * as https from 'https';
import * as crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);


// Export Vertex AI client
export * from './vertex.js';
export type ProviderType = 'anthropic' | 'bedrock' | 'vertex' | 'foundry';

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  region?: string;
  projectId?: string;
  baseUrl?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  model?: string;
  // Bedrock-specific
  awsProfile?: string;
  crossRegionInference?: boolean;
}

/**
 * Parsed AWS Bedrock Model ARN
 * Format: arn:aws:bedrock:region:account-id:model/model-id
 * or: arn:aws:bedrock:region::foundation-model/model-id
 */
export interface BedrockModelArn {
  region: string;
  accountId?: string;
  modelId: string;
  isFoundationModel: boolean;
  isCrossRegion: boolean;
}

export interface ProviderInfo {
  type: ProviderType;
  name: string;
  region?: string;
  model: string;
  baseUrl: string;
}

/**
 * Parse AWS Bedrock Model ARN
 * Supports formats:
 * - arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0
 * - arn:aws:bedrock:us-west-2:123456789012:provisioned-model/my-model
 * - anthropic.claude-3-5-sonnet-20241022-v2:0 (plain model ID)
 */
export function parseBedrockModelArn(input: string): BedrockModelArn | null {
  // Plain model ID (no ARN)
  if (!input.startsWith('arn:')) {
    return {
      region: '',
      modelId: input,
      isFoundationModel: true,
      isCrossRegion: false,
    };
  }

  // Parse ARN format: arn:aws:bedrock:region:account-id:resource-type/resource-id
  const arnPattern = /^arn:aws:bedrock:([^:]+):([^:]*):([^/]+)\/(.+)$/;
  const match = input.match(arnPattern);

  if (!match) {
    return null;
  }

  const [, region, accountId, resourceType, resourceId] = match;

  return {
    region,
    accountId: accountId || undefined,
    modelId: resourceId,
    isFoundationModel: resourceType === 'foundation-model',
    isCrossRegion: resourceType === 'inference-profile',
  };
}

/**
 * Get AWS credentials from environment with fallbacks
 */
function getAwsCredentials(): {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  profile?: string;
} {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    profile: process.env.AWS_PROFILE,
  };
}

/**
 * Detect provider from environment
 */
export function detectProvider(): ProviderConfig {
  // 从 settings.json 读取 provider 配置
  let useBedrock = false;
  let useVertex = false;
  try {
    const { configManager } = require('../config/index.js');
    const config = configManager.getAll();
    useBedrock = config.apiProvider === 'bedrock' || config.useBedrock === true;
    useVertex = config.apiProvider === 'vertex' || config.useVertex === true;
  } catch {}

  // Check for Bedrock
  if (useBedrock || process.env.AWS_BEDROCK_MODEL) {
    const credentials = getAwsCredentials();
    const modelInput = process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    const arnInfo = parseBedrockModelArn(modelInput);

    // Determine region from ARN or environment
    const region = arnInfo?.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

    return {
      type: 'bedrock',
      region,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      awsProfile: credentials.profile,
      model: arnInfo?.modelId || modelInput,
      baseUrl: process.env.ANTHROPIC_BEDROCK_BASE_URL,
      crossRegionInference: arnInfo?.isCrossRegion || false,
    };
  }

  // Check for Vertex
  if (useVertex || process.env.ANTHROPIC_VERTEX_PROJECT_ID) {
    return {
      type: 'vertex',
      projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
      region: process.env.CLOUD_ML_REGION || 'us-central1',
      baseUrl: process.env.ANTHROPIC_VERTEX_BASE_URL,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-v2@20241022',
    };
  }

  // Check for Foundry
  if (process.env.AXON_USE_FOUNDRY === 'true' || process.env.ANTHROPIC_FOUNDRY_API_KEY) {
    return {
      type: 'foundry',
      apiKey: process.env.ANTHROPIC_FOUNDRY_API_KEY,
      baseUrl: process.env.ANTHROPIC_FOUNDRY_BASE_URL,
      model: process.env.ANTHROPIC_MODEL,
    };
  }

  // Default to Anthropic
  return {
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  };
}

/**
 * Get provider info for display
 */
export function getProviderInfo(config: ProviderConfig): ProviderInfo {
  switch (config.type) {
    case 'bedrock':
      const modelId = config.model || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
      const arnInfo = parseBedrockModelArn(modelId);
      const displayName = config.crossRegionInference
        ? 'AWS Bedrock (Cross-Region)'
        : 'AWS Bedrock';

      return {
        type: 'bedrock',
        name: displayName,
        region: config.region,
        model: arnInfo?.modelId || modelId,
        baseUrl: config.baseUrl || buildBedrockEndpoint(config),
      };
    case 'vertex':
      return {
        type: 'vertex',
        name: 'Google Vertex AI',
        region: config.region,
        model: config.model || 'claude-3-5-sonnet-v2@20241022',
        baseUrl: config.baseUrl || `https://${config.region}-aiplatform.googleapis.com`,
      };
    case 'foundry':
      return {
        type: 'foundry',
        name: 'Anthropic Foundry',
        model: config.model || 'claude-sonnet-4-20250514',
        baseUrl: config.baseUrl || 'https://foundry.anthropic.com',
      };
    default:
      return {
        type: 'anthropic',
        name: 'Anthropic API',
        model: config.model || 'claude-sonnet-4-20250514',
        baseUrl: config.baseUrl || 'https://api.anthropic.com',
      };
  }
}

/**
 * 获取 Anthropic API 配置（支持环境变量回退）
 */
function getAnthropicApiConfig(config: ProviderConfig): { apiKey: string; baseURL: string } {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
  const baseURL = config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  
  if (!apiKey) {
    throw new Error(
      'Anthropic API key is required. Set ANTHROPIC_API_KEY or AXON_API_KEY environment variable, or provide apiKey in config.'
    );
  }
  
  return { apiKey, baseURL };
}

/**
 * Create Anthropic client based on provider
 * 支持从配置中读取自定义 API Key 和 Base URL
 */
export function createClient(config?: ProviderConfig): Anthropic {
  const providerConfig = config || detectProvider();

  switch (providerConfig.type) {
    case 'bedrock':
      return createBedrockClient(providerConfig);
      
    case 'vertex':
      return createVertexClient(providerConfig);
      
    case 'foundry':
      return createFoundryClient(providerConfig);
      
    case 'anthropic':
    default:
      // Anthropic 官方 API 或未知类型都使用官方客户端
      // 优先使用配置中的 API Key 和 Base URL，支持环境变量回退
      const { apiKey, baseURL } = getAnthropicApiConfig(providerConfig);
      return new Anthropic({ apiKey, baseURL });
  }
}

/**
 * Create AWS Bedrock client
 * Supports:
 * - @anthropic-ai/bedrock-sdk (recommended)
 * - Cross-region inference
 * - Custom endpoints
 * - AWS credentials from environment or config
 */
function createBedrockClient(config: ProviderConfig): Anthropic {
  // Validate AWS credentials
  const credentials = getAwsCredentials();
  const accessKeyId = config.accessKeyId || credentials.accessKeyId;
  const secretAccessKey = config.secretAccessKey || credentials.secretAccessKey;
  const sessionToken = config.sessionToken || credentials.sessionToken;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS credentials are required for Bedrock. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.'
    );
  }

  if (!config.region) {
    throw new Error(
      'AWS region is required for Bedrock. Set AWS_REGION or AWS_DEFAULT_REGION environment variable.'
    );
  }

  // Try using official Bedrock SDK first
  try {
    const AnthropicBedrock = require('@anthropic-ai/bedrock-sdk').default;

    const clientConfig: any = {
      awsAccessKey: accessKeyId,
      awsSecretKey: secretAccessKey,
      awsRegion: config.region,
    };

    // Add session token if present
    if (sessionToken) {
      clientConfig.awsSessionToken = sessionToken;
    }

    // Add custom endpoint if specified
    if (config.baseUrl) {
      clientConfig.baseURL = config.baseUrl;
    }

    const client = new AnthropicBedrock(clientConfig);

    // Log successful initialization (without exposing credentials)
    if (process.env.DEBUG) {
      console.log(`[Bedrock] Initialized with region: ${config.region}, model: ${config.model}`);
      if (config.crossRegionInference) {
        console.log('[Bedrock] Cross-region inference enabled');
      }
    }

    return client;
  } catch (error) {
    // Fallback: warn about missing SDK
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Cannot find module')) {
      console.warn(
        '[Bedrock] @anthropic-ai/bedrock-sdk not installed. Install it with: npm install @anthropic-ai/bedrock-sdk'
      );
      console.warn('[Bedrock] Falling back to manual AWS signing (limited functionality)');
    } else {
      console.warn(`[Bedrock] Failed to initialize Bedrock SDK: ${errorMessage}`);
    }

    // Create standard Anthropic client with Bedrock endpoint
    // Note: This requires manual request signing which may not work for all cases
    const baseURL = config.baseUrl || buildBedrockEndpoint(config);

    if (process.env.DEBUG) {
      console.log(`[Bedrock] Using endpoint: ${baseURL}`);
    }

    return new Anthropic({
      apiKey: accessKeyId, // Used as placeholder, actual auth via signing
      baseURL,
    });
  }
}

/**
 * Build Bedrock Runtime API endpoint
 */
function buildBedrockEndpoint(config: ProviderConfig): string {
  const region = config.region || 'us-east-1';

  // Cross-region inference uses a different endpoint
  if (config.crossRegionInference) {
    return `https://bedrock-runtime.${region}.amazonaws.com/v1/inference-profiles`;
  }

  // Standard Bedrock Runtime endpoint
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

/**
 * Create Google Vertex client
 */
function createVertexClient(config: ProviderConfig): Anthropic {
  // Use AnthropicVertex if available
  try {
    const AnthropicVertex = require('@anthropic-ai/vertex-sdk').default;
    return new AnthropicVertex({
      projectId: config.projectId,
      region: config.region,
    });
  } catch {
    // Fallback to standard client
    console.warn('Vertex SDK not found, using standard client');
    return new Anthropic({
      apiKey: config.apiKey || 'vertex',
      baseURL: config.baseUrl,
    });
  }
}

/**
 * Create Foundry client
 */
function createFoundryClient(config: ProviderConfig): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || 'https://foundry.anthropic.com',
  });
}

/**
 * AWS Signature V4 helper (for manual Bedrock requests)
 */
export function signAWSRequest(
  method: string,
  url: string,
  body: string,
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
    service: string;
  }
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const canonicalUri = parsedUrl.pathname;
  const canonicalQueryString = parsedUrl.searchParams.toString();

  // Hash the body
  const payloadHash = crypto
    .createHash('sha256')
    .update(body)
    .digest('hex');

  // Create canonical headers
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    ...(credentials.sessionToken ? [`x-amz-security-token:${credentials.sessionToken}`] : []),
  ].join('\n') + '\n';

  const signedHeaders = credentials.sessionToken
    ? 'host;x-amz-date;x-amz-security-token'
    : 'host;x-amz-date';

  // Create canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Calculate signature
  const getSignatureKey = (key: string, date: string, region: string, service: string) => {
    const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(date).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  };

  const signingKey = getSignatureKey(
    credentials.secretAccessKey,
    dateStamp,
    credentials.region,
    credentials.service
  );

  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');

  // Create authorization header
  const authorization = [
    `${algorithm} Credential=${credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  const headers: Record<string, string> = {
    Authorization: authorization,
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
  };

  if (credentials.sessionToken) {
    headers['X-Amz-Security-Token'] = credentials.sessionToken;
  }

  return headers;
}

/**
 * Model mapping for different providers
 */
export const MODEL_MAPPING: Record<ProviderType, Record<string, string>> = {
  anthropic: {
    'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-opus': 'claude-3-opus-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307',
    'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  },
  bedrock: {
    'claude-sonnet-4-20250514': 'anthropic.claude-sonnet-4-20250514-v1:0',
    'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',
    'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
    'claude-3-5-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
  },
  vertex: {
    'claude-sonnet-4-20250514': 'claude-sonnet-4@20250514',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-v2@20241022',
    'claude-3-opus': 'claude-3-opus@20240229',
    'claude-3-haiku': 'claude-3-haiku@20240307',
    'claude-3-5-haiku': 'claude-3-5-haiku@20241022',
  },
  foundry: {
    'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-opus': 'claude-3-opus-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307',
    'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  },
};

/**
 * Get model ID for provider
 */
export function getModelForProvider(model: string, provider: ProviderType): string {
  const mapping = MODEL_MAPPING[provider];
  return mapping[model] || model;
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(config: ProviderConfig): {
  valid: boolean;
  errors: string[];
  warnings?: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (config.type) {
    case 'bedrock':
      // Validate region
      if (!config.region) {
        errors.push('AWS region is required for Bedrock (set AWS_REGION or AWS_DEFAULT_REGION)');
      } else {
        // Check if region is valid AWS region format
        const validRegionPattern = /^[a-z]{2}-[a-z]+-\d{1}$/;
        if (!validRegionPattern.test(config.region)) {
          warnings.push(
            `AWS region "${config.region}" may not be a valid format. Expected format: us-east-1, eu-west-1, etc.`
          );
        }
      }

      // Validate credentials
      const credentials = getAwsCredentials();
      const accessKeyId = config.accessKeyId || credentials.accessKeyId;
      const secretAccessKey = config.secretAccessKey || credentials.secretAccessKey;

      if (!accessKeyId) {
        errors.push(
          'AWS access key ID is required for Bedrock (set AWS_ACCESS_KEY_ID environment variable)'
        );
      } else if (accessKeyId.length < 16) {
        errors.push('AWS access key ID appears to be invalid (too short)');
      }

      if (!secretAccessKey) {
        errors.push(
          'AWS secret access key is required for Bedrock (set AWS_SECRET_ACCESS_KEY environment variable)'
        );
      } else if (secretAccessKey.length < 40) {
        errors.push('AWS secret access key appears to be invalid (too short)');
      }

      // Validate model if provided
      if (config.model) {
        const arnInfo = parseBedrockModelArn(config.model);
        if (!arnInfo) {
          errors.push(`Invalid Bedrock model ARN or ID: ${config.model}`);
        } else if (arnInfo.region && arnInfo.region !== config.region && !config.crossRegionInference) {
          warnings.push(
            `Model ARN region (${arnInfo.region}) differs from config region (${config.region}). Consider enabling cross-region inference.`
          );
        }
      }

      // Check for Bedrock SDK
      try {
        require.resolve('@anthropic-ai/bedrock-sdk');
      } catch {
        warnings.push(
          'Bedrock SDK (@anthropic-ai/bedrock-sdk) not found. Install it for full functionality: npm install @anthropic-ai/bedrock-sdk'
        );
      }

      break;

    case 'vertex':
      if (!config.projectId) {
        errors.push('Google Cloud project ID is required for Vertex');
      }
      if (!config.region) {
        errors.push('Google Cloud region is required for Vertex');
      }
      break;

    case 'foundry':
      if (!config.apiKey) {
        errors.push('API key is required for Foundry');
      }
      break;

    default:
      if (!config.apiKey && !process.env.ANTHROPIC_API_KEY) {
        errors.push('API key is required for Anthropic');
      }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Get Bedrock model ID from common aliases
 * Supports both short names and full Bedrock model IDs
 */
export function getBedrockModelId(modelAlias: string): string {
  const modelMap: Record<string, string> = {
    // Sonnet 4
    'sonnet-4': 'anthropic.claude-sonnet-4-20250514-v1:0',
    'claude-sonnet-4': 'anthropic.claude-sonnet-4-20250514-v1:0',
    'claude-sonnet-4-20250514': 'anthropic.claude-sonnet-4-20250514-v1:0',

    // Sonnet 3.5 V2
    sonnet: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'sonnet-3.5': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'claude-3-5-sonnet-v2': 'anthropic.claude-3-5-sonnet-20241022-v2:0',

    // Opus 3
    opus: 'anthropic.claude-3-opus-20240229-v1:0',
    'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',

    // Haiku 3
    haiku: 'anthropic.claude-3-haiku-20240307-v1:0',
    'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',

    // Haiku 3.5
    'haiku-3.5': 'anthropic.claude-3-5-haiku-20241022-v1:0',
    'claude-3-5-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
  };

  // Return mapped model or original if already a full ID
  return modelMap[modelAlias.toLowerCase()] || modelAlias;
}

/**
 * List available Bedrock models for a region
 */
export function getAvailableBedrockModels(region?: string): string[] {
  return [
    'anthropic.claude-sonnet-4-20250514-v1:0',
    'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'anthropic.claude-3-5-haiku-20241022-v1:0',
    'anthropic.claude-3-opus-20240229-v1:0',
    'anthropic.claude-3-haiku-20240307-v1:0',
  ];
}

/**
 * Create Bedrock model ARN
 */
export function createBedrockModelArn(
  modelId: string,
  region: string,
  accountId?: string,
  isProvisionedModel: boolean = false
): string {
  const resourceType = isProvisionedModel ? 'provisioned-model' : 'foundation-model';
  const account = accountId || '';

  return `arn:aws:bedrock:${region}:${account}:${resourceType}/${modelId}`;
}

/**
 * Test Bedrock credentials
 */
export async function testBedrockCredentials(
  config: ProviderConfig
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = createBedrockClient(config);

    // Try a minimal API call to verify credentials
    // Note: This is a placeholder - actual implementation would need proper Bedrock API call
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(type: ProviderType): string {
  switch (type) {
    case 'bedrock':
      return 'AWS Bedrock';
    case 'vertex':
      return 'Google Vertex AI';
    case 'foundry':
      return 'Anthropic Foundry';
    default:
      return 'Anthropic API';
  }
}

/**
 * Bedrock error handler
 * Provides user-friendly error messages for common Bedrock issues
 */
export function handleBedrockError(error: any): string {
  const errorMessage = error.message || String(error);

  // Common AWS error patterns
  if (errorMessage.includes('InvalidSignatureException') || errorMessage.includes('SignatureDoesNotMatch')) {
    return 'AWS credentials are invalid. Please check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.';
  }

  if (errorMessage.includes('UnrecognizedClientException')) {
    return 'AWS credentials are not recognized. Please verify your AWS access key ID.';
  }

  if (errorMessage.includes('AccessDeniedException') || errorMessage.includes('UnauthorizedOperation')) {
    return 'AWS credentials lack permission to access Bedrock. Ensure your IAM role/user has bedrock:InvokeModel permission.';
  }

  if (errorMessage.includes('ResourceNotFoundException') || errorMessage.includes('ModelNotFound')) {
    return 'The specified Bedrock model was not found. Check the model ID and ensure it\'s available in your region.';
  }

  if (errorMessage.includes('ThrottlingException') || errorMessage.includes('TooManyRequestsException')) {
    return 'Bedrock API rate limit exceeded. Please wait and try again.';
  }

  if (errorMessage.includes('ServiceUnavailableException')) {
    return 'Bedrock service is temporarily unavailable. Please try again later.';
  }

  if (errorMessage.includes('ValidationException')) {
    return 'Invalid request to Bedrock API. Check your model parameters and input format.';
  }

  if (errorMessage.includes('ExpiredTokenException')) {
    return 'AWS session token has expired. Please refresh your credentials.';
  }

  // Return original error if no pattern matches
  return `Bedrock error: ${errorMessage}`;
}

/**
 * Get Bedrock service endpoints for all regions
 */
export function getBedrockRegions(): Array<{
  region: string;
  name: string;
  endpoint: string;
}> {
  const regions = [
    { code: 'us-east-1', name: 'US East (N. Virginia)' },
    { code: 'us-west-2', name: 'US West (Oregon)' },
    { code: 'eu-west-1', name: 'Europe (Ireland)' },
    { code: 'eu-west-3', name: 'Europe (Paris)' },
    { code: 'eu-central-1', name: 'Europe (Frankfurt)' },
    { code: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)' },
    { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
    { code: 'ap-southeast-2', name: 'Asia Pacific (Sydney)' },
  ];

  return regions.map((r) => ({
    region: r.code,
    name: r.name,
    endpoint: `https://bedrock-runtime.${r.code}.amazonaws.com`,
  }));
}

/**
 * Format Bedrock configuration for display
 */
export function formatBedrockConfig(config: ProviderConfig): string {
  const parts: string[] = [];

  parts.push(`Provider: AWS Bedrock`);
  parts.push(`Region: ${config.region || 'not set'}`);

  if (config.model) {
    const arnInfo = parseBedrockModelArn(config.model);
    if (arnInfo) {
      parts.push(`Model: ${arnInfo.modelId}`);
      if (arnInfo.isFoundationModel) {
        parts.push(`Type: Foundation Model`);
      } else if (arnInfo.isCrossRegion) {
        parts.push(`Type: Cross-Region Inference Profile`);
      } else {
        parts.push(`Type: Provisioned Model`);
      }
    } else {
      parts.push(`Model: ${config.model}`);
    }
  }

  if (config.crossRegionInference) {
    parts.push(`Cross-Region Inference: Enabled`);
  }

  const credentials = getAwsCredentials();
  const hasAccessKey = !!(config.accessKeyId || credentials.accessKeyId);
  const hasSecretKey = !!(config.secretAccessKey || credentials.secretAccessKey);
  const hasSessionToken = !!(config.sessionToken || credentials.sessionToken);

  parts.push(`Credentials: ${hasAccessKey && hasSecretKey ? 'Configured' : 'Missing'}`);
  if (hasSessionToken) {
    parts.push(`Session Token: Present`);
  }

  if (config.baseUrl) {
    parts.push(`Custom Endpoint: ${config.baseUrl}`);
  }

  return parts.join('\n');
}
