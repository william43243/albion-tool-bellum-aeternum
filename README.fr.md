# Albion Tool — Bellum Aeternum

Un compagnon Android pour Albion Online : comparer les prix, calculer les profits nets d'un flip, explorer l'historique et préparer un trajet sur une carte interactive, avec un assistant IA facultatif.

**Bêta · Android en priorité · Français / English / Español**

[English](README.md) · [Versions publiées](https://github.com/william43243/albion-tool-bellum-aeternum/releases) · [Licences et crédits](THIRD_PARTY_LICENSES.md) · [Bilan des vérifications](docs/publication-validation.md)

## Fonctionnalités

| Fonction | Ce que l'application propose |
| --- | --- |
| Marché | Prix d'achat et de vente observés, par objet, qualité, ville et serveur, avec dates et frais. |
| Craft | Calcul des frais de station et de nutrition à partir des valeurs des objets. |
| Flipping | Profit net et ROI, achat/vente immédiats ou hypothèses de remplissage d'ordres. L'assistant peut comparer les possibilités dans une ville et entre plusieurs villes avec les calculs du code. |
| Historique | Comparaisons par objet et par ville. Les graphiques du chat proposent des courbes, les quantités rapportées, la sélection d'une date, le plein écran et un replay historique. |
| Carte | Recherche parmi 414 zones, sélection, zoom et plein écran. Les itinéraires suivent les connexions statiques et peuvent privilégier moins de transitions ou moins de zones létales. |
| Assistant | Recherche des prix et historiques, tableaux, graphiques et aperçus de carte grâce aux appels d'outils pris en charge. |
| Favoris et alertes | Suivi par ville, côté du marché et seuil : inférieur ou égal, supérieur ou égal, ou égal. Vérifications en arrière-plan visant 20 minutes, avec retards possibles sous Android. |
| Réglages | Serveurs Amériques, Europe et Asie, préférences et notices tierces accessibles hors ligne. |

Les calculs des comparaisons sont réalisés par l'application. L'IA les présente et les explique à partir des résultats des outils. Les trajets indiquent des changements de zone et les risques statiques, pas un temps de marche précis ni une garantie de sécurité.

## Deux modes IA

**Sur l'appareil :** LiteRT-LM exécute des modèles téléchargés séparément. Les besoins en mémoire, le GPU, la vision et les appels d'outils dépendent du modèle et du téléphone; certaines configurations restent expérimentales. Voir le [registre des modèles](lib/models.ts) et les [notes de validation](docs/model-download-audit.md).

**OpenAI facultatif :** une connexion OAuth expérimentale coexiste avec le mode local. L'accès et les modèles disponibles dépendent du compte et des autorisations du fournisseur. Ce projet indépendant ne garantit pas l'accès avec tous les abonnements et n'est pas approuvé par OpenAI. Les [notes d'intégration](docs/siwc-integration.md) décrivent son fonctionnement et ses limites.

L'inférence locale reste sur le téléphone, mais les recherches de marché contactent des services externes. Le mode OpenAI transmet le contexte nécessaire et les résultats des outils au fournisseur. Les poids des modèles et les identifiants de l'utilisateur ne sont pas inclus dans le code ou l'APK.

Exemples de demandes, selon les capacités du mode choisi et les données disponibles :

- « Compare le prix des blocs de travertin sur les 30 derniers jours dans toutes les villes. »
- « Trouve un flip pour cet objet au départ de Martlock, calcule les frais et montre le trajet. »
- « Avertis-moi quand le plus bas prix de vente de cet objet à Fort Sterling est inférieur ou égal à 500 silver. »

Ces exemples présentent les usages prévus; ils ne constituent pas des promesses de profit ou des validations de chaque service en direct.

## Comprendre les données

Les prix et historiques proviennent de l'[Albion Online Data Project](https://www.albion-online-data.com/), un projet communautaire tiers. Ses observations dépendent des marchés consultés par les joueurs contributeurs : elles peuvent manquer ou dater. Il ne s'agit pas d'un flux officiel couvrant tout le marché.

- `item_count` représente une quantité d'objets agrégée dans les observations rapportées, pas un nombre de transactions ou d'ordres, une valeur en silver ou la profondeur du carnet.
- Le replay révèle les observations disponibles dans l'ordre chronologique. Il n'invente ni transactions manquantes ni bougies OHLC.
- La carte utilise une version figée des données et un rendu original simplifié. Aucun flux de kills vérifié, relief exact ou chemin précis à l'intérieur des zones n'est fourni.
- Une alerte exige une observation datant d'aujourd'hui dans le fuseau du téléphone. Les notifications doivent être autorisées; Android peut retarder le contrôle et un seuil peut être manqué entre deux contrôles.
- Les remplissages d'ordres, la liquidité, les pertes de transport et le profit ne sont pas garantis.

