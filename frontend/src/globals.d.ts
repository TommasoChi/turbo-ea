declare const __APP_VERSION__: string;

// No published types for this small CJS module (see extensionHost.tsx's
// loadDocxTemplater). Typed narrowly to what core actually constructs it
// with — a class whose instances are opaque docxtemplater modules.
declare module "docxtemplater-image" {
  interface ImageModuleOptions {
    getImage: (tagValue: string, tagName: string) => Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;
    getSize: (
      img: Uint8Array | ArrayBuffer,
      tagValue: string,
      tagName: string,
    ) => [number, number] | Promise<[number, number]>;
    centered?: boolean;
    fileType?: "docx" | "pptx";
  }
  export default class ImageModule {
    constructor(options: ImageModuleOptions);
  }
}
