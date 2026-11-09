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

  Object.freeze({ id: 'tiktok', file: 'tiktok.png', name: 'TikTok', brand: true }),
  Object.freeze({ id: 'tiktok-outline', file: 'tiktok-outline.png', name: 'TikTok (outline)', brand: true }),
  Object.freeze({ id: 'instagram-solid', file: 'instagram-solid.png', name: 'Instagram (solid)', brand: true }),
  Object.freeze({ id: 'instagram-outline', file: 'instagram-outline.png', name: 'Instagram (outline)', brand: true }),
  Object.freeze({ id: 'instagram-contrast', file: 'instagram-contrast.png', name: 'Instagram (contrast)', brand: true }),
  Object.freeze({ id: 'instagram-pink', file: 'instagram-pink.png', name: 'Instagram (pink)', brand: true }),
  Object.freeze({ id: 'instagram-green', file: 'instagram-green.png', name: 'Instagram (green)', brand: true }),
  Object.freeze({ id: 'line-solid', file: 'line-solid.png', name: 'LINE (solid)', brand: true }),
  Object.freeze({ id: 'google-maps', file: 'google-maps.png', name: 'Google Maps', brand: true }),

  Object.freeze({ id: 'people', file: 'people.png', name: 'People', brand: false }),
  Object.freeze({ id: 'phone', file: 'phone.png', name: 'Phone', brand: false }),
  Object.freeze({ id: 'phone-green', file: 'phone-green.png', name: 'Phone (green)', brand: false }),
  Object.freeze({ id: 'phone-black', file: 'phone-black.png', name: 'Phone (black)', brand: false }),
  Object.freeze({ id: 'phone-handset', file: 'phone-handset.png', name: 'Phone (handset)', brand: false }),
  Object.freeze({ id: 'phone-24h', file: 'phone-24h.png', name: 'Phone 24h', brand: false }),
  Object.freeze({ id: 'phone-24h-outline', file: 'phone-24h-outline.png', name: 'Phone 24h (outline)', brand: false }),
  Object.freeze({ id: 'mobile', file: 'mobile.png', name: 'Mobile', brand: false }),
  Object.freeze({ id: 'chat', file: 'chat.png', name: 'Chat', brand: false }),
  Object.freeze({ id: 'chat-green', file: 'chat-green.png', name: 'Chat (green)', brand: false }),
  Object.freeze({ id: 'mail-solid', file: 'mail-solid.webp', name: 'Mail (solid)', brand: false }),
  Object.freeze({ id: 'mail-filled', file: 'mail-filled.png', name: 'Mail (filled)', brand: false }),
  Object.freeze({ id: 'mail-outline', file: 'mail-outline.png', name: 'Mail (outline)', brand: false }),
  Object.freeze({ id: 'mail-open', file: 'mail-open.png', name: 'Mail (open)', brand: false }),
  Object.freeze({ id: 'paper-plane', file: 'paper-plane.png', name: 'Paper plane', brand: false }),
  Object.freeze({ id: 'new-tab', file: 'new-tab.png', name: 'New tab', brand: false }),

  Object.freeze({ id: 'home-orange', file: 'home-orange.png', name: 'Home (orange)', brand: false }),
  Object.freeze({ id: 'home-outline', file: 'home-outline.png', name: 'Home', brand: false }),
  Object.freeze({ id: 'home-filled', file: 'home-filled.png', name: 'Home (filled)', brand: false }),
  Object.freeze({ id: 'home-black', file: 'home-black.png', name: 'Home (black)', brand: false }),
  Object.freeze({ id: 'home-hp', file: 'home-hp.png', name: 'Home HP', brand: false }),

  Object.freeze({ id: 'calendar', file: 'calendar.png', name: 'Calendar', brand: false }),
  Object.freeze({ id: 'calendar-line', file: 'calendar-line.png', name: 'Calendar (line)', brand: false }),
  Object.freeze({ id: 'calendar-alt', file: 'calendar-alt.webp', name: 'Calendar (alt)', brand: false }),
  Object.freeze({ id: 'calendar-green', file: 'calendar-green.png', name: 'Calendar (green)', brand: false }),
  Object.freeze({ id: 'calendar-hover', file: 'calendar-hover.webp', name: 'Calendar (hover)', brand: false }),
  Object.freeze({ id: 'clock', file: 'clock.png', name: 'Clock', brand: false }),

  Object.freeze({ id: 'cart', file: 'cart.png', name: 'Cart', brand: false }),
  Object.freeze({ id: 'cart-outline', file: 'cart-outline.png', name: 'Cart (outline)', brand: false }),
  Object.freeze({ id: 'cart-fast', file: 'cart-fast.png', name: 'Cart (fast)', brand: false }),
  Object.freeze({ id: 'cart-black', file: 'cart-black.png', name: 'Cart (black)', brand: false }),
  Object.freeze({ id: 'dress', file: 'dress.png', name: 'Dress', brand: false }),
  Object.freeze({ id: 'beauty', file: 'beauty.png', name: 'Beauty', brand: false }),

  Object.freeze({ id: 'check', file: 'check.png', name: 'Check', brand: false }),
  Object.freeze({ id: 'check-circle', file: 'check-circle.png', name: 'Check circle', brand: false }),
  Object.freeze({ id: 'play', file: 'play.png', name: 'Play', brand: false }),
  Object.freeze({ id: 'arrow-next', file: 'arrow-next.png', name: 'Next', brand: false }),
  Object.freeze({ id: 'arrow-prev', file: 'arrow-prev.png', name: 'Previous', brand: false }),
  Object.freeze({ id: 'blood-test', file: 'blood-test.png', name: 'Blood test', brand: false }),
  Object.freeze({ id: 'blood-test-green', file: 'blood-test-green.png', name: 'Blood test (green)', brand: false }),
]);

export function officialImageUrl(file) {
  return new URL(`./library/${file}`, import.meta.url).href;
}
