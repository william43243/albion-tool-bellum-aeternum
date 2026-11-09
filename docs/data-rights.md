# Données Albion : provenance et état des droits

Vérification du 8 novembre 2026. Ce document distingue les sources retrouvées des autorisations établies. Il ne constitue pas une validation juridique générale ni une autorisation de publier les données tierces sous MIT.

## Prix et historique

L'[Albion Online Data Project](https://www.albion-online-data.com/) présente explicitement la collecte et la distribution de données pour les applications et intégrations. Sa [documentation API](https://www.albion-online-data.com/api/) décrit l'accès aux prix et à l'historique. Les résultats correspondent aux observations transmises par les clients contributeurs, pas à une couverture garantie de tout le marché.

Cette utilisation prévue de l'API ne suffit pas à établir une licence MIT pour les résultats, les bases ou les archives quotidiennes. La licence MIT du [logiciel client AODP](https://github.com/ao-data/albiondata-client) concerne ce logiciel. Aucune licence explicite couvrant la redistribution intégrale des archives n'a été établie dans cette revue. Les archives téléchargées et les caches personnels ne font pas partie de la publication source prévue.

## Catalogue et carte

Source : [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps). Aucun fichier de licence explicite n'a été trouvé dans les éléments examinés; le champ de licence de l'API GitHub était également vide. Cela laisse la permission de redistribution non résolue, sans conclure que chaque nom, chiffre ou fait isolé serait nécessairement protégé.

Fichiers concernés dans ce projet :

- `assets/items-db.json` et `android/app/src/main/assets/items-db.json` : catalogues d'objets déjà suivis par Git.
- `lib/routes.ts` : matrice de routes dérivée du monde du jeu, également suivie par Git. Une conversion en TypeScript ne règle pas à elle seule les droits de la source.
- `assets/map/world-map.local.json` et son équivalent Android : coordonnées, noms et connexions du monde, présents localement et ignorés par Git. Ils restent nécessaires aux fonctionnalités de carte et aux builds actuels.
- `lib/worldMapSketch.ts` et `assets/map/terrain-original.png` : rendu simplifié original, avec [All Things Albion](https://allthingsalbion.com/en/zones/map) comme référence visuelle. Le code décrit des silhouettes dessinées à la main; ce choix ne prouve pas une autorisation concernant la géographie sous-jacente.

La provenance enregistrée pour le jeu de données de carte est le commit [`90b141e20f4677c2fe3083c519b7f748affa4c47`](https://github.com/ao-data/ao-bin-dumps/tree/90b141e20f4677c2fe3083c519b7f748affa4c47), avec un SHA-256 source `6c3e66e9daf59a2e26a5e98be97b4bdd864e7a3d3243846bc684e3f278de7b7b`. Cette traçabilité n'est pas une licence et ne doit pas être étendue sans preuve aux autres catalogues du dépôt.

## Marques et conditions de l'éditeur

Albion Online est une marque de Sandbox Interactive GmbH. Ce projet indépendant n'est ni affilié, ni sponsorisé, ni approuvé par Sandbox Interactive. La licence MIT du code ne transfère aucun droit sur cette marque ou sur le contenu tiers du jeu.

Référence : [conditions Sandbox Interactive](https://albiononline.com/terms_and_conditions). L'accès direct à cette page a renvoyé HTTP 403 pendant cette revue; aucune validation intégrale de sa version actuelle n'est donc revendiquée. Aucun accord de redistribution des dumps n'a été obtenu et aucune demande n'a été envoyée. Les discussions historiques sur la lecture du trafic réseau ne doivent pas être interprétées comme une licence générale de redistribution.

## Avant de déclarer la publication prête

1. Établir une base explicite pour les données et éléments tiers distribués : licence applicable ou permission du titulaire compétent. À défaut, préparer une distribution qui ne les contient pas, avec un comportement fonctionnel documenté. Un téléchargement automatique ne règle pas à lui seul la question des droits.
2. Préparer les données avant de compiler : `npm run prepare:data` reconstruit les deux entrées locales depuis une source fixée et vérifiée par SHA-256. `npm run check:data` contrôle leur contenu. Cette procédure est incluse dans CI et Docker; elle ne règle pas à elle seule la question des droits.
3. Conserver le [corpus des notices runtime et les sources tierces](licenses/README.md) avec la distribution. Les textes sont accessibles hors ligne dans l'application et l'archive compagnon est préparée par le workflow de publication. Les modèles téléchargés restent soumis à leurs propres licences.
4. Vérifier l'archive ou le commit exact à publier, y compris son historique. `.gitignore` n'efface pas un fichier déjà suivi ni les anciennes versions.

Les mentions corrigées sont dans [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md). Les données locales sont conservées; cette revue ne supprime pas de fichiers et ne publie rien.