Les sources sont citées dans le [bilan des droits des données](docs/data-rights.md). La permission de redistribuer les dumps du jeu reste non confirmée; leur utilisation répandue n'est pas présentée comme une licence.

## Compiler depuis le dépôt

Prérequis : **Node.js 22, Python 3.9+, JDK 17 ou 21**, Android SDK **37**, build-tools **37.0.0**, NDK **27.1.12297006** et CMake **3.22.1**. Configurer `JAVA_HOME` et `ANDROID_HOME`.

Le projet Android contient des modules natifs personnalisés maintenus dans le dépôt. Utiliser directement Gradle; `expo prebuild` n'est pas nécessaire.

```sh
npm ci --legacy-peer-deps
npm ci --prefix analytics
npm run prepare:data
npm run check:data
python3 scripts/generate-notices.py --check
npm test
npm run typecheck
chmod +x android/gradlew
android/gradlew -p android :app:assembleDebug -PALBION_QA=true --max-workers=1
```

Sur Windows, utiliser `python` à la place de `python3`, ignorer `chmod` et lancer `android\gradlew.bat`. L'APK de test autonome est créé dans `android/app/build/outputs/apk/debug/`. Le suffixe `.qa` permet de le distinguer de la version de production; aucune clé de production n'est nécessaire.

`prepare:data` récupère un `world.json` à une révision fixe, vérifie son SHA-256 et génère les mêmes 414 zones pour JavaScript et Android. Les JSON générés restent exclus de Git. CI et Docker utilisent aussi cette préparation. Pour un fichier source local dont l'empreinte correspond :

```sh
npm run prepare:data -- --source /chemin/world.json
```

La première préparation nécessite le réseau pour les dépendances et les données. Elle résout le prérequis de compilation, pas la question des droits de redistribution.

Pour compiler le candidat release **ARM64 non signé** utilisé lors de la vérification propre :

```sh
android/gradlew -p android :app:assembleRelease -PALBION_ALLOW_UNSIGNED_RELEASE=true -PreactNativeArchitectures=arm64-v8a --max-workers=1
```

Ce candidat ne constitue pas une release de production installable. La signature reste séparée dans le workflow GitHub protégé; ne jamais transmettre de secrets de signature à Gradle. La configuration par défaut vise aussi x86_64, qui n'a pas été recompilé lors de cette dernière vérification propre.

Pour le développement navigateur, lancer `npm run web` après la préparation des données. Les modèles et fonctions natives diffèrent : les alertes Android en arrière-plan et son parcours OAuth ne sont pas annoncés comme équivalents sur le web.

## Vérification et publication

Le [bilan du 8 novembre 2026](docs/publication-validation.md) documente 469 tests réussis, la validation TypeScript, les contrôles web et la compilation ARM64 depuis une copie propre. Il distingue les preuves de compilation des essais sur téléphone et auprès des fournisseurs réels. L'application reste une bêta.

CI contrôle les données, les notices, les tests, la compilation et les vérifications Android. La signature et la publication de production passent par un workflow manuel protégé. Celui-ci prévoit une archive `third-party-sources-notices.zip` à côté de l'APK.

Conserver cette archive avec les binaires redistribués : elle contient les notices lisibles et les sources amont de la bibliothèque de compatibilité Java. La [procédure de maintenance](docs/licenses/README.md) détaille ces obligations et la régénération.

## Signaler un problème

Créer une [issue GitHub](https://github.com/william43243/albion-tool-bellum-aeternum/issues) en indiquant la version de l'application, le téléphone et sa version Android, le serveur, le fournisseur/modèle IA, les étapes et les dates des observations concernées. Masquer les conversations privées dans les captures. Ne jamais joindre de token, clé API, mot de passe ou clé de signature.

## Licences et crédits

Le code original est sous [licence MIT](LICENSE). Les données, modèles, dépendances et marques gardent leurs propres conditions. Voir [les licences tierces](THIRD_PARTY_LICENSES.md), [les notices du runtime](docs/licenses/README.md) et [les droits des données](docs/data-rights.md).

Sources principales : [AODP](https://www.albion-online-data.com/), [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps), [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM), [LiteRT Community](https://huggingface.co/litert-community), [Albion Online Wiki](https://wiki.albiononline.com/) et la [référence visuelle de carte créditée](https://allthingsalbion.com/en/zones/map).

Albion Online est une marque de Sandbox Interactive GmbH. Ce projet n'est ni affilié, ni sponsorisé, ni approuvé par Sandbox Interactive ou OpenAI.

Le [README anglais](README.md#support) conserve les informations de soutien au projet et présente son organisation technique.
