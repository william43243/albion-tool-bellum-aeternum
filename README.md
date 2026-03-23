# Albion Market

Application mobile Android pour calculer les taxes, frais et profits dans Albion Online.

## Fonctionnalités

### Marketplace Calculator
- Calcul des Setup Fees (2.5%) et Sales Tax (4% Premium / 8% Non-Premium)
- Mode Buy/Sell Orders vs achat/vente direct
- Fetch des prix live via l'API Albion Online Data Project
- Profit net, % de marge, breakdown des frais

### Crafting Fee Calculator
- Calcul de la nutrition et des frais de station
- Formule : `Fee = (Item Value × 0.1125 × Station Tax) / 100`
- Base de données de 10 000+ items avec Item Values

### Profit Flipping
- Simulation complète : Achat matériaux → Craft → Vente
- Tous les frais inclus (marketplace + crafting)
- Calcul du ROI

### Price History & Compare
- Graphiques historiques des prix par ville
- Couleurs distinctes par ville pour une lecture claire
- Comparaison multi-items / multi-villes
- Tableau stats : Min / Moy / Max / Actuel
- Indicateur de tendance (% vs moyenne)
- Périodes : 7j / 30j / 90j / 1 an

### Autres
- Bilingue FR / EN
- Thème dark inspiré d'Albion Online
- 10 187 items dans la base de données
- Panneau d'infos Premium Bonuses

## Formules (vérifiées)

| Formule | Détail |
|---|---|
| Setup Fee | `ceil(price × 0.025)` — toujours 2.5%, non affecté par Premium |
| Sales Tax (Premium) | `ceil(sell_price × 0.04)` |
| Sales Tax (Non-Premium) | `ceil(sell_price × 0.08)` |
| Nutrition par craft | `Item Value × 0.1125` |
| Usage Fee par craft | `(Item Value × 0.1125 × Station Tax) / 100` |

## Stack technique

- React Native + Expo (TypeScript)
- react-native-chart-kit + react-native-svg
- API : Albion Online Data Project

## Build APK

```bash
npm install
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

L'APK sera dans `android/app/build/outputs/apk/release/`.

## Donation

Si cette app t'aide, tu peux soutenir le développement :

**BTC** : `bc1qcptkrekh335wvffcxnrzqkj5nqf72r538vey4x`

## Licence

Ce projet est sous [licence MIT](LICENSE).

## Disclaimer

This project is not affiliated with, endorsed, sponsored, or specifically approved by Sandbox Interactive GmbH. Albion Online is a registered trademark of Sandbox Interactive GmbH.

Game data provided by the [Albion Online Data Project](https://www.albion-online-data.com/) and [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps).

## Sources

- [Albion Online Wiki - Marketplace](https://wiki.albiononline.com/wiki/Marketplace)
- [Albion Online Wiki - Margin](https://wiki.albiononline.com/wiki/Margin)
- [Albion Online Data Project](https://www.albion-online-data.com/)
- [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps)
- [Market Flipping Guide](https://albiononlinegrind.com/guides/market-flipping-guide)
