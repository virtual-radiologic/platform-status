# vRad Platform Status

The client-facing status page for the vRad platform, served by GitHub Pages at
<https://virtual-radiologic.github.io/platform-status/>.

It is hosted here, and not on vRad infrastructure, for one reason: a status page that shares a
failure domain with the platform it reports on goes down exactly when people need it. The only
dependency this page has on vRad is that something, somewhere, pushed a JSON file to this
repository.

## How it works

Platform Nexus (internal, running in Kubernetes) projects its internal health rollup down to a
small public document and pushes it here. A browser loading this page reads that document
directly from GitHub. Nothing in the serving path touches vRad infrastructure.

```
Nexus (k8s)  --push-->  GitHub (this repo)  <--fetch--  client's browser
```

## Branch layout

Three branches, each with one job. The split is not cosmetic: the two published files have
genuinely incompatible write models.

| Branch      | Contents           | Written by        | How                                  |
| ----------- | ------------------ | ----------------- | ------------------------------------ |
| `main`      | this site's source | developers        | normal commits, Pages builds from it |
| `data`      | `status.json`      | Nexus             | force-push, single orphan commit     |
| `incidents` | `incidents.json`   | Nexus or a person | normal commits, SHA conflict-checked |

**This page reports the present, not the past.** There is deliberately no uptime history and no
90-day graph. Clients come here to find out whether something is broken right now; historical
downtime percentages answer a question they are not asking, and publishing them invites an argument
about arithmetic instead of telling anyone what is happening.

**Why `status.json` is force-pushed.** It carries a heartbeat, because `generatedAt` is how the page
detects that publishing has stopped, and that timestamp only advances when something writes. A
five-minute heartbeat as ordinary commits would be roughly 105,000 commits a year. Force-pushing a
single orphan commit keeps the branch at exactly one commit forever, and since no history is
published, nothing is lost by discarding it.

**Why `incidents.json` is not.** Editing it by hand in the GitHub web UI is the break-glass path
for posting an incident when Nexus itself is unreachable. Force-push has no conflict detection, so
it would silently discard a person's edit. Normal commits let the Contents API reject a stale write
with a 409 instead.

**Why neither lives on `main`.** Pages allows about 10 builds per hour. If the data were on the
published branch, every status change would trigger a build, and changes cluster during an
incident. Keeping data off `main` means Pages only rebuilds when the site itself changes, and the
browser reads the data from `raw.githubusercontent.com`, which sends
`Access-Control-Allow-Origin: *` so no proxy is needed.

### Two read paths, because raw is cached and cannot be busted

**Background polling reads `raw.githubusercontent.com`.** Unlimited and anonymous, but it caches per
path for up to 300 seconds and **ignores query-string cache-busters**. That was measured, not
assumed: `x-cache: HIT` on three unique query strings from three different cache nodes, and a
request-level `Cache-Control: no-cache` is ignored too. So this path can be five minutes behind.

**A manual refresh reads `api.github.com`**, which does honour a cache-buster and returns the current
commit immediately. Verified on a scratch branch: write `v2`, and within the same second the API with
a buster returns `v2` while the API without one and raw both still return `v1`.

The split is forced by the API's rate limit: **60 requests per hour per client IP**, unauthenticated,
and each refresh reads two documents. That is ample for a button a person presses and far too little
for a timer, especially since everyone behind one corporate egress shares the budget. Authenticating
is not an option, because a token in a public page is a published token. A rate-limited API read falls
back to raw, so the worst case is a refresh that behaves like a wait.

This is also why the page tolerates more staleness than the publisher declares. See
`TRANSPORT_LAG_ALLOWANCE_SECONDS`: the publisher's `staleAfterSeconds` means "how often I write",
which is all it can honestly know, and the page adds its own transport lag on top. A 120-second
heartbeat plus 300 seconds of CDN lag is 420 seconds observed, so judging against the published 300
made a healthy platform intermittently announce that it might be out of date.

## Repository setup

One-time steps after cloning:

1. **Enable Pages**: Settings > Pages > Build and deployment > Source = **GitHub Actions**. The
   workflow in `.github/workflows/pages.yml` does the rest.
2. **Create the data branches** as orphans, so neither carries the site's history:

   ```bash
   git switch --orphan data       && git commit --allow-empty -m "data branch"      && git push -u origin data
   git switch --orphan incidents  && git commit --allow-empty -m "incidents branch" && git push -u origin incidents
   git switch main
   ```

3. **Enable secret scanning and push protection**: Settings > Code security. This repository is
   public, so GitHub's native secret scanning is free, and it satisfies the team requirement for
   secret scanning without a third-party scanner in CI.

## Local development

