// Global augmentation for reflect-metadata polyfill
declare namespace Reflect {
  function defineMetadata(metadataKey: unknown, metadataValue: unknown, target: object): void;
  function defineMetadata(metadataKey: unknown, metadataValue: unknown, target: object, propertyKey: string | symbol): void;
  function getMetadata(metadataKey: unknown, target: object): unknown;
  function getMetadata(metadataKey: unknown, target: object, propertyKey: string | symbol): unknown;
  function hasMetadata(metadataKey: unknown, target: object): boolean;
  function metadata(metadataKey: unknown, metadataValue: unknown): ClassDecorator & PropertyDecorator;
}
