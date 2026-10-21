# Local identity assets

These assets identify the product, source repositories, publishers and supported protocols. They are bundled locally; rendering the interface does not contact Hugging Face, GitHub or a third-party image host.

- **TaskLattice:** `web/brand.tsx` reuses the existing TaskLattice website `app/BrandLogo.tsx` lattice geometry at 32 px, with the same cyan brand signal in Dark and teal in Light. The single-line wordmark reads TaskLattice in semibold and Veritas in muted medium weight. `tasklattice-mark.svg` is copied unchanged from `tasklattice-website/public/assets/brand/tasklattice-mark.svg` for the browser favicon. The existing Veritas typeface and shell height are retained; no UI framework is added.
- **Publishers:** original profile avatars from the public Hugging Face organization/user profiles and GitHub publisher profiles. `sources.json` records every exact source and retrieved asset URL, retrieval date and byte size. An avatar identifies the publisher; it does not imply an official project logo or endorsement. OR-Bench's publisher uses the profile's generated identicon.
- **Hugging Face:** official mark, published at https://huggingface.co/brand.
- **GitHub:** Simple Icons mark, CC0-1.0; the upstream license is included as `simple-icons-LICENSE.txt`.
- **F5:** copied from Guard's existing integration asset, originally https://www.f5.com/favicon.ico (retrieved 2026-10-09).
- **LiteLLM:** copied from Guard's existing local `litellm-train.webp` integration asset. Its train symbol identifies the LiteLLM protocol.

Product names and trademarks remain the property of their respective owners. Third-party avatars and marks are used only for identification. Unknown publishers and unavailable images fall back to the local Dataset/Adapter interface icon. No remote runtime fallback is used.
