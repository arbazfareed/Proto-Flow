// jsdom ships no type declarations. Only the small part the published-preview test uses is declared.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { runScripts?: "dangerously" | "outside-only"; pretendToBeVisual?: boolean });
    readonly window: Window & typeof globalThis;
  }
}
