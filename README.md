# Albion Market - Bellum Aeternum

Application mobile Android pour calculer les taxes, frais et profits dans Albion Online, avec un **conseiller IA embarqué** qui tourne entièrement sur le telephone.

## Fonctionnalites

### Marketplace Calculator
- Calcul des Setup Fees (2.5%) et Sales Tax (4% Premium / 8% Non-Premium)
- Mode Buy/Sell Orders vs achat/vente direct
- Fetch des prix live via l'API Albion Online Data Project
- Timestamps de fraicheur des donnees
- Profit net, % de marge, breakdown des frais

### Crafting Fee Calculator
- Calcul de la nutrition et des frais de station
- Base de donnees de 10 000+ items avec Item Values

### Profit Flipping
- Simulation complete : Achat materiaux > Craft > Vente
- Tous les frais inclus (marketplace + crafting)
- Calcul du ROI

### Price History & Compare
- Graphiques historiques des prix par ville
- Comparaison multi-items / multi-villes
- Tableau stats : Min / Moy / Max / Actuel
- Indicateur de tendance (% vs moyenne)
- Periodes : 7j / 30j / 90j / 1 an

### AI Market Advisor (LiteRT-LM)
- **IA on-device** via Google LiteRT-LM avec acceleration GPU
- Aucune donnee envoyee a un serveur externe
- **Tool calling** : l'IA peut chercher des prix, historiques, et routes elle-meme
- **5 outils integres** : search_item, get_prices, get_history, get_route, get_time
- **Vision** : envoi de screenshots pour analyse (modeles multimodaux)
- **Routes reelles** : matrice de routes extraite du world.json (zones bleues/jaunes/rouges)
- Gestion du contexte avec auto-reset et compteur de tokens
- Telechargement de modeles in-app via Android DownloadManager
- Support multi-modeles (Qwen, Gemma, DeepSeek)

### Autres
- Trilingue FR / EN / ES
- Theme dark inspire d'Albion Online
- 10 187 items dans la base de donnees
- Panneau d'infos Premium Bonuses

## Modeles IA disponibles

| Modele | Taille | Licence | Note |
|---|---|---|---|
| Qwen3.5 0.8B | 1.07 GB | Apache 2.0 | Leger, multimodal |
| Qwen2.5 1.5B | 1.5 GB | Apache 2.0 | Bon equilibre |
| DeepSeek R1 1.5B | 1.75 GB | MIT | Raisonnement |
| Gemma 4 E2B | 2.58 GB | Gemma | Recommande, tool calling |
| Gemma 4 E4B | 3.65 GB | Gemma | Le plus performant |

Les modeles sont telecharges depuis HuggingFace directement dans l'app. Aucun modele n'est inclus dans l'APK.

## Stack technique

- React Native 0.83 + Expo 55 (TypeScript)
- Module natif Kotlin pour LiteRT-LM
- react-native-chart-kit + react-native-svg
- expo-image-picker (vision IA)
- Android DownloadManager (telechargement modeles)
- API : Albion Online Data Project

## Build APK

```bash
npm install
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

> **Note** : Apres `expo prebuild`, verifier que les fichiers dans `android/app/src/main/java/com/albion/market/litert/` sont presents et que `MainApplication.kt` contient `add(LiteRTPackage())`.

L'APK sera dans `android/app/build/outputs/apk/release/`.

## Architecture IA

```
React Native (TypeScript)
  |
  |-- lib/litert.ts          Bridge vers module natif
  |-- lib/advisor.ts          System prompts + prompt builder
  |-- lib/models.ts           Registre des modeles disponibles
  |-- lib/routes.ts           Routes entre villes (BFS world.json)
  |-- screens/AdvisorScreen   UI chat + selecteur modeles
  |
  v
Kotlin Native Module (LiteRTModule.kt)
  |
  |-- LiteRT-LM Engine        Inference GPU on-device
  |-- AlbionTools.kt          5 tools OpenAPI pour function calling
  |-- DownloadManager          Telechargement modeles en arriere-plan
  |
  v
LiteRT-LM (Google AI Edge)
  |-- GPU Backend (OpenCL)
  |-- Vision Backend (multimodal)
  |-- Tool Calling (automatic)
```

## Donation

Si cette app t'aide, tu peux soutenir le developpement :

**BTC** : `bc1qcptkrekh335wvffcxnrzqkj5nqf72r538vey4x`

## Licence

Ce projet est sous [licence MIT](LICENSE).

Les modeles IA utilises ont leurs propres licences. Voir [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Disclaimer

This project is not affiliated with, endorsed, sponsored, or specifically approved by Sandbox Interactive GmbH. Albion Online is a registered trademark of Sandbox Interactive GmbH.

## Sources & Credits

- [Albion Online Data Project](https://www.albion-online-data.com/) - API de prix
- [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps) - Base de donnees items + world.json
- [Google AI Edge / LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM) - Framework inference on-device
- [LiteRT Community (HuggingFace)](https://huggingface.co/litert-community) - Modeles .litertlm
- [Albion Online Wiki](https://wiki.albiononline.com/) - Formules et mecaniques du jeu