```bash
npm install
npm run dev      # http://localhost:4000/platform-status/
```

`.env.development` points the page at `fixtures/` instead of the published branches, so the page
works with no network and no publisher running.

The fixtures deliberately live outside `public/`. Anything in `public/` is copied into the Pages
artifact, which would publish a stale `status.json` at the site's own URL: a file nothing reads,
that looks authoritative, and that would never update.

A dev-only Vite middleware (`devFixtures` in `vite.config.ts`) serves them with `generatedAt`
rewritten to the current instant, so the dev server starts on the fresh path rather than
immediately reporting itself stale. To exercise the stale path instead, comment that plugin out of
the `plugins` array; the committed fixture timestamps are old enough to trigger it.

```bash
npm run lint         # eslint, zero warnings tolerated
npm run typecheck
npm test             # vitest, watch
npx vitest run       # vitest, once
npm run build        # typecheck then production build
```

## Design decisions worth knowing before you change something

**Maintenance is not a published state.** A window opens and closes on a wall-clock boundary with
no health change to trigger a publish, so a published "under maintenance" value would be wrong
from the window's start until some unrelated write. Windows travel as start and end times and the
page overlays them at render.

**A service row resolves four sources, in this order:** an unexpired operator override, then an open
incident naming the service, then an open maintenance window, then the published health (or unknown
when stale). An override outranks the rest because it is the most deliberate act. An incident
outranks maintenance because something is actually wrong, which matters more to a client than the
fact that work was planned.

**An open incident sets the state of the services it names**, derived from its impact: Major or
Critical reads as an outage, Minor as degraded, and None changes nothing (that impact exists for an
informational notice claiming no service is affected).

Against health it is a **floor, not a replacement**: the worse of the two wins. A Minor incident
filed against a service Nexus can see is genuinely down must not move the page from Outage down to
Degraded, which is the one direction a status page should never travel on its own.

This is derived rather than set by hand because the alternative produced a page that contradicted
itself: an incident about Imaging sitting above an Imaging row reading "Operational". Expecting
whoever is mid-outage to remember a second action was not a plan. It also needs no expiry, unlike a
manual override: the implied state lasts exactly as long as the incident is open and clears the
moment it is resolved, so it cannot drift out of step with what the incident says.

**Operator overrides live in `incidents.json`, not `status.json`.** Nexus force-pushes the status
document, so a hand edit there is discarded on the next publish. The override exists for the case
nothing else covers: the platform is entirely down, so nothing is publishing, so the status document
ages out and every service reads as unknown. At that moment an operator needs to state that a service
is down as a fact rather than only as incident prose, and `incidents.json` is the only file they can
still write. Overrides carry a **required** `expiresAt`, because an override with no end is how a
service stays pinned to an outage long after it recovered, once whoever set it went off to fix the
real problem.

**A stale document reports nothing, not its last value.** When `generatedAt` is older than
`staleAfterSeconds`, every service drops to "Status unknown" and the headline drops to "Current
status unavailable". Continuing to show green from a document nobody is updating would be the
single worst failure this page could have, so it is asserted in `src/App.test.tsx`. An unexpired
override is the one thing that survives staleness, which is the entire point of it.

**The headline is derived from the resolved rows, not read from the document's `overall`.** The
published value is right for the ordinary fresh case and is still there for anyone reading the JSON
directly, but it cannot know about an override or about its own staleness, and trusting it would let
the page announce an all-clear above rows saying otherwise. Any unknown row also blocks an all-clear:
claiming everything is fine while some rows are unknown asserts more than the page knows.

**A failed poll upstream never becomes an outage here.** Nexus holds the last published state when
it cannot poll, because a poll failure describes Nexus, not the service. The uncertainty is carried
by staleness instead.

**Every state is an icon shape plus text, never color alone.** Color is reinforcement. This page
gets read under pressure on whatever screen is to hand, including by people who cannot distinguish
red from green.

**No component library.** The bundle is about 50 kB gzipped. A page whose job is to load when
everything else is broken should not ship several hundred kilobytes of UI framework.

## Serialization contract

`src/models/types.ts` mirrors the C# records in `Nexus.Contracts/PublicStatus.cs`. The publisher
must serialize with:

- **camelCase** property names (`JsonNamingPolicy.CamelCase`). The C# default is PascalCase, which
  would leave every field on this side undefined.
- **string** enum values (`JsonStringEnumConverter`). System.Text.Json writes enums as numbers by
  default, which still parses as valid JSON while making every state comparison here fail silently.

`schemaVersion` guards drift. A published page is cached in browsers nobody controls, so an old
bundle will eventually read a new document: it reports the mismatch rather than rendering a payload
it only half understands.
