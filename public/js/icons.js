// Inline SVG icons shared by the storefront and the dashboard.
window.ICONS = {
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.3H7.4V14h2.7v8h3.4z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.2-.3-.2-.6-.4z"/></svg>',
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-1.8-2.5V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.4 7.4 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.8 15V9l5.8 3-5.8 3z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

window.escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Builds the list of social links (only the ones that are filled in).
window.socialLinks = (social = {}) => {
  const links = [];
  if (social.whatsapp) links.push({ key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${social.whatsapp}` });
  if (social.instagram) links.push({ key: 'instagram', label: 'Instagram', href: social.instagram });
  if (social.facebook) links.push({ key: 'facebook', label: 'Facebook', href: social.facebook });
  if (social.tiktok) links.push({ key: 'tiktok', label: 'TikTok', href: social.tiktok });
  if (social.youtube) links.push({ key: 'youtube', label: 'YouTube', href: social.youtube });
  if (social.email) links.push({ key: 'email', label: 'Email', href: `mailto:${social.email}` });
  if (social.phone) links.push({ key: 'phone', label: 'Call', href: `tel:${social.phone}` });
  return links;
};

// Makes a picture smaller (max 1600px, JPEG) before uploading, so it uploads fast and stays
// under the hosting's upload limit. GIFs and pictures that are already small are sent as they are.
window.shrinkImage = (file, maxSize = 1600) =>
  new Promise((resolve) => {
    if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent PNGs get a white background in JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file),
        'image/jpeg',
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });

// Ready-made colours for the product editor; the store shows a small swatch next to these names.
window.COLOR_SWATCHES = {
  Black: '#111111', White: '#ffffff', 'Off White': '#f4f0e6', Cream: '#f3e5c8', Beige: '#d9c3a0', Skin: '#e8c4a8',
  Brown: '#7a4b2a', Camel: '#b98a55', Mustard: '#d4a017', Yellow: '#f2d23c', Orange: '#e87a2c', Rust: '#b7472a',
  Red: '#c62828', Maroon: '#6d1a2a', 'Tea Pink': '#e8b4b8', Pink: '#e86a9a', Magenta: '#c2185b', Purple: '#6a3d9a',
  Lilac: '#b9a3d6', Navy: '#1f2a52', Blue: '#2f6fd1', 'Sky Blue': '#8cc7ee', 'Ferozi': '#1fb5ad', Teal: '#12706e',
  Green: '#2e7d32', 'Bottle Green': '#0f4d3a', Mint: '#a8dcc3', Olive: '#6b7a3a', Grey: '#8c8c8c', Charcoal: '#3a3a3a',
  Silver: '#c7c9cc', Gold: '#c9a227', Peach: '#f6b99a', 'Multi Colour': 'conic-gradient(#e53935,#fdd835,#43a047,#1e88e5,#8e24aa,#e53935)',
};

// CSS background for a colour name (case does not matter), or '' if it is not a known colour.
window.colorSwatch = (name) => {
  const key = Object.keys(window.COLOR_SWATCHES).find((k) => k.toLowerCase() === String(name).trim().toLowerCase());
  return key ? window.COLOR_SWATCHES[key] : '';
};

// Turns the owner's page text into safe HTML: paragraphs, line breaks, "•"/"-" bullet lines,
// and "a | b | c" lines as a table (used by the size guide).
window.richText = (text) => {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) return '';
      if (lines.every((l) => l.includes('|'))) {
        const rows = lines.map((l) => l.split('|').map((c) => escapeHtml(c.trim())));
        return `<div class="table-wrap"><table><thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows
          .slice(1)
          .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`;
      }
      if (lines.every((l) => /^\s*[•\-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^\s*[•\-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
    })
    .join('');
};
