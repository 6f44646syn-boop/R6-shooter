const preview = {
  image: 'sponsor-preview.png',
  alt: 'Sponsor placement preview',
};
const campaign = null; // Set to { image, alt, url } to enable a live sponsor.

const sponsor = new URLSearchParams(location.search).get('sponsor') === 'preview'
  ? preview
  : campaign;

if (sponsor) {
  customElements.define('rr-sponsor', class extends HTMLElement {
    connectedCallback() {
      if (this.firstChild) return;

      const label = document.createElement('span');
      label.textContent = 'Sponsored';

      const image = document.createElement('img');
      image.alt = sponsor.alt;
      image.width = 480;
      image.height = 64;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => this.remove(), { once: true });

      if (sponsor.url) {
        const link = document.createElement('a');
        link.href = sponsor.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer sponsored';
        link.append(image);
        this.append(label, link);
      } else {
        this.append(label, image);
      }

      image.src = new URL(sponsor.image, import.meta.url);
      this.classList.add('sponsor-ready');
    }
  });
}
