# Historique volumineux : agrégation et projection

Vérification locale du 5 novembre 2026, avec Node 24.22.1 et le chart-kit 6.12.0 installé. Aucun déploiement ni modification de données utilisateur.

## Défauts reproduits

- `createLiveChartProjection` levait `RangeError: Maximum call stack size exceeded` avec 183 960 valeurs positives finies, car `Math.min(...values)` et `Math.max(...values)` dépassaient la limite d'arguments.
- `prepareHistoryChart` reproduisait ce crash avec un jeu **synthétique** de 3 items × 7 villes × 365 jours horaires. La densité réelle disponible dans l'API n'a pas été vérifiée.
- La ligne transparente de chart-kit parcourait encore toutes ses valeurs pour chaque point. La transparence ne supprimait pas ce travail quadratique.
- Le rendu SVG appelait `indexOf` sur l'axe pour chaque observation.

## Correction

- Bornes positives finies calculées par parcours, sans expansion en arguments. Les valeurs invalides restent exclues; le domaine vide reste `[0, 1]`.
- Le dataset invisible ne contient plus que `[min, max]`, ou une seule valeur pour un domaine constant. Les bornes des pointillés sont incluses.
- L'axe complet, les labels, les observations SVG, les trous, les segments et les statistiques historiques sont conservés. Aucune décimation des observations.
- Un projecteur est construit une fois par modèle, avec un snapshot local et une table timestamp → premier index. Les quatre chemins SVG l'utilisent. Le helper ponctuel conserve son comportement antérieur.
- Un nouveau modèle crée un nouveau projecteur; il n'existe pas de cache global susceptible de mélanger deux axes. Les timestamps absents de l'axe conservent la logique d'interpolation antérieure.

## Vérifications

Commande ciblée :

`node node_modules/tsx/dist/cli.mjs --test tests/liveChart.test.ts tests/historyChart.test.ts tests/historyChartScale.test.ts tests/aodpTime.test.ts`

- 29 tests réussis : 183 960 observations conservées, série unique de 150 000 points, valeurs invalides/constantes/extrêmes, trous, pointillés, alignement et durée de vie du snapshot.
- `node node_modules/typescript/bin/tsc --noEmit` réussit.
- La revue indépendante a rejoué 30 tests histoire/live/requêtes et comparé 15 000 coordonnées aux équations, sans problème bloquant.
- Le harness utilisant les vrais `AbstractChart` et `LineChart` installés confirme 12 valeurs parcourues par `renderLine` pour un domaine invisible de deux valeurs, et 4 pour une valeur constante. Les labels X et coordonnées Y concordent; l'écart X observé était au plus 2,84 × 10⁻¹⁴ pixel.
- Le raccordement `fetchPrices` avec `AbortSignal`, modifié dans un autre lot, est préservé.

## Benchmark reproductible

`node node_modules/tsx/dist/cli.mjs tests/historyChart.benchmark.ts`

Médianes de trois essais sur ce PC; chaque coordonnée indexée est vérifiée aux équations et les sommes de contrôle correspondent au helper de référence.

| Observations | Taille de l'axe | Référence linéaire | Projecteur indexé | Préparation du projecteur |
| --- | --- | --- | --- | --- |
| 2 160 | 2 160 | 12,408 ms | 0,588 ms | 1,226 ms |
| 183 960 | 8 760 | 3 870,712 ms | 15,494 ms | 2,832 ms |

Ces temps mesurent **uniquement le calcul JavaScript des coordonnées**. Ils ne mesurent pas les FPS, la mémoire ou la fluidité du S22. La construction des chemins SVG, les labels complets, React et le rendu natif ont toujours un coût lié au nombre de données. L'interpolation de timestamps absents de l'axe peut encore parcourir celui-ci; les observations SVG normales utilisent des timestamps déjà présents et bénéficient de la table d'index.
