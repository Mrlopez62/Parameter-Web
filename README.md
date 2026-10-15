# Parameter-Web

Marketing website for [Parameter](https://parameter.digital): practical automation for small businesses.

Built with [Astro](https://astro.build) and Tailwind CSS v4. Layout inspired by the Seonovu Framer template; all code, copy, and visuals are our own.

## Commands

Use Node 24 (see `.nvmrc`).

| Command                | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `npm install`          | Install dependencies                                         |
| `npm run dev`          | Start the dev server at `localhost:4321`                     |
| `npm run build`        | Build the static site to `dist/`                             |
| `npm run preview`      | Preview the production build locally                         |
| `npm run lint`         | Lint with ESLint (JS, TS, Astro)                             |
| `npm run format`       | Format everything with Prettier (sorts Tailwind classes)     |
| `npm run format:check` | Check formatting without changing files                      |
| `npm run typecheck`    | Type-check `.astro` and `.ts` files (`astro check`)          |
| `npm test`             | Run unit tests (Vitest)                                      |
| `npm run test:e2e`     | Run end-to-end tests (Playwright) against a production build |
| `npm run check`        | Lint, format check, type-check, and unit tests in one go     |

## Testing

- **Unit tests** live next to the code as `*.test.ts` (e.g. `src/lib/calendar.test.ts`) and run with Vitest.
- **End-to-end tests** live in `e2e/` and run with Playwright in a desktop and a mobile (Pixel 7) Chromium viewport.
  Playwright builds the site and serves it with `astro preview`. They cover the contact form and date picker (with a
  fixed date and time zone, and the Netlify submission intercepted), the 404 and privacy pages, metadata, animations,
  and an axe WCAG 2.1 AA accessibility scan of each page.
- First run only: `npx playwright install chromium` to download the test browser.

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main`/`dev` and on every pull request: lint, format check,
  type-check, unit tests, and build in one job; end-to-end tests in another. The Playwright report is uploaded as an
  artifact when e2e tests fail.
- **CD** is Netlify (`netlify.toml`): `main` deploys to production, and every pull request gets a deploy preview. Protect
  `main` in GitHub (Settings → Branches) and require the two CI checks, so only passing code reaches production.

## Structure

- `src/styles/global.css`: brand tokens (colors, fonts) and base styles.
- `src/data/site.ts`: site name, contact email, navigation links.
- `src/layouts/BaseLayout.astro`: page shell, SEO meta, header and footer.
- `src/components/`: shared building blocks; `sections/` holds home page sections.
- `src/components/Logo.astro`: the logo (mark, wordmark, lockup) as inline SVG + Geist text.
- `Logo system-html/`: logo system v2.0 design reference (brand blue `#2D5BFF`, ink `#0A0B0F`, Geist / Geist Mono). Not part of the build.

## Copy guidelines

Follow the marketing principles in the Parameter company docs: lead with automation and the business outcome (mention AI only where a solution actually uses it, and describe it honestly), and never publish metrics, testimonials, or customer stories that aren't real and approved.

## Contact form

The discovery-call form (`src/components/sections/Contact.astro`) uses [Netlify Forms](https://docs.netlify.com/manage/forms/setup/): Netlify detects the `data-netlify` form in the built HTML at deploy time. After the first deploy, enable form detection and add an email notification to `hello@parameter.digital` under **Forms → Notifications** in the Netlify dashboard.

After submitting, visitors can add the requested time to Google Calendar, Outlook.com, Outlook (Microsoft 365), or Apple Calendar / other apps via an `.ics` file (`src/lib/calendar.ts`). The event is marked as requested/tentative until we confirm by email.

### Email checks

The email field is checked live, in three layers (`src/scripts/email-verify.ts`):

1. **Typo suggestions** in the browser, e.g. `gmial.com` -> `gmail.com` (`src/lib/email-check.ts`).
2. **Domain check**: `netlify/functions/verify-email.mts` (`/api/verify-email`) confirms the domain can receive mail
   and isn't a throwaway service. Free; only the domain is sent; cached at the edge for a day.
3. **Mailbox check**: `netlify/functions/verify-mailbox.mts` (`/api/verify-mailbox`) asks
   [Abstract API](https://www.abstractapi.com/api/email-verification-validation-api) whether the exact address exists.
   Inactive until `ABSTRACT_API_KEY` is set under **Project configuration -> Environment variables** in Netlify. Runs
   only on blur/submit, is cached per address, and is rate-limited per visitor.

Only a definite "can't receive mail", "throwaway", or "mailbox doesn't exist" blocks the form. Anything uncertain, and
any error or exhausted quota, lets the enquiry through. Neither function runs under `astro dev`/`astro preview`; the
form then skips those checks.

In `npm run dev`, submissions are not sent anywhere; the form skips straight to the success screen so the flow can be tested locally.
