export interface FieldDef {
    name: string;
    type: string;
    number: number;
    repeated: boolean;
}
export interface MessageDefinition {
    name: string;
    fields: FieldDef[];
}
export interface RpcDefinition {
    name: string;
    requestType: string;
    responseType: string;
    clientStreaming: boolean;
    serverStreaming: boolean;
}
export interface ServiceDefinition {
    name: string;
    rpcs: RpcDefinition[];
}
export interface ProtoAst {
    packageName: string | null;
    messages: MessageDefinition[];
    services: ServiceDefinition[];
}
/** Parse a `.proto` source string into a {@link ProtoAst}. */
export declare function parseProto(src: string): ProtoAst;
/** Read and parse a `.proto` file from disk. */
export declare function parseProtoFile(path: string): Promise<ProtoAst>;
/** Map protobuf scalar types to TypeScript types for codegen. */
export declare function protoTypeToTs(type: string): string;
/** Generate TypeScript interface + service-handler typings from a ProtoAst. */
export declare function generateGrpcTypes(ast: ProtoAst): string;
//# sourceMappingURL=proto-parser.d.ts.map