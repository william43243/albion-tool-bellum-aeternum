# Albion Market Hardening Implementation Plan

> **For Hermes:** Execute task-by-task with strict TDD, independent review, and verified APK/site artifacts.

**Goal:** Corriger les risques légaux, les corruptions de données, la fiabilité IA, les garde-fous réseau, la CI et les incohérences produit sur Android et le site web.

**Architecture:** Couper entièrement la télémétrie produit afin de conserver un comportement sans collecte par défaut et une politique cohérente. Durcir ensuite chaque frontière (parsing, téléchargement, moteur IA, réseau, données produit) avec des tests de régression avant correction. Les publications APK et site restent séparées et ne sont autorisées qu'après leurs gates propres.

**Tech Stack:** React Native/Expo/TypeScript, Kotlin Android, Node/Express/SQLite, site HTML/JS, GitHub Actions.

---

## Ordre d'exécution verrouillé

1. Télémétrie et confidentialité, application + site + backend.
2. Parsing numérique localisé et rejet des formats ambigus.
3. Téléchargement LiteRT atomique avec taille/hash.
4. Cycle de vie concurrent du moteur LiteRT (`initialize`/`destroy`).
5. CI réelle et pipeline de signature isolé.
6. Fuites moteur à l'unmount et WebLLM pending engine.
7. Téléchargements concurrents et timeout conversation.
8. Bornes réponses/outils (`MAX_RESPONSE_BYTES`, `days`, item IDs).
9. Timeouts/retry API et cycle de vie écran.
10. Budget de contexte IA réaliste.
11. `marketOpportunity.ts` : correction ou suppression prouvée.
12. Item Values : import complet ou indisponibilité explicite.
13. Routes : source unique, normalisation, documentation exacte.
14. i18n FR/ES et chaînes UI.
15. History/UI parsing et ItemPicker complet.
16. Documentation, claims, CGU/licence et updater.

## Gates globales

- Chaque changement comportemental suit RED → GREEN.
- `npm test`, `npm run typecheck`, Metro/Expo export et suites Python passent.
- Le site ne transmet aucune télémétrie produit.
- Un fresh install Android ne transmet aucune télémétrie produit.
- APK final : package/version/ABI/bundle/non-debuggable/signature/hash vérifiés.
- Déploiement site et publication APK font l'objet de validations séparées.
- Revue indépendante du diff complet avant chaque publication.

## Tâche 1 — Couper la télémétrie produit

**Fichiers:** `lib/analytics.ts`, `site/js/analytics.js`, `analytics/server.js`, `site/confidentialite.html`, tests analytics.

1. Ajouter des tests qui échouent si le client mobile/web contient un transport de télémétrie ou si le backend accepte et persiste `/api/track/*`.
2. Rendre les exports analytics compatibles mais strictement no-op afin d'éviter les appels réseau sur fresh install.
3. Désactiver le tracker du site et faire répondre le backend sans persistance.
4. Réécrire la politique : aucune analytique produit; distinguer les journaux techniques Cloudflare/Nginx nécessaires à la sécurité.
5. Vérifier statiquement et dynamiquement zéro requête analytics.

## Tâche 2 — Parsing numérique localisé

**Fichiers:** `lib/numberParsing.ts`, appels UI, tests.

Cas obligatoires : `1 500 000`, `1.500.000`, `1,5`, séparateurs mixtes, ambiguïtés, valeurs non finies. Rejeter plutôt que deviner.

## Tâche 3 — Téléchargements LiteRT atomiques

**Fichiers:** `LiteRTModule.kt`, manifeste modèles, tests Kotlin/JVM.

Télécharger vers `.tmp`, borner/valider la taille, vérifier SHA-256 lorsqu'il est fourni, `fsync`/rename atomique, nettoyer les partiels. `isModelDownloaded()` valide l'intégrité attendue.

## Tâche 4 — Cycle de vie LiteRT

Sérialiser `initialize`/`destroy`, construire le nouvel engine avant de fermer l'ancien, préserver l'engine fonctionnel en cas d'échec et tester les courses.

## Tâche 5 — CI et signature

Finaliser le build non signé sans secrets, la signature dans l'environnement GitHub protégé `production-signing`, les refus fail-closed, la sortie exclusive et le manifeste SHA-256. Ajouter tests/TypeScript/Python à chaque push.

## Tâches 6–16

Appliquer le même cycle : reproduction RED, correctif minimal, test ciblé GREEN, suite complète, revue indépendante, puis commit signé. Aucun claim produit/documentaire n'est conservé sans preuve exécutable ou source de données correspondante.
