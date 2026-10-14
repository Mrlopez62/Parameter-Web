# Parameter-Web

Marketing website for [Parameter](https://parameter.digital): practical automation for small businesses.

Built with [Astro](https://astro.build) and Tailwind CSS v4. Layout inspired by the Seonovu Framer template; all code, copy, and visuals are our own.

## Commands

| Command           | Action                                  |
| ----------------- | --------------------------------------- |
| `npm install`     | Install dependencies                    |
| `npm run dev`     | Start the dev server at `localhost:4321` |
| `npm run build`   | Build the static site to `dist/`        |
| `npm run preview` | Preview the production build locally    |
| `npx astro check` | Type-check `.astro` and `.ts` files     |

## Structure

- `src/styles/global.css`: brand tokens (colors, fonts) and base styles.
- `src/data/site.ts`: site name, contact email, navigation links.
- `src/layouts/BaseLayout.astro`: page shell, SEO meta, header and footer.
- `src/components/`: shared building blocks; `sections/` holds home page sections.
- `src/components/Logo.astro`: the logo (mark, wordmark, lockup) as inline SVG + Geist text.
- `Logo system-html/`: logo system v2.0 design reference (brand blue `#2D5BFF`, ink `#0A0B0F`, Geist / Geist Mono). Not part of the build.

## Copy guidelines

Follow the marketing principles in the Parameter company docs: lead with automation and the business outcome (mention AI only where a solution actually uses it, and describe it honestly), and never publish metrics, testimonials, or customer stories that aren't real and approved.
