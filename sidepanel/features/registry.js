/**
 * Feature loaders. Each feature module exports `createFeature(ctx)` returning:
 *
 *   {
 *     mount(container): Promise<void>,   // build UI into `container`
 *     unmount(): void,                   // tear down listeners / timers
 *     onScopeChange?(scope): void,
 *     onTabContextChange?(tabContext): void,
 *   }
 *
 * `ctx` is built in sidepanel.js: { getScope, getTabContext, refreshTabContext,
 * notify, windowId, sessionId }. Features are loaded lazily, so tools that
 * are not opened cost nothing.
 *
 * To add a tool: add its metadata to FEATURES in shared/constants.js, an icon
 * in components/icons.js, and a loader below.
 */

const loaders = {
  'color-find': () => import('./color-find/color-find.js'),
  'text-find': () => import('./text-find/text-find.js'),
  telephone: () => import('./telephone/telephone.js'),
  'link-href': () => import('./link-href/link-href.js'),
  'font-find': () => import('./font-find/font-find.js'),
  'width-text': () => import('./width-text/width-text.js'),
  'image-resolution': () => import('./image-resolution/image-resolution.js'),
  'official-image': () => import('./official-image/official-image.js'),
  'image-convert': () => import('./image-convert/image-convert.js'),
  'image-resize': () => import('./image-resize/image-resize.js'),
  'sns-checker': () => import('./sns-checker/sns-checker.js'),
  'remove-background': () => import('./remove-background/remove-background.js'),
  screenshot: () => import('./screenshot/screenshot.js'),
};

export const hasFeature = (id) => Object.prototype.hasOwnProperty.call(loaders, id);

export async function loadFeature(id, ctx) {
  if (!hasFeature(id)) throw new Error(`Feature "${id}" is not available yet.`);
  const module = await loaders[id]();
  return module.createFeature(ctx);
}
