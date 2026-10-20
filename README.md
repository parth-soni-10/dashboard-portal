# Dashboard Portal

One page that links every deployed dashboard and previews each one live inside its own row.

**Live:** https://dashboards-home-portal.pages.dev

## What it does

- **Indexes the dashboards** — F1 session analysis, cents., RBI weekly data, Irish visa decisions, the UCD module picker and the Content Tracker — each with a one-line description, tags and its repo.
- **Previews each one live** in a sandboxed frame. A dashboard that sends a frame-deny policy instead explains why it cannot be shown, rather than displaying a browser error page.
- **Live figures** in some descriptions (titles logged, shows counted) are read on this origin through a Pages Function, because that dashboard's endpoint cannot be fetched from a browser here.
- **Fast to use** — search with `/`, filter by tag, deep links to a single dashboard's preview, keyboard navigation, and light/dark themes that open light.

## Where it comes from

`data/dashboards.js` is the whole manifest: one entry per dashboard with its name, tone, description, URL, repo, tags, embed flag and any live counts. Adding a dashboard is editing that file.

## Built with

Static **HTML / CSS / JavaScript** with no build step, plus a single **Cloudflare Pages Function**. The embed flags are checked against each dashboard's real response headers, so a policy change is caught instead of silently breaking a preview.
