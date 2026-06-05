export interface PluginInstallerOptions {
    registryUrl?: string;
    pluginsDir: string;
    publicKey?: string;
}
export declare class PluginInstaller {
    private readonly registryUrl;
    private readonly pluginsDir;
    private readonly publicKey;
    constructor(opts: PluginInstallerOptions);
    /**
     * Installs a plugin by name and version.
     * Steps:
     *   1. Fetch manifest from registry
     *   2. Verify Ed25519 signature (if public key is configured)
     *   3. Download tarball
     *   4. Verify SHA-256 checksum
     *   5. Extract to pluginsDir/<name>@<version>/
     */
    install(name: string, version: string): Promise<void>;
    private _fetchManifest;
    private _verifySignature;
    private _fetchText;
    private _downloadBuffer;
    /**
     * Minimal tar.gz extraction using Node.js built-ins.
     * Supports uncompressed and gzip-compressed archives.
     */
    private _extractTarball;
}
//# sourceMappingURL=registry.d.ts.map