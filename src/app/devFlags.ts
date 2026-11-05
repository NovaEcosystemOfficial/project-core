/**
 * Renderer-only development flags.
 * `import.meta.env.DEV` is true under Vite dev server and false in production builds
 * (tree-shaken), so preview controls never ship to packaged Electron builds.
 */
export function isRendererDevBuild(): boolean {
  return import.meta.env.DEV === true;
}
