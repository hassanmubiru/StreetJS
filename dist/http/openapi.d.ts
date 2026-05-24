export interface OpenApiRouteInput {
    method: string;
    path: string;
    summary?: string;
    description?: string;
    tags?: string[];
    responses?: Record<string, {
        description: string;
        schema?: unknown;
    }>;
}
export declare function generateOpenApi(routes: OpenApiRouteInput[]): object;
//# sourceMappingURL=openapi.d.ts.map