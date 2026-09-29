// Store pages the owner edits from the dashboard (Pages tab): About us, policies, Earn with us,
// the size guide and the shop location. Starter text is filled in until the owner changes it.

const PAGE_KEYS = ['about', 'shipping', 'returns', 'terms', 'earn'];

const DEFAULT_CONTENT = {
  pages: {
    about: {
      title: 'About us',
      text: 'We are a family-run clothing store bringing you quality kurtas, lawn suits, abayas, kids wear and more at fair prices.\n\nEvery piece is checked by hand before it is packed. Thank you for shopping with us!',
      image: '',
    },
    shipping: {
      title: 'Shipping policy',
      text: 'We deliver all over Pakistan.\n\n• Orders are confirmed by phone or WhatsApp.\n• Delivery takes 3–5 working days in major cities and 5–7 days elsewhere.\n• Delivery charges are shown at the time of confirmation.',
      image: '',
    },
    returns: {
      title: 'Return & exchange policy',
      text: '• Exchange within 7 days of delivery if the item is unused, unwashed and has its tags.\n• Size exchange is free for the first time.\n• Sale items can be exchanged but not refunded.\n\nContact us on WhatsApp with your order number to start an exchange.',
      image: '',
    },
    terms: {
      title: 'Terms & conditions',
      text: 'By placing an order you agree that the details you give are correct.\n\nPrices and stock can change without notice. Colours may look slightly different on different screens.',
      image: '',
    },
    earn: {
      title: 'Earn with us',
      text: 'Become a reseller and earn a profit on every sale. Fill in the form below and our team will contact you with the details.',
      image: '',
    },
  },
  sizeGuide: {
    text: 'Size | Chest | Length\nS | 38" | 40"\nM | 40" | 41"\nL | 42" | 42"\nXL | 44" | 43"\n\nMeasurements are of the garment, in inches. If you are between two sizes, choose the bigger one.',
    image: '',
  },
  location: { address: '', mapLink: '', showMap: true },
};

function withContentDefaults(content = {}) {
  const pages = {};
  for (const key of PAGE_KEYS) pages[key] = { ...DEFAULT_CONTENT.pages[key], ...content.pages?.[key] };
  return {
    pages,
    sizeGuide: { ...DEFAULT_CONTENT.sizeGuide, ...content.sizeGuide },
    location: { ...DEFAULT_CONTENT.location, ...content.location },
  };
}

// helpers: { str, safeUrl, isUploadUrl } from the server
function sanitizeContent(input = {}, { str, safeUrl, isUploadUrl }) {
  const image = (v) => (isUploadUrl(v) ? v : '');
  const pages = {};
  for (const key of PAGE_KEYS) {
    const p = input.pages?.[key] || {};
    pages[key] = {
      title: str(p.title, 80) || DEFAULT_CONTENT.pages[key].title,
      text: str(p.text, 8000),
      image: image(p.image),
    };
  }
  return {
    pages,
    sizeGuide: { text: str(input.sizeGuide?.text, 4000), image: image(input.sizeGuide?.image) },
    location: {
      address: str(input.location?.address, 300),
      mapLink: safeUrl(input.location?.mapLink),
      showMap: input.location?.showMap !== false,
    },
  };
}

const contentImages = (content) =>
  [...Object.values(content.pages).map((p) => p.image), content.sizeGuide.image].filter(Boolean);

module.exports = { PAGE_KEYS, withContentDefaults, sanitizeContent, contentImages };
