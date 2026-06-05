export type CloudPlatform = 'kubernetes' | 'cloudrun' | 'ecs' | 'nomad';
export interface DeployConfig {
    name: string;
    image: string;
    port: number;
    replicas?: number;
    cpu?: string;
    memory?: string;
    env?: Record<string, string>;
}
/**
 * Generate a deployment manifest YAML/JSON string for the given cloud platform.
 */
export declare function generateManifest(platform: CloudPlatform, config: DeployConfig): string;
//# sourceMappingURL=deployment.d.ts.map