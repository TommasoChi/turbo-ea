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

/**
 * `bpmn-js-color-picker` ships no type declarations. It exports a single didi
 * module descriptor, which is exactly what `Modeler`'s `additionalModules`
 * expects — declaring it as `ModuleDeclaration` keeps the call site fully
 * type-checked instead of falling back to `any`. See BpmnModeler.tsx (#910).
 */
declare module "bpmn-js-color-picker" {
  const colorPickerModule: import("didi").ModuleDeclaration;
  export default colorPickerModule;
}
