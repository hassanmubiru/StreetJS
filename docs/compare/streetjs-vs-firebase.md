---
layout:    default
title:     "StreetJS vs Firebase"
parent:    "Compare"
nav_order: 9
permalink: /compare/streetjs-vs-firebase/
description: "StreetJS vs Firebase — a self-hosted TypeScript backend framework versus Google's managed Backend-as-a-Service. StreetJS gives you owned auth, database, and realtime; Firebase offers managed BaaS with fast time-to-market."
---

# StreetJS vs Firebase

**In one line:** Another self-host vs managed decision. Firebase is Google's
Backend-as-a-Service (auth, Firestore, realtime, hosting, functions) that gets you
to market fast; StreetJS is a backend framework you self-host, giving you owned
data, a relational database, and no per-usage vendor lock-in.

> **Not a like-for-like comparison.** Firebase is a managed *platform*; StreetJS is
> a *framework* you run on your own infrastructure.

---

## At a glance

| | StreetJS | Firebase |
|---|---|---|
| Model | Self-hosted framework | Managed BaaS (Google Cloud) |
| Database | Relational: native PG driver, MySQL, SQLite + ORM | Firestore / Realtime Database (NoSQL) |
| Auth | Built in (JWT, sessions, RBAC, MFA) | Firebase Auth (managed, broad providers) |
| Realtime | Built-in WebSockets + channels | Realtime DB / Firestore listeners |
| Functions / compute | Your server / containers | Cloud Functions (serverless) |
| Where data lives | Your database | Google Cloud |
| Cost model | Your infra cost (predictable) | Pay-per-use (can scale unpredictably) |
| Offline / mobile SDKs | DIY / typed client SDK | Excellent first-party mobile SDKs |
| Vendor lock-in | None | Significant (data model + APIs) |

---

## Where Firebase wins

- **Time to market.** Auth, database, hosting, and realtime in minutes with no
  servers to manage.
- **First-class mobile SDKs** with offline sync — hard to match for mobile apps.
- **Serverless scaling** handled for you, plus an integrated console and analytics.

## Where StreetJS wins

- **Relational data you own.** SQL with a real schema and a first-party ORM rather
  than NoSQL document modeling, stored in your own database.
- **Predictable cost and no lock-in.** No pay-per-read pricing surprises; move
  hosts freely.
- **Full control** of the runtime, security model, and compliance posture — useful
  for regulated or cost-sensitive workloads.

## Honest tradeoffs

Firebase is excellent for getting a product — especially a mobile app — live
quickly with minimal ops, and its offline-capable SDKs are best-in-class. StreetJS
fits teams that want relational data, predictable self-hosted costs, no vendor
lock-in, and control over the backend — at the price of running your own
infrastructure. For some stacks you can also integrate Firebase via the
**[`@streetjs/plugin-firebase`](/plugins/)** integration.

---

## FAQ

**Is StreetJS a Firebase replacement?**
For server-driven, relational apps, StreetJS covers auth, database, and realtime in
one self-hosted framework. For mobile-first apps that rely on Firebase's offline
SDKs and serverless scaling, Firebase remains hard to replace.

**Does StreetJS use NoSQL like Firestore?**
No. StreetJS is relational-first (PostgreSQL, MySQL, SQLite) with a typed ORM,
which suits structured data and complex queries better than document stores.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Is StreetJS a Firebase replacement?", "acceptedAnswer": {"@type": "Answer", "text": "For server-driven, relational applications, StreetJS covers auth, database, and realtime in one self-hosted framework. For mobile-first apps relying on Firebase offline SDKs and serverless scaling, Firebase remains hard to replace."}},
    {"@type": "Question", "name": "Does StreetJS use NoSQL like Firestore?", "acceptedAnswer": {"@type": "Answer", "text": "No. StreetJS is relational-first (PostgreSQL, MySQL, SQLite) with a typed ORM, which suits structured data and complex queries better than document stores."}}
  ]
}
</script>
