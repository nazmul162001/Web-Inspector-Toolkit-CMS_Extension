/**
 * Official Image library: the bundled icons shown in the panel.
 * `file` is the original file in ./library; the panel shows a 50×50
 * thumbnail and Download saves this file unchanged.
 */

export const OFFICIAL_IMAGES = Object.freeze([
  Object.freeze({ id: 'instagram', file: 'instagram.png', name: 'Instagram', brand: true }),
  Object.freeze({ id: 'line', file: 'line.png', name: 'LINE', brand: true }),
  Object.freeze({ id: 'facebook', file: 'facebook.png', name: 'Facebook', brand: true }),
  Object.freeze({ id: 'mail', file: 'mail.png', name: 'Mail', brand: false }),
  Object.freeze({ id: 'contact', file: 'contact.png', name: 'Contact', brand: false }),
  Object.freeze({ id: 'coming-soon', file: 'coming-soon.jpg', name: 'Coming Soon', brand: false }),
  Object.freeze({ id: 'coming-soon-wide', file: 'coming-soon-wide.jpg', name: 'Coming Soon (wide)', brand: false }),
  Object.freeze({ id: 'image-coming-soon', file: 'image-coming-soon.jpg', name: 'Image coming soon', brand: false }),
  Object.freeze({ id: 'uber-eats', file: 'uber-eats.png', name: 'Uber Eats', brand: true }),
  Object.freeze({ id: 'delivery', file: 'delivery.png', name: 'Delivery', brand: false }),
  Object.freeze({ id: 'line-qr', file: 'line-qr.png', name: 'LINE QR', brand: true }),
  Object.freeze({ id: 'sample', file: 'sample.jpg', name: 'Sample', brand: false }),
  Object.freeze({ id: 'sample-portrait', file: 'sample-portrait.png', name: 'Sample (portrait)', brand: false }),
]);

export function officialImageUrl(file) {
  return new URL(`./library/${file}`, import.meta.url).href;
}
